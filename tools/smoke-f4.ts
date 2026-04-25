/**
 * Phase F4 smoke test against real Arbitrum Sepolia + real Nox infra.
 *
 * Two end-to-end lifecycles, both exercised against deployed F4 contracts:
 *
 *   A. YES happy path — fresh PreResolvedOracle market with hardcoded YES.
 *        wrap → setOperator → placeBet(YES) → publishBatch → resolveOracle →
 *        freezePool → claimWinnings (records claim intent; F5 wires payout)
 *
 *   B. INVALID refund path — fresh PreResolvedOracle market with INVALID outcome.
 *        wrap → setOperator → placeBet(YES) → publishBatch → resolveOracle →
 *        refundIfInvalid (cUSDC bet handle returns to user)
 *
 * Markets are created on the fly with short (90s) expiries so the smoke can
 * complete in ~4 minutes; the testnet `block.timestamp` advances in real time
 * and we can't vm.warp.
 */

import {readFileSync} from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeAbiParameters,
  encodePacked,
  toHex,
  type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";
import {createViemHandleClient} from "@iexec-nox/handle";

const ARB_SEPOLIA_CHAIN_ID = 421614;
const WRAP_AMOUNT = 200n * 1_000_000n; // 200 tUSDC
const BET_AMOUNT = 50n * 1_000_000n; // 50 tUSDC
const BATCH_WAIT_S = 65;
const MARKET_EXPIRY_S = 90; // creating market with +90s expiry; smoke waits past it

type Deployment = {
  chainId: number;
  contracts: {
    TestUSDC: Hex;
    ConfidentialUSDC: Hex;
    MarketRegistry: Hex;
    ResolutionOracle: Hex;
    PreResolvedOracle: Hex;
  };
};

type StepName = string;
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
  const header = ["STEP".padEnd(28), "STATUS".padEnd(7), "LATENCY".padEnd(11), "DETAIL"].join(" | ");
  const sep = "-".repeat(header.length);
  console.log("\n" + sep + "\n" + header + "\n" + sep);
  for (const r of results) {
    const detail = r.detail.length > 60 ? r.detail.slice(0, 57) + "..." : r.detail;
    console.log([r.step.padEnd(28), r.status.padEnd(7), `${r.latencyMs}ms`.padEnd(11), detail].join(" | "));
  }
  console.log(sep + `\nTotal: ${totalMs}ms\n` + sep + "\n");
}

const TUSDC_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
]);
const CUSDC_ABI = parseAbi([
  "function wrap(uint256 amount, bytes32 encryptedAmount, bytes inputProof) external returns (bytes32)",
  "function setOperator(address operator, uint48 until) external",
  "function confidentialBalanceOf(address account) external view returns (bytes32)",
]);
const REGISTRY_ABI = parseAbi([
  "function createMarket(string question, string resolutionCriteria, uint8 oracleType, uint256 expiryTs, uint256 protocolFeeBps) external returns (uint256 id, address market)",
  "function nextMarketId() external view returns (uint256)",
  "function markets(uint256 id) external view returns (address)",
]);
const RES_ORACLE_ABI = parseAbi(["function setAdapter(uint256 marketId, address adapter) external"]);
const PRE_ORACLE_ABI = parseAbi(["function configure(uint256 marketId, uint8 outcome) external"]);
const MARKET_ABI = parseAbi([
  "function id() external view returns (uint256)",
  "function placeBet(uint8 side, bytes32 encryptedAmount, bytes inputProof) external",
  "function publishBatch() external",
  "function resolveOracle() external",
  "function freezePool(bytes yesProof, bytes noProof) external",
  "function claimWinnings() external",
  "function refundIfInvalid() external returns (bytes32)",
  "function state() external view returns (uint8)",
  "function outcome() external view returns (uint8)",
  "function yesPoolFrozen() external view returns (uint256)",
  "function noPoolFrozen() external view returns (uint256)",
  "function yesPoolPublishedHandle() external view returns (bytes32)",
  "function noPoolPublishedHandle() external view returns (bytes32)",
  "function yesBet(address user) external view returns (bytes32)",
  "function expiryTs() external view returns (uint256)",
  "function claimWindowOpensAt() external view returns (uint256)",
  "function hasClaimed(address user) external view returns (bool)",
]);

async function main(): Promise<void> {
  const overallStart = performance.now();
  const rpcUrl = process.env["ARB_SEPOLIA_RPC_URL"]?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
  const privateKey = process.env["DEPLOYER_PRIVATE_KEY"]?.trim() as Hex | undefined;
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY missing in env");
  const account = privateKeyToAccount(privateKey);

  const deployment = JSON.parse(
    readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8"),
  ) as Deployment;
  if (deployment.chainId !== ARB_SEPOLIA_CHAIN_ID) {
    throw new Error(`unexpected chainId ${deployment.chainId}`);
  }

  console.log(`[smoke-f4] Deployer: ${account.address}`);
  console.log(`[smoke-f4] cUSDC v2: ${deployment.contracts.ConfidentialUSDC}`);
  console.log(`[smoke-f4] Registry: ${deployment.contracts.MarketRegistry}`);
  console.log(`[smoke-f4] ResOracle:${deployment.contracts.ResolutionOracle}`);
  console.log(`[smoke-f4] PreOracle:${deployment.contracts.PreResolvedOracle}\n`);

  const publicClient = createPublicClient({chain: arbitrumSepolia, transport: http(rpcUrl)});
  const walletClient = createWalletClient({account, chain: arbitrumSepolia, transport: http(rpcUrl)});
  const handleClient = await createViemHandleClient(walletClient);

  // Deploy a fresh PreResolvedOracle for this smoke run, isolated from the
  // production-deploy oracle (which has phantom configurations from the deploy
  // script's labelling drift). This way the smoke can configure whatever ids
  // it likes without conflict.
  const preOracleAddr = await timed("deploy-fresh-preoracle", async () => {
    const art = JSON.parse(
      readFileSync(`${process.cwd()}/contracts/out/PreResolvedOracle.sol/PreResolvedOracle.json`, "utf8"),
    ) as {bytecode: {object: Hex}};
    const ctor = encodeAbiParameters([{type: "address"}], [account.address]);
    const h = await walletClient.sendTransaction({
      data: (art.bytecode.object + ctor.slice(2)) as Hex,
      to: null,
    });
    const r = await publicClient.waitForTransactionReceipt({hash: h});
    if (r.status !== "success" || !r.contractAddress) throw new Error("preoracle deploy failed");
    return r.contractAddress;
  });
  console.log(`[smoke-f4] fresh PreOracle: ${preOracleAddr}`);

  // Replenish tUSDC + wrap once at the top.
  await timed("mint-tusdc", async () => {
    const h = await walletClient.writeContract({
      address: deployment.contracts.TestUSDC,
      abi: TUSDC_ABI,
      functionName: "mint",
      args: [account.address, WRAP_AMOUNT * 4n],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  await timed("approve-tusdc", async () => {
    const h = await walletClient.writeContract({
      address: deployment.contracts.TestUSDC,
      abi: TUSDC_ABI,
      functionName: "approve",
      args: [deployment.contracts.ConfidentialUSDC, WRAP_AMOUNT * 2n],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  const wrapHandleA = await timed("encrypt-wrap-A", async () =>
    handleClient.encryptInput(WRAP_AMOUNT, "uint256", deployment.contracts.ConfidentialUSDC),
  );
  await timed("wrap-A", async () => {
    const h = await walletClient.writeContract({
      address: deployment.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "wrap",
      args: [WRAP_AMOUNT, wrapHandleA.handle as Hex, wrapHandleA.handleProof as Hex],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  // Wrap a second time for the INVALID-refund market.
  const wrapHandleB = await timed("encrypt-wrap-B", async () =>
    handleClient.encryptInput(WRAP_AMOUNT, "uint256", deployment.contracts.ConfidentialUSDC),
  );
  await timed("wrap-B", async () => {
    const h = await walletClient.writeContract({
      address: deployment.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "wrap",
      args: [WRAP_AMOUNT, wrapHandleB.handle as Hex, wrapHandleB.handleProof as Hex],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });

  // ============================================================
  // Lifecycle A — YES happy path on a fresh PreResolved market
  // ============================================================
  console.log(`\n[smoke-f4] === Lifecycle A: PreResolved YES ===`);

  const marketIdA = await timed("create-market-A", async () => {
    const expiry = BigInt(Math.floor(Date.now() / 1000) + MARKET_EXPIRY_S);
    const beforeId = (await publicClient.readContract({
      address: deployment.contracts.MarketRegistry,
      abi: REGISTRY_ABI,
      functionName: "nextMarketId",
    })) as bigint;
    const h = await walletClient.writeContract({
      address: deployment.contracts.MarketRegistry,
      abi: REGISTRY_ABI,
      functionName: "createMarket",
      args: ["smoke-f4 YES", "PreResolvedOracle hardcoded YES", 2, expiry, 200n],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
    return beforeId;
  });
  const marketAAddr = (await publicClient.readContract({
    address: deployment.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "markets",
    args: [marketIdA],
  })) as Hex;
  console.log(`[smoke-f4] Market[${marketIdA}] (A) at ${marketAAddr}`);

  await timed("configure-pre-A", async () => {
    const h = await walletClient.writeContract({
      address: preOracleAddr,
      abi: PRE_ORACLE_ABI,
      functionName: "configure",
      args: [marketIdA, 1],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  await timed("set-adapter-A", async () => {
    const h = await walletClient.writeContract({
      address: deployment.contracts.ResolutionOracle,
      abi: RES_ORACLE_ABI,
      functionName: "setAdapter",
      args: [marketIdA, preOracleAddr],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });

  await timed("set-operator-A", async () => {
    const until = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const h = await walletClient.writeContract({
      address: deployment.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "setOperator",
      args: [marketAAddr, until],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  const betA = await timed("encrypt-bet-A", async () =>
    handleClient.encryptInput(BET_AMOUNT, "uint256", marketAAddr),
  );
  await timed("place-bet-A", async () => {
    const h = await walletClient.writeContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "placeBet",
      args: [1, betA.handle as Hex, betA.handleProof as Hex],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  await timed("wait-batch-A", async () => {
    console.log(`[smoke-f4] sleeping ${BATCH_WAIT_S}s for batch interval...`);
    await new Promise((res) => setTimeout(res, BATCH_WAIT_S * 1000));
  });
  await timed("publish-batch-A", async () => {
    const h = await walletClient.writeContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "publishBatch",
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  // Wait for expiry — we already burned ~65s waiting for the batch.
  await timed("wait-expiry-A", async () => {
    const expiry = (await publicClient.readContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "expiryTs",
    })) as bigint;
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (expiry > now) {
      const wait = Number(expiry - now) + 5;
      console.log(`[smoke-f4] sleeping ${wait}s for market expiry...`);
      await new Promise((res) => setTimeout(res, wait * 1000));
    }
  });
  await timed("resolve-oracle-A", async () => {
    const h = await walletClient.writeContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "resolveOracle",
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  const stateAfterResolveA = await publicClient.readContract({
    address: marketAAddr,
    abi: MARKET_ABI,
    functionName: "state",
  });
  console.log(`[smoke-f4] state after resolveOracle: ${stateAfterResolveA} (expect 3 = Resolving)`);

  // freezePool: fetch published-pool decryption proofs from Nox gateway.
  const freezeProofs = await timed("freeze-pool-A", async () => {
    const yesHandle = (await publicClient.readContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "yesPoolPublishedHandle",
    })) as Hex;
    const noHandle = (await publicClient.readContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "noPoolPublishedHandle",
    })) as Hex;
    const yesPub = await handleClient.publicDecrypt(yesHandle);
    const noPub = await handleClient.publicDecrypt(noHandle);
    console.log(`[smoke-f4] yes pool plaintext: ${yesPub.value}`);
    console.log(`[smoke-f4] no  pool plaintext: ${noPub.value}`);

    const h = await walletClient.writeContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "freezePool",
      args: [yesPub.decryptionProof as Hex, noPub.decryptionProof as Hex],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
    return {yes: yesPub.value as bigint, no: noPub.value as bigint};
  });
  const yesFrozen = (await publicClient.readContract({
    address: marketAAddr,
    abi: MARKET_ABI,
    functionName: "yesPoolFrozen",
  })) as bigint;
  if (yesFrozen !== freezeProofs.yes) {
    throw new Error(`yesPoolFrozen mismatch: ${yesFrozen} vs ${freezeProofs.yes}`);
  }
  if (yesFrozen !== BET_AMOUNT) {
    throw new Error(`yesPoolFrozen != BET_AMOUNT (${yesFrozen} vs ${BET_AMOUNT})`);
  }

  // Wait for the claim window to open (60s post-freeze).
  await timed("wait-claim-window-A", async () => {
    const opensAt = (await publicClient.readContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "claimWindowOpensAt",
    })) as bigint;
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (opensAt > now) {
      const wait = Number(opensAt - now) + 2;
      console.log(`[smoke-f4] sleeping ${wait}s for claim window...`);
      await new Promise((res) => setTimeout(res, wait * 1000));
    }
  });
  await timed("claim-winnings-A", async () => {
    const h = await walletClient.writeContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "claimWinnings",
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  const claimedA = (await publicClient.readContract({
    address: marketAAddr,
    abi: MARKET_ABI,
    functionName: "hasClaimed",
    args: [account.address],
  })) as boolean;
  if (!claimedA) throw new Error(`Market[${marketIdA}].hasClaimed(deployer) is false after claimWinnings`);
  console.log(`[smoke-f4] Market[${marketIdA}].hasClaimed = true ✓`);

  // ============================================================
  // Lifecycle B — INVALID refund path on a fresh market
  // ============================================================
  console.log(`\n[smoke-f4] === Lifecycle B: PreResolved INVALID → refund ===`);

  const marketIdB = await timed("create-market-B", async () => {
    const expiry = BigInt(Math.floor(Date.now() / 1000) + MARKET_EXPIRY_S);
    const beforeId = (await publicClient.readContract({
      address: deployment.contracts.MarketRegistry,
      abi: REGISTRY_ABI,
      functionName: "nextMarketId",
    })) as bigint;
    const h = await walletClient.writeContract({
      address: deployment.contracts.MarketRegistry,
      abi: REGISTRY_ABI,
      functionName: "createMarket",
      args: ["smoke-f4 INVALID", "PreResolvedOracle hardcoded INVALID", 2, expiry, 200n],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
    return beforeId;
  });
  const marketBAddr = (await publicClient.readContract({
    address: deployment.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "markets",
    args: [marketIdB],
  })) as Hex;
  console.log(`[smoke-f4] Market[${marketIdB}] (B) at ${marketBAddr}`);

  await timed("configure-pre-B", async () => {
    const h = await walletClient.writeContract({
      address: preOracleAddr,
      abi: PRE_ORACLE_ABI,
      functionName: "configure",
      args: [marketIdB, 2], // INVALID
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  await timed("set-adapter-B", async () => {
    const h = await walletClient.writeContract({
      address: deployment.contracts.ResolutionOracle,
      abi: RES_ORACLE_ABI,
      functionName: "setAdapter",
      args: [marketIdB, preOracleAddr],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  await timed("set-operator-B", async () => {
    const until = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const h = await walletClient.writeContract({
      address: deployment.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "setOperator",
      args: [marketBAddr, until],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  const betB = await timed("encrypt-bet-B", async () =>
    handleClient.encryptInput(BET_AMOUNT, "uint256", marketBAddr),
  );
  await timed("place-bet-B", async () => {
    const h = await walletClient.writeContract({
      address: marketBAddr,
      abi: MARKET_ABI,
      functionName: "placeBet",
      args: [1, betB.handle as Hex, betB.handleProof as Hex],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  await timed("wait-expiry-B", async () => {
    const expiry = (await publicClient.readContract({
      address: marketBAddr,
      abi: MARKET_ABI,
      functionName: "expiryTs",
    })) as bigint;
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (expiry > now) {
      const wait = Number(expiry - now) + 5;
      console.log(`[smoke-f4] sleeping ${wait}s for market B expiry...`);
      await new Promise((res) => setTimeout(res, wait * 1000));
    }
  });
  await timed("resolve-oracle-B", async () => {
    const h = await walletClient.writeContract({
      address: marketBAddr,
      abi: MARKET_ABI,
      functionName: "resolveOracle",
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  const stateB = (await publicClient.readContract({
    address: marketBAddr,
    abi: MARKET_ABI,
    functionName: "state",
  })) as number;
  if (Number(stateB) !== 6) throw new Error(`expected Invalid state (6), got ${stateB}`);
  console.log(`[smoke-f4] state after INVALID resolution: ${stateB} (Invalid) ✓`);

  await timed("refund-B", async () => {
    const h = await walletClient.writeContract({
      address: marketBAddr,
      abi: MARKET_ABI,
      functionName: "refundIfInvalid",
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  // After refund, user's bet handle is wiped from the market.
  const yesBetAfterRefund = (await publicClient.readContract({
    address: marketBAddr,
    abi: MARKET_ABI,
    functionName: "yesBet",
    args: [account.address],
  })) as Hex;
  if (yesBetAfterRefund !== "0x" + "0".repeat(64)) {
    throw new Error(`yesBet not cleared after refund: ${yesBetAfterRefund}`);
  }
  console.log(`[smoke-f4] yesBet cleared after refund ✓`);

  const totalMs = Math.round(performance.now() - overallStart);
  printSummary(totalMs);
  console.log(
    "GREEN — F4 lifecycles A (claim) and B (refund) validated against real Arb Sepolia + Nox infra",
  );

  // Suppress unused-import warnings — encodePacked/toHex are imported for
  // potential future use (manual handle-construction); not yet needed here.
  void encodePacked;
  void toHex;
}

main().catch((err) => {
  const totalMs = results.reduce((acc, r) => acc + r.latencyMs, 0);
  printSummary(totalMs);
  console.error(`\n[smoke-f4] FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  console.error("RED — see BUG_LOG.md");
  process.exit(1);
});
