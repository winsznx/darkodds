// SPDX-License-Identifier: MIT
//
// F7-followup — Safe-cosigned TestUSDC.mint(faucet, 10M) via the script-side
// 2-of-3 pattern that's been canonical in this repo since F4.5
// (deploy-multisig.ts → deploy-f45.ts → deploy-f5-followup.ts).
//
// Why a script and not the Safe UI: app.safe.global's Transaction Service
// indexer doesn't surface our Safe on Arb Sepolia. Documented in feedback.md.
// Scripts are the source of truth for multisig ops in this repo.
//
// What it does:
//   1. Read DEPLOYER_PRIVATE_KEY (PK1) and MULTISIG_SIGNER_2_PK (PK2) from .env
//      — same convention as deploy-f45.ts / deploy-f5-followup.ts.
//   2. Encode TestUSDC.mint(faucet, 10_000_000e6) calldata.
//   3. safeExecAs2of3 — Safe SDK Safe.init/createTransaction/signTransaction
//      handles the EIP-712 SafeTx hashing internally; we just supply target +
//      calldata.
//   4. Wait for receipt; assert TestUSDC.balanceOf(faucet) == 10M (1e13 base).
//   5. Persist tx hash to deployments.json under notes.f7_faucet_funding_tx.
//
// Reads:  .env (DEPLOYER_PRIVATE_KEY, MULTISIG_SIGNER_2_PK, ARB_SEPOLIA_RPC_URL)
// Writes: contracts/deployments/arb-sepolia.json (in-place)

import {
  createPublicClient,
  http,
  parseAbi,
  encodeFunctionData,
  formatUnits,
  type Hex,
  type Address,
} from "viem";
import {arbitrumSepolia} from "viem/chains";
import {privateKeyToAccount} from "viem/accounts";
import Safe from "@safe-global/protocol-kit";
import {readFileSync, writeFileSync} from "node:fs";

const ARBISCAN_BASE = "https://sepolia.arbiscan.io";

const TUSDC_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

/// 10M TestUSDC at 6 decimals = 1e13 base units. Sized for ~10K Faucet claims
/// at 1k tUSDC each before a refill is needed.
const FUND_AMOUNT = 10_000_000_000_000n;

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function safeExecAs2of3(
  rpcUrl: string,
  safeAddress: Address,
  pk1: Hex,
  pk2: Hex,
  to: Address,
  data: Hex,
): Promise<Hex> {
  const sdk1 = await Safe.init({provider: rpcUrl, signer: pk1, safeAddress});
  let tx = await sdk1.createTransaction({transactions: [{to, value: "0", data}]});
  tx = await sdk1.signTransaction(tx);
  const sdk2 = await Safe.init({provider: rpcUrl, signer: pk2, safeAddress});
  tx = await sdk2.signTransaction(tx);
  const exec = await sdk1.executeTransaction(tx);
  const hash = (exec.hash ||
    (exec as unknown as {transactionResponse?: {hash: string}}).transactionResponse?.hash) as Hex | undefined;
  if (!hash) throw new Error("Safe executeTransaction returned no hash");
  return hash;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const RPC = need("ARB_SEPOLIA_RPC_URL");
  const PK1 = need("DEPLOYER_PRIVATE_KEY") as Hex;
  const PK2 = need("MULTISIG_SIGNER_2_PK") as Hex;

  const account = privateKeyToAccount(PK1);
  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});

  const depPath = `${process.cwd()}/contracts/deployments/arb-sepolia.json`;
  const dep = JSON.parse(readFileSync(depPath, "utf8")) as {
    contracts: Record<string, Hex>;
    safe: {address: Address};
    notes?: Record<string, string>;
  };
  if (!dep.safe?.address) throw new Error("Safe not deployed; run deploy-multisig.ts first");
  const safeAddr = dep.safe.address;
  const tusdcAddr = dep.contracts.TestUSDC;
  const faucetAddr = dep.contracts.Faucet;
  if (!tusdcAddr) throw new Error("TestUSDC missing from deployments");
  if (!faucetAddr) throw new Error("Faucet missing from deployments — run deploy-faucet.ts first");

  console.log(`[mint-faucet] Co-signer 1: ${account.address}  (DEPLOYER_PRIVATE_KEY)`);
  console.log(`[mint-faucet] Co-signer 2: ${privateKeyToAccount(PK2).address}  (MULTISIG_SIGNER_2_PK)`);
  console.log(`[mint-faucet] Safe:        ${safeAddr}`);
  console.log(`[mint-faucet] TestUSDC:    ${tusdcAddr}`);
  console.log(`[mint-faucet] Faucet:      ${faucetAddr}`);
  console.log(
    `[mint-faucet] Mint amount: ${FUND_AMOUNT.toString()}  (${formatUnits(FUND_AMOUNT, 6)} TestUSDC)`,
  );

  const preBal = (await pub.readContract({
    address: tusdcAddr,
    abi: TUSDC_ABI,
    functionName: "balanceOf",
    args: [faucetAddr],
  })) as bigint;
  console.log(`[mint-faucet] Faucet pre-mint balance: ${formatUnits(preBal, 6)} TestUSDC`);

  if (preBal >= FUND_AMOUNT) {
    console.log(
      `[mint-faucet] Faucet already at ≥ target (${formatUnits(preBal, 6)} ≥ ${formatUnits(FUND_AMOUNT, 6)}); idempotent skip.`,
    );
    return;
  }

  const remaining = FUND_AMOUNT - preBal;
  console.log(`[mint-faucet] Co-signing TestUSDC.mint(faucet, ${remaining.toString()}) via Safe 2-of-3...`);

  const mintData = encodeFunctionData({
    abi: TUSDC_ABI,
    functionName: "mint",
    args: [faucetAddr, remaining],
  });

  const txHash = await safeExecAs2of3(RPC, safeAddr, PK1, PK2, tusdcAddr, mintData);
  console.log(`[mint-faucet] Safe execTransaction tx: ${txHash}`);
  console.log(`[mint-faucet] ${ARBISCAN_BASE}/tx/${txHash}`);

  const rc = await pub.waitForTransactionReceipt({hash: txHash});
  if (rc.status !== "success") {
    throw new Error(`Safe execTransaction reverted: ${txHash}`);
  }

  const postBal = (await pub.readContract({
    address: tusdcAddr,
    abi: TUSDC_ABI,
    functionName: "balanceOf",
    args: [faucetAddr],
  })) as bigint;
  console.log(`[mint-faucet] Faucet post-mint balance: ${formatUnits(postBal, 6)} TestUSDC`);

  if (postBal !== FUND_AMOUNT) {
    throw new Error(`Faucet balance ${postBal} != expected ${FUND_AMOUNT}`);
  }
  console.log(`[mint-faucet] balance == 10M TestUSDC ✓`);

  // Persist tx hash for the audit trail.
  dep.notes = dep.notes ?? {};
  dep.notes["f7_faucet_funding_tx"] = txHash;
  writeFileSync(depPath, JSON.stringify(dep, null, 2) + "\n");
  console.log(`[mint-faucet] deployments.json updated with notes.f7_faucet_funding_tx`);

  console.log(`\n[mint-faucet] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error("[mint-faucet] FAILED:", e);
  process.exit(1);
});
