/**
 * Phase F2 smoke test against real Arbitrum Sepolia + real Nox infra.
 *
 * Flow per PRD §11 F2:
 *   1. Read deployed TestUSDC + ConfidentialUSDC addresses from deployments/arb-sepolia.json
 *   2. Mint TestUSDC to the deployer wallet (deployer is the TestUSDC owner)
 *   3. Approve ConfidentialUSDC for the deposit amount
 *   4. encryptInput(amount, 'uint256', confidentialUSDCAddress) via @iexec-nox/handle
 *   5. ConfidentialUSDC.wrap(amount, handle, proof)
 *   6. ConfidentialUSDC.confidentialBalanceOf(deployer) → balance handle
 *   7. decrypt(balanceHandle) — THE FIRST TIME DECRYPT IS EXPECTED TO WORK in this project
 *   8. Verify decrypted plaintext == amount
 *
 * GREEN here = the entire P0/F1/F2 stack works end-to-end against real infra.
 */

import {readFileSync} from "node:fs";
import {createPublicClient, createWalletClient, http, parseAbi, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";
import {createViemHandleClient} from "@iexec-nox/handle";

const ARB_SEPOLIA_CHAIN_ID = 421614;
const DEPOSIT_AMOUNT_PLAINTEXT = 100n * 1_000_000n; // 100 tUSDC (6 decimals)

type Deployment = {
  chainId: number;
  contracts: {
    TestUSDC: `0x${string}`;
    ConfidentialUSDC: `0x${string}`;
    NoxProtocol: `0x${string}`;
  };
  deployer: `0x${string}`;
  deployedAt: number;
};

type StepName = "load" | "balance" | "mint" | "approve" | "encrypt" | "wrap" | "balance-handle" | "decrypt";
type StepResult = {step: StepName; status: "PASS" | "FAIL"; latencyMs: number; detail: string};
const results: StepResult[] = [];

async function timed<T>(step: StepName, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const out = await fn();
    results.push({step, status: "PASS", latencyMs: Math.round(performance.now() - start), detail: "ok"});
    return out;
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    results.push({step, status: "FAIL", latencyMs, detail});
    throw err;
  }
}

function printSummary(totalMs: number): void {
  const header = ["STEP".padEnd(15), "STATUS".padEnd(7), "LATENCY".padEnd(10), "DETAIL"].join(" | ");
  const sep = "-".repeat(header.length);
  console.log("\n" + sep + "\n" + header + "\n" + sep);
  for (const r of results) {
    const detail = r.detail.length > 70 ? r.detail.slice(0, 67) + "..." : r.detail;
    console.log([r.step.padEnd(15), r.status.padEnd(7), `${r.latencyMs}ms`.padEnd(10), detail].join(" | "));
  }
  console.log(sep + `\nTotal: ${totalMs}ms\n` + sep + "\n");
}

const TEST_USDC_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
]);

const CUSDC_ABI = parseAbi([
  "function wrap(uint256 amount, bytes32 encryptedAmount, bytes inputProof) external returns (bytes32)",
  "function confidentialBalanceOf(address account) external view returns (bytes32)",
  "event Wrapped(address indexed user, uint256 amount, bytes32 newBalance)",
]);

async function main(): Promise<void> {
  const overallStart = performance.now();

  const rpcUrl = process.env["ARB_SEPOLIA_RPC_URL"]?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
  const privateKey = process.env["DEPLOYER_PRIVATE_KEY"]?.trim() as Hex | undefined;
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY missing in env");
  const account = privateKeyToAccount(privateKey);

  const deployment = await timed("load", async () => {
    const raw = readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8");
    const dep = JSON.parse(raw) as Deployment;
    if (dep.chainId !== ARB_SEPOLIA_CHAIN_ID) throw new Error(`unexpected chainId ${dep.chainId}`);
    return dep;
  });

  console.log(`[smoke-f2] RPC:               ${rpcUrl}`);
  console.log(`[smoke-f2] Deployer:          ${account.address}`);
  console.log(`[smoke-f2] TestUSDC:          ${deployment.contracts.TestUSDC}`);
  console.log(`[smoke-f2] ConfidentialUSDC:  ${deployment.contracts.ConfidentialUSDC}`);
  console.log(`[smoke-f2] Deposit:           ${DEPOSIT_AMOUNT_PLAINTEXT} (= 100 tUSDC)\n`);

  const publicClient = createPublicClient({chain: arbitrumSepolia, transport: http(rpcUrl)});
  const walletClient = createWalletClient({account, chain: arbitrumSepolia, transport: http(rpcUrl)});
  const handleClient = await createViemHandleClient(walletClient);

  await timed("balance", async () => {
    const bal = await publicClient.getBalance({address: account.address});
    console.log(`[smoke-f2] ETH balance:       ${bal} wei`);
    if (bal === 0n) throw new Error("deployer wallet has 0 ETH on Arb Sepolia — fund it first");
  });

  // 1. Mint TestUSDC to deployer (deployer is the owner). Idempotent — top up.
  await timed("mint", async () => {
    const hash = await walletClient.writeContract({
      address: deployment.contracts.TestUSDC,
      abi: TEST_USDC_ABI,
      functionName: "mint",
      args: [account.address, DEPOSIT_AMOUNT_PLAINTEXT * 10n],
    });
    await publicClient.waitForTransactionReceipt({hash});
  });

  // 2. Approve ConfidentialUSDC for the wrap.
  await timed("approve", async () => {
    const hash = await walletClient.writeContract({
      address: deployment.contracts.TestUSDC,
      abi: TEST_USDC_ABI,
      functionName: "approve",
      args: [deployment.contracts.ConfidentialUSDC, DEPOSIT_AMOUNT_PLAINTEXT],
    });
    await publicClient.waitForTransactionReceipt({hash});
  });

  // 3. encryptInput against the Nox gateway, bound to ConfidentialUSDC.
  const {handle, handleProof} = await timed("encrypt", async () => {
    const out = await handleClient.encryptInput(
      DEPOSIT_AMOUNT_PLAINTEXT,
      "uint256",
      deployment.contracts.ConfidentialUSDC,
    );
    return out;
  });
  console.log(`[smoke-f2] deposit handle:    ${handle}`);

  // 4. Wrap on-chain. This is where Nox.fromExternal + Nox.mint commit the
  //    handle to the on-chain ACL. After this tx, decrypt becomes possible.
  await timed("wrap", async () => {
    const hash = await walletClient.writeContract({
      address: deployment.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "wrap",
      args: [DEPOSIT_AMOUNT_PLAINTEXT, handle as Hex, handleProof as Hex],
    });
    const receipt = await publicClient.waitForTransactionReceipt({hash});
    if (receipt.status !== "success") throw new Error(`wrap tx reverted: ${hash}`);
    console.log(`[smoke-f2] wrap tx:           ${hash}`);
  });

  // 5. Read the user's confidential balance handle from chain state.
  const balanceHandle = await timed("balance-handle", async () => {
    return publicClient.readContract({
      address: deployment.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "confidentialBalanceOf",
      args: [account.address],
    });
  });
  console.log(`[smoke-f2] balance handle:    ${balanceHandle}`);

  // 6. Decrypt the balance handle. This is the FIRST DECRYPT in the project's
  //    history — proves the on-chain ACL commit via wrap → fromExternal → mint
  //    + the explicit `Nox.allow(newBalance, msg.sender)` call works end-to-end.
  const decrypted = await timed("decrypt", async () => {
    const out = await handleClient.decrypt(balanceHandle);
    if (out.solidityType !== "uint256") {
      throw new Error(`decrypt returned solidityType=${out.solidityType}, expected uint256`);
    }
    if (typeof out.value !== "bigint") {
      throw new Error(`decrypt returned non-bigint value: ${typeof out.value}`);
    }
    return out.value;
  });

  if (decrypted !== DEPOSIT_AMOUNT_PLAINTEXT) {
    throw new Error(`decrypt mismatch: expected ${DEPOSIT_AMOUNT_PLAINTEXT}, got ${decrypted}`);
  }
  console.log(`[smoke-f2] decrypted balance: ${decrypted}  (matches deposit ✓)`);

  const totalMs = Math.round(performance.now() - overallStart);
  printSummary(totalMs);
  console.log("GREEN — wrap → decrypt round-trip validated against real Arb Sepolia + Nox infra");
}

main().catch((err) => {
  const totalMs = results.reduce((acc, r) => acc + r.latencyMs, 0);
  printSummary(totalMs);
  console.error(`\n[smoke-f2] FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  console.error("RED — see BUG_LOG.md");
  process.exit(1);
});
