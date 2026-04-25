/**
 * Phase F3 smoke test against real Arbitrum Sepolia + real Nox infra.
 *
 * Proves the full bet → batch publish → public-decrypt flow works end-to-end
 * per PRD §3.3 step E + E.1 + §6.2 (lazy public decryption).
 *
 * Flow:
 *   1. Read F3 deployments (cUSDC v2, MarketRegistry, Market[0]) from JSON
 *   2. Mint TestUSDC to deployer
 *   3. Wrap into cUSDC v2 (encryptInput + wrap)
 *   4. setOperator(market, +1 day) on cUSDC so Market can transferFrom
 *   5. encryptInput(betAmount, 'uint256', marketAddress) — bet amount handle
 *   6. Market.placeBet(YES, handle, proof)
 *   7. Sleep 65s (the 60s batch interval is a privacy primitive, not a knob)
 *   8. Market.publishBatch() — TEE-decrypts batch, folds into public total
 *   9. publicDecrypt(yesPoolPublishedHandle) — must equal the bet amount
 *  10. decrypt(yesBet[user]) — must equal the bet amount
 */

import {readFileSync} from "node:fs";
import {createPublicClient, createWalletClient, http, parseAbi, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";
import {createViemHandleClient} from "@iexec-nox/handle";

const ARB_SEPOLIA_CHAIN_ID = 421614;
const WRAP_AMOUNT = 200n * 1_000_000n; // 200 tUSDC
const BET_AMOUNT = 50n * 1_000_000n; // 50 tUSDC
const BATCH_WAIT_S = 65; // BATCH_INTERVAL is 60s; pad for clock drift

type Deployment = {
  chainId: number;
  contracts: {
    TestUSDC: `0x${string}`;
    ConfidentialUSDC: `0x${string}`;
    MarketImplementation: `0x${string}`;
    MarketRegistry: `0x${string}`;
    Market_0: `0x${string}`;
  };
  deployer: `0x${string}`;
};

type StepName =
  | "load"
  | "balance"
  | "mint"
  | "approve-erc20"
  | "encrypt-wrap"
  | "wrap"
  | "set-operator"
  | "encrypt-bet"
  | "place-bet"
  | "wait-batch"
  | "publish-batch"
  | "public-decrypt-yes"
  | "decrypt-user-bet";
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
  const header = ["STEP".padEnd(20), "STATUS".padEnd(7), "LATENCY".padEnd(10), "DETAIL"].join(" | ");
  const sep = "-".repeat(header.length);
  console.log("\n" + sep + "\n" + header + "\n" + sep);
  for (const r of results) {
    const detail = r.detail.length > 60 ? r.detail.slice(0, 57) + "..." : r.detail;
    console.log([r.step.padEnd(20), r.status.padEnd(7), `${r.latencyMs}ms`.padEnd(10), detail].join(" | "));
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
  "function setOperator(address operator, uint48 until) external",
  "function isOperator(address holder, address operator) external view returns (bool)",
  "function confidentialBalanceOf(address account) external view returns (bytes32)",
]);

const MARKET_ABI = parseAbi([
  "function placeBet(uint8 side, bytes32 encryptedAmount, bytes inputProof) external",
  "function publishBatch() external",
  "function yesPoolPublishedHandle() external view returns (bytes32)",
  "function noPoolPublishedHandle() external view returns (bytes32)",
  "function yesBet(address user) external view returns (bytes32)",
  "function noBet(address user) external view returns (bytes32)",
  "function lastBatchTs() external view returns (uint256)",
  "function batchCount() external view returns (uint256)",
  "function totalBetCount() external view returns (uint256)",
  "function pendingBatchBetCount() external view returns (uint256)",
  "event BetPlaced(address indexed user, uint8 side, bytes32 handle, uint256 indexed batchId)",
  "event BatchPublished(uint256 indexed batchId, uint256 betsInBatch, uint256 timestamp)",
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

  console.log(`[smoke-f3] RPC:      ${rpcUrl}`);
  console.log(`[smoke-f3] Deployer: ${account.address}`);
  console.log(`[smoke-f3] cUSDC v2: ${deployment.contracts.ConfidentialUSDC}`);
  console.log(`[smoke-f3] Registry: ${deployment.contracts.MarketRegistry}`);
  console.log(`[smoke-f3] Market:   ${deployment.contracts.Market_0}`);
  console.log(`[smoke-f3] Wrap:     ${WRAP_AMOUNT} (= 200 tUSDC)`);
  console.log(`[smoke-f3] Bet:      ${BET_AMOUNT} (= 50 tUSDC) on YES\n`);

  const publicClient = createPublicClient({chain: arbitrumSepolia, transport: http(rpcUrl)});
  const walletClient = createWalletClient({account, chain: arbitrumSepolia, transport: http(rpcUrl)});
  const handleClient = await createViemHandleClient(walletClient);

  await timed("balance", async () => {
    const bal = await publicClient.getBalance({address: account.address});
    if (bal < 5_000_000_000_000_000n) throw new Error("deployer below 0.005 ETH");
  });

  // 1. Mint tUSDC to deployer (idempotent — top up).
  await timed("mint", async () => {
    const hash = await walletClient.writeContract({
      address: deployment.contracts.TestUSDC,
      abi: TEST_USDC_ABI,
      functionName: "mint",
      args: [account.address, WRAP_AMOUNT * 5n],
    });
    await publicClient.waitForTransactionReceipt({hash});
  });

  // 2. Approve cUSDC for the wrap.
  await timed("approve-erc20", async () => {
    const hash = await walletClient.writeContract({
      address: deployment.contracts.TestUSDC,
      abi: TEST_USDC_ABI,
      functionName: "approve",
      args: [deployment.contracts.ConfidentialUSDC, WRAP_AMOUNT],
    });
    await publicClient.waitForTransactionReceipt({hash});
  });

  // 3. encryptInput for the wrap (bound to cUSDC v2).
  const wrapHandle = await timed("encrypt-wrap", async () => {
    const out = await handleClient.encryptInput(
      WRAP_AMOUNT,
      "uint256",
      deployment.contracts.ConfidentialUSDC,
    );
    return out;
  });

  // 4. Wrap into cUSDC.
  await timed("wrap", async () => {
    const hash = await walletClient.writeContract({
      address: deployment.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "wrap",
      args: [WRAP_AMOUNT, wrapHandle.handle as Hex, wrapHandle.handleProof as Hex],
    });
    const r = await publicClient.waitForTransactionReceipt({hash});
    if (r.status !== "success") throw new Error(`wrap reverted: ${hash}`);
  });

  // 5. setOperator(market, +1 day) so Market can pull cUSDC during placeBet.
  await timed("set-operator", async () => {
    const until = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const hash = await walletClient.writeContract({
      address: deployment.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "setOperator",
      args: [deployment.contracts.Market_0, until],
    });
    await publicClient.waitForTransactionReceipt({hash});
  });

  // 6. encryptInput for the bet (bound to Market_0 — this market is the
  //    applicationContract for bet handles, NOT cUSDC).
  const betHandle = await timed("encrypt-bet", async () => {
    const out = await handleClient.encryptInput(BET_AMOUNT, "uint256", deployment.contracts.Market_0);
    return out;
  });
  console.log(`[smoke-f3] bet handle:        ${betHandle.handle}`);

  // 7. placeBet on YES side.
  await timed("place-bet", async () => {
    const hash = await walletClient.writeContract({
      address: deployment.contracts.Market_0,
      abi: MARKET_ABI,
      functionName: "placeBet",
      args: [1, betHandle.handle as Hex, betHandle.handleProof as Hex],
    });
    const r = await publicClient.waitForTransactionReceipt({hash});
    if (r.status !== "success") throw new Error(`placeBet reverted: ${hash}`);
    console.log(`[smoke-f3] placeBet tx:       ${hash}`);
  });

  // 8. Wait for batch interval (60s + slack).
  await timed("wait-batch", async () => {
    console.log(`[smoke-f3] waiting ${BATCH_WAIT_S}s for batch interval...`);
    await new Promise((res) => setTimeout(res, BATCH_WAIT_S * 1000));
  });

  // 9. publishBatch — anyone can call.
  await timed("publish-batch", async () => {
    const hash = await walletClient.writeContract({
      address: deployment.contracts.Market_0,
      abi: MARKET_ABI,
      functionName: "publishBatch",
    });
    const r = await publicClient.waitForTransactionReceipt({hash});
    if (r.status !== "success") throw new Error(`publishBatch reverted: ${hash}`);
    console.log(`[smoke-f3] publishBatch tx:   ${hash}`);
  });

  // 10. publicDecrypt the YES pool published total.
  const yesTotal = await timed("public-decrypt-yes", async () => {
    const yesHandle = (await publicClient.readContract({
      address: deployment.contracts.Market_0,
      abi: MARKET_ABI,
      functionName: "yesPoolPublishedHandle",
    })) as Hex;
    console.log(`[smoke-f3] yesPub handle:     ${yesHandle}`);
    const out = await handleClient.publicDecrypt(yesHandle);
    if (typeof out.value !== "bigint") {
      throw new Error(`publicDecrypt returned non-bigint: ${typeof out.value}`);
    }
    return out.value;
  });
  if (yesTotal !== BET_AMOUNT) {
    throw new Error(`YES pool total mismatch: expected ${BET_AMOUNT}, got ${yesTotal}`);
  }
  console.log(`[smoke-f3] YES pool total:    ${yesTotal} (matches bet ✓)`);

  // 11. decrypt the user's encrypted bet handle.
  const userBet = await timed("decrypt-user-bet", async () => {
    const yesBetHandle = (await publicClient.readContract({
      address: deployment.contracts.Market_0,
      abi: MARKET_ABI,
      functionName: "yesBet",
      args: [account.address],
    })) as Hex;
    console.log(`[smoke-f3] user yesBet:       ${yesBetHandle}`);
    const out = await handleClient.decrypt(yesBetHandle);
    if (typeof out.value !== "bigint") {
      throw new Error(`decrypt returned non-bigint: ${typeof out.value}`);
    }
    return out.value;
  });
  if (userBet !== BET_AMOUNT) {
    throw new Error(`user bet mismatch: expected ${BET_AMOUNT}, got ${userBet}`);
  }
  console.log(`[smoke-f3] user bet decrypts: ${userBet} (matches bet ✓)`);

  const totalMs = Math.round(performance.now() - overallStart);
  printSummary(totalMs);
  console.log(
    "GREEN — bet → batch → publish → public-decrypt round-trip validated against real Arb Sepolia + Nox infra",
  );
}

main().catch((err) => {
  const totalMs = results.reduce((acc, r) => acc + r.latencyMs, 0);
  printSummary(totalMs);
  console.error(`\n[smoke-f3] FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  console.error("RED — see BUG_LOG.md");
  process.exit(1);
});
