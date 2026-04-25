// SPDX-License-Identifier: MIT
//
// F5 — Deploy patched MarketImplementation v4 and point the registry at it
// via the Safe multisig.
//
// What it does:
//   1. Compiles contracts via forge.
//   2. Deploys MarketImplementation v4 (F5: real claimWinnings payout via
//      Nox.mul/div/sub).
//   3. Reads the production MarketRegistry address from deployments.
//   4. Builds a Safe tx setting the registry's marketImplementation to v4.
//   5. Signs with PK1 + PK2 (2-of-3) and executes.
//   6. Verifies registry.marketImplementation() == v4 on-chain.
//   7. Writes the new address into deployments json under
//      `contracts.MarketImplementation_v4`.
//   8. Verifies MarketImpl v4 on Arbiscan via Etherscan V2 API.
//
// Reads:  .env (DEPLOYER_PRIVATE_KEY, MULTISIG_SIGNER_2_PK,
//                ARB_SEPOLIA_RPC_URL, ARBISCAN_API_KEY)
// Writes: contracts/deployments/arb-sepolia.json (in-place)

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseAbi,
  encodeFunctionData,
  type Hex,
} from "viem";
import {arbitrumSepolia} from "viem/chains";
import {privateKeyToAccount} from "viem/accounts";
import Safe from "@safe-global/protocol-kit";
import {execSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";

const ARBISCAN_API = "https://api.etherscan.io/v2/api?chainid=421614";
const ARBISCAN_BASE = "https://sepolia.arbiscan.io";

const REGISTRY_ABI = parseAbi([
  "function setMarketImplementation(address newImpl) external",
  "function marketImplementation() view returns (address)",
]);

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function safeExecAs2of3(
  safeAddress: string,
  rpcUrl: string,
  pk1: Hex,
  pk2: Hex,
  to: Hex,
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

function verifyOnArbiscan(addr: string, contractPath: string, contractName: string) {
  const apiKey = process.env["ARBISCAN_API_KEY"]?.trim();
  if (!apiKey) {
    console.log(`[deploy-f5] no ARBISCAN_API_KEY, skipping verification`);
    return;
  }
  const cmd =
    `ETHERSCAN_API_KEY='${apiKey}' forge verify-contract ${addr} ${contractPath}:${contractName} ` +
    `--verifier etherscan --verifier-url '${ARBISCAN_API}' ` +
    `--watch --num-of-optimizations 200 --compiler-version 0.8.34 --chain-id 421614`;
  try {
    execSync(cmd, {cwd: `${process.cwd()}/contracts`, stdio: "inherit", timeout: 240_000});
  } catch (err) {
    console.warn(`[deploy-f5] verify warning:`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  const t0 = Date.now();
  const RPC = need("ARB_SEPOLIA_RPC_URL");
  const PK1 = need("DEPLOYER_PRIVATE_KEY") as Hex;
  const PK2 = need("MULTISIG_SIGNER_2_PK") as Hex;

  const account = privateKeyToAccount(PK1);
  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const wc = createWalletClient({chain: arbitrumSepolia, transport: http(RPC), account});

  console.log(`[deploy-f5] Deployer: ${account.address}`);
  const bal = await pub.getBalance({address: account.address});
  console.log(`[deploy-f5] Balance:  ${formatEther(bal)} ETH`);
  if (bal < 5_000_000_000_000_000n) throw new Error("balance < 0.005 ETH; top up");

  console.log(`[deploy-f5] forge build...`);
  execSync("forge build", {cwd: `${process.cwd()}/contracts`, stdio: "inherit"});

  const dep = JSON.parse(readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8")) as {
    contracts: Record<string, Hex>;
    safe: {address: string};
    arbiscan?: Record<string, string>;
    notes?: Record<string, string>;
  };
  if (!dep.safe?.address) throw new Error("Safe not deployed; run deploy-multisig.ts first");
  const safeAddress = dep.safe.address;
  const registryAddress = dep.contracts.MarketRegistry;
  console.log(`[deploy-f5] Safe:     ${safeAddress}`);
  console.log(`[deploy-f5] Registry: ${registryAddress}`);

  // ----- 1. Deploy MarketImpl v4 (idempotent) -----
  let marketImplV4: Hex;
  if (dep.contracts.MarketImplementation_v4) {
    marketImplV4 = dep.contracts.MarketImplementation_v4;
    const code = await pub.getCode({address: marketImplV4});
    if (code && code.length > 2) {
      console.log(`[deploy-f5] reusing existing MarketImplementation_v4: ${marketImplV4}`);
    } else {
      throw new Error(`stale MarketImplementation_v4 entry; remove from deployments json`);
    }
  } else {
    const art = JSON.parse(readFileSync(`${process.cwd()}/contracts/out/Market.sol/Market.json`, "utf8")) as {
      bytecode: {object: Hex};
    };
    console.log(`[deploy-f5] deploying MarketImplementation v4...`);
    const deployHash = await wc.sendTransaction({to: null, data: art.bytecode.object});
    const deployRc = await pub.waitForTransactionReceipt({hash: deployHash});
    if (deployRc.status !== "success" || !deployRc.contractAddress) {
      throw new Error(`MarketImpl v4 deploy failed: ${deployHash}`);
    }
    marketImplV4 = deployRc.contractAddress as Hex;
    console.log(`[deploy-f5] MarketImplementation_v4: ${marketImplV4}  (tx ${deployHash})`);
  }

  if (!registryAddress) throw new Error("MarketRegistry not in deployments");
  const registryAddr = registryAddress as Hex;

  // ----- 2. Safe-mediated setMarketImplementation -----
  console.log(`[deploy-f5] preparing Safe tx: registry.setMarketImplementation(${marketImplV4})...`);
  const setImplData = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "setMarketImplementation",
    args: [marketImplV4],
  });

  const txHash = await safeExecAs2of3(safeAddress, RPC, PK1, PK2, registryAddr, setImplData);
  console.log(`[deploy-f5] Safe tx executed: ${txHash}`);
  await pub.waitForTransactionReceipt({hash: txHash});

  // ----- 3. Verify registry now points at v4 -----
  const onchainImpl = (await pub.readContract({
    address: registryAddr,
    abi: REGISTRY_ABI,
    functionName: "marketImplementation",
  })) as `0x${string}`;
  if (onchainImpl.toLowerCase() !== marketImplV4.toLowerCase()) {
    throw new Error(`registry impl mismatch: got ${onchainImpl}, expected ${marketImplV4}`);
  }
  console.log(`[deploy-f5] registry.marketImplementation() == v4 ✓`);

  // ----- 4. Update deployments json -----
  const oldImpl = dep.contracts.MarketImplementation;
  dep.notes = dep.notes ?? {};
  dep.notes["f5_legacy_MarketImplementation_v3"] = (oldImpl ?? "") as string;
  dep.notes["f5_marketimpl_swap_tx"] = txHash;
  dep.contracts.MarketImplementation = marketImplV4;
  dep.contracts.MarketImplementation_v4 = marketImplV4;
  dep.arbiscan = dep.arbiscan ?? {};
  dep.arbiscan.MarketImplementation_v4 = `${ARBISCAN_BASE}/address/${marketImplV4}`;
  writeFileSync(
    `${process.cwd()}/contracts/deployments/arb-sepolia.json`,
    JSON.stringify(dep, null, 2) + "\n",
  );
  console.log(`[deploy-f5] deployments json updated`);

  // ----- 5. Verify on Arbiscan -----
  console.log(`[deploy-f5] verifying MarketImpl v4 on Arbiscan...`);
  verifyOnArbiscan(marketImplV4, "src/Market.sol", "Market");

  console.log(`\n[deploy-f5] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[deploy-f5] MarketImpl v4: ${marketImplV4}`);
  console.log(`[deploy-f5] ${ARBISCAN_BASE}/address/${marketImplV4}`);
}

main().catch((e) => {
  console.error("[deploy-f5] FAILED:", e);
  process.exit(1);
});
