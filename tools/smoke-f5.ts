/**
 * Phase F5 smoke test against real Arb Sepolia + real Nox + live 2-of-3 Safe.
 *
 * Mirrors smoke-f45 but targets MarketImpl v4 which ships the full
 * claimWinnings payout (Nox.mul/div/sub on-chain arithmetic).
 *
 * Key additions over smoke-f45:
 *   - Pre-run guard: verifies registry.marketImplementation() == v4
 *   - Verifies ClaimSettled event is emitted in the claim-winnings receipt
 *   - Verifies hasClaimed flag remains true
 *
 * Lifecycle A: YES happy path — winner claims, ClaimSettled emitted,
 *   cUSDC payout queued for async Nox Runner processing.
 * Lifecycle B: INVALID refund path — unchanged from smoke-f45.
 *
 * Pre-requisites: deploy-f5.ts must have run (MarketImpl v4 live in registry).
 */

import {readFileSync} from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeAbiParameters,
  encodeFunctionData,
  decodeEventLog,
  type Hex,
  type Log,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";
import {createViemHandleClient} from "@iexec-nox/handle";
import Safe from "@safe-global/protocol-kit";

const ARB_SEPOLIA_CHAIN_ID = 421614;
const WRAP_AMOUNT = 200n * 1_000_000n;
const BET_AMOUNT = 50n * 1_000_000n;
const BATCH_WAIT_S = 65;
const MARKET_EXPIRY_S = 90;

type Deployment = {
  chainId: number;
  contracts: {
    TestUSDC: Hex;
    ConfidentialUSDC: Hex;
    MarketRegistry: Hex;
    ResolutionOracle: Hex;
    PreResolvedOracle: Hex;
    MarketImplementation_v4?: Hex;
  };
  safe: {address: Hex; threshold: number; signers: Hex[]};
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
  const header = ["STEP".padEnd(30), "STATUS".padEnd(7), "LATENCY".padEnd(11), "DETAIL"].join(" | ");
  const sep = "-".repeat(header.length);
  console.log("\n" + sep + "\n" + header + "\n" + sep);
  for (const r of results) {
    const detail = r.detail.length > 60 ? r.detail.slice(0, 57) + "..." : r.detail;
    console.log([r.step.padEnd(30), r.status.padEnd(7), `${r.latencyMs}ms`.padEnd(11), detail].join(" | "));
  }
  console.log(sep + `\nTotal: ${totalMs}ms\n` + sep + "\n");
}

const CLAIM_SETTLED_ABI = parseAbi([
  "event ClaimSettled(address indexed user, uint8 outcome, bytes32 payoutHandle, bytes32 feeHandle)",
]);

function findClaimSettled(logs: readonly Log[], marketAddr: Hex): {payoutHandle: Hex; feeHandle: Hex} | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== marketAddr.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: CLAIM_SETTLED_ABI,
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === "ClaimSettled") {
        const args = decoded.args as {user: Hex; outcome: number; payoutHandle: Hex; feeHandle: Hex};
        return {payoutHandle: args.payoutHandle, feeHandle: args.feeHandle};
      }
    } catch {
      // not this log; continue
    }
  }
  return null;
}

const TUSDC_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
]);
const CUSDC_ABI = parseAbi([
  "function wrap(uint256 amount, bytes32 encryptedAmount, bytes inputProof) external returns (bytes32)",
  "function setOperator(address operator, uint48 until) external",
]);
const REGISTRY_ABI = parseAbi([
  "function createMarket(string question, string resolutionCriteria, uint8 oracleType, uint256 expiryTs, uint256 protocolFeeBps) external returns (uint256 id, address market)",
  "function nextMarketId() external view returns (uint256)",
  "function markets(uint256 id) external view returns (address)",
  "function marketImplementation() external view returns (address)",
]);
const RES_ORACLE_ABI = parseAbi(["function setAdapter(uint256 marketId, address adapter) external"]);
const PRE_ORACLE_ABI = parseAbi(["function configure(uint256 marketId, uint8 outcome) external"]);
const MARKET_ABI = parseAbi([
  "function placeBet(uint8 side, bytes32 encryptedAmount, bytes inputProof) external",
  "function publishBatch() external",
  "function resolveOracle() external",
  "function freezePool(bytes yesProof, bytes noProof) external",
  "function claimWinnings() external",
  "function refundIfInvalid() external returns (bytes32)",
  "function state() external view returns (uint8)",
  "function yesPoolFrozen() external view returns (uint256)",
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
  const PK2 = process.env["MULTISIG_SIGNER_2_PK"]?.trim() as Hex | undefined;
  if (!PK2) throw new Error("MULTISIG_SIGNER_2_PK missing in env");
  const account = privateKeyToAccount(privateKey);

  const deployment = JSON.parse(
    readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8"),
  ) as Deployment;
  if (deployment.chainId !== ARB_SEPOLIA_CHAIN_ID)
    throw new Error(`unexpected chainId ${deployment.chainId}`);
  if (!deployment.safe?.address) throw new Error("Safe not deployed; run deploy-multisig.ts first");

  console.log(`[smoke-f5] Deployer: ${account.address}`);
  console.log(
    `[smoke-f5] Safe:     ${deployment.safe.address} (${deployment.safe.threshold}-of-${deployment.safe.signers.length})`,
  );
  console.log(`[smoke-f5] cUSDC:    ${deployment.contracts.ConfidentialUSDC}`);
  console.log(`[smoke-f5] Registry: ${deployment.contracts.MarketRegistry}`);
  console.log(
    `[smoke-f5] MktImplV4:${deployment.contracts.MarketImplementation_v4 ?? "(not in deployments)"}`,
  );
  console.log(`[smoke-f5] ResOracle:${deployment.contracts.ResolutionOracle}\n`);

  const publicClient = createPublicClient({chain: arbitrumSepolia, transport: http(rpcUrl)});
  const walletClient = createWalletClient({account, chain: arbitrumSepolia, transport: http(rpcUrl)});
  const handleClient = await createViemHandleClient(walletClient);

  const safeSdkPK1 = await Safe.init({
    provider: rpcUrl,
    signer: privateKey,
    safeAddress: deployment.safe.address,
  });
  const safeSdkPK2 = await Safe.init({provider: rpcUrl, signer: PK2, safeAddress: deployment.safe.address});

  async function safeWrite(stepName: string, target: Hex, data: Hex): Promise<void> {
    await timed(stepName, async () => {
      let tx = await safeSdkPK1.createTransaction({transactions: [{to: target, value: "0", data}]});
      tx = await safeSdkPK1.signTransaction(tx);
      tx = await safeSdkPK2.signTransaction(tx);
      const exec = await safeSdkPK1.executeTransaction(tx);
      const hash =
        (exec as unknown as {hash?: Hex}).hash ??
        (exec as unknown as {transactionResponse?: {hash: Hex}}).transactionResponse?.hash;
      if (!hash) throw new Error(`Safe exec returned no hash for ${stepName}`);
      const r = await publicClient.waitForTransactionReceipt({hash});
      if (r.status !== "success") throw new Error(`${stepName} reverted: ${hash}`);
    });
  }

  // Guard: registry must point at v4 before running the F5 smoke.
  await timed("check-registry-impl-v4", async () => {
    const impl = (await publicClient.readContract({
      address: deployment.contracts.MarketRegistry,
      abi: REGISTRY_ABI,
      functionName: "marketImplementation",
    })) as Hex;
    const v4 = deployment.contracts.MarketImplementation_v4;
    if (!v4) throw new Error("MarketImplementation_v4 not in deployments — run deploy-f5.ts first");
    if (impl.toLowerCase() !== v4.toLowerCase()) {
      throw new Error(`registry.marketImplementation()=${impl} != v4=${v4}; run deploy-f5.ts first`);
    }
    console.log(`[smoke-f5] registry.marketImplementation() == v4 ✓`);
  });

  // Fresh PreResolvedOracle for this smoke run.
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
  console.log(`[smoke-f5] fresh PreOracle: ${preOracleAddr}`);

  // Replenish tUSDC + wrap for both lifecycles.
  await safeWrite(
    "safe-mint-tusdc",
    deployment.contracts.TestUSDC,
    encodeFunctionData({abi: TUSDC_ABI, functionName: "mint", args: [account.address, WRAP_AMOUNT * 4n]}),
  );
  await timed("approve-tusdc", async () => {
    const h = await walletClient.writeContract({
      address: deployment.contracts.TestUSDC,
      abi: TUSDC_ABI,
      functionName: "approve",
      args: [deployment.contracts.ConfidentialUSDC, WRAP_AMOUNT * 2n],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  for (const tag of ["A", "B"] as const) {
    const wh = await timed(`encrypt-wrap-${tag}`, async () =>
      handleClient.encryptInput(WRAP_AMOUNT, "uint256", deployment.contracts.ConfidentialUSDC),
    );
    await timed(`wrap-${tag}`, async () => {
      const h = await walletClient.writeContract({
        address: deployment.contracts.ConfidentialUSDC,
        abi: CUSDC_ABI,
        functionName: "wrap",
        args: [WRAP_AMOUNT, wh.handle as Hex, wh.handleProof as Hex],
      });
      await publicClient.waitForTransactionReceipt({hash: h});
    });
  }

  // ============================================================
  // Lifecycle A — YES happy path with F5 claimWinnings payout
  // ============================================================
  console.log(`\n[smoke-f5] === Lifecycle A: PreResolved YES — F5 on-chain payout ===`);

  const beforeIdA = (await publicClient.readContract({
    address: deployment.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "nextMarketId",
  })) as bigint;
  const expiryA = BigInt(Math.floor(Date.now() / 1000) + MARKET_EXPIRY_S);
  await safeWrite(
    "safe-create-market-A",
    deployment.contracts.MarketRegistry,
    encodeFunctionData({
      abi: REGISTRY_ABI,
      functionName: "createMarket",
      args: ["smoke-f5 YES", "PreResolvedOracle hardcoded YES", 2, expiryA, 200n],
    }),
  );
  const marketIdA = beforeIdA;
  const marketAAddr = (await publicClient.readContract({
    address: deployment.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "markets",
    args: [marketIdA],
  })) as Hex;
  console.log(`[smoke-f5] Market[${marketIdA}] (A) at ${marketAAddr}`);

  await timed("configure-pre-A", async () => {
    const h = await walletClient.writeContract({
      address: preOracleAddr,
      abi: PRE_ORACLE_ABI,
      functionName: "configure",
      args: [marketIdA, 1],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  await safeWrite(
    "safe-set-adapter-A",
    deployment.contracts.ResolutionOracle,
    encodeFunctionData({abi: RES_ORACLE_ABI, functionName: "setAdapter", args: [marketIdA, preOracleAddr]}),
  );
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
    console.log(`[smoke-f5] sleeping ${BATCH_WAIT_S}s for batch interval...`);
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
  await timed("wait-expiry-A", async () => {
    const expiry = (await publicClient.readContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "expiryTs",
    })) as bigint;
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (expiry > now) {
      const wait = Number(expiry - now) + 5;
      console.log(`[smoke-f5] sleeping ${wait}s for market expiry...`);
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
  await timed("freeze-pool-A", async () => {
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
    console.log(`[smoke-f5] yes pool plaintext: ${yesPub.value}`);
    console.log(`[smoke-f5] no  pool plaintext: ${noPub.value}`);
    const h = await walletClient.writeContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "freezePool",
      args: [yesPub.decryptionProof as Hex, noPub.decryptionProof as Hex],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
    const yesFrozen = (await publicClient.readContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "yesPoolFrozen",
    })) as bigint;
    if (yesFrozen !== BET_AMOUNT) throw new Error(`yesPoolFrozen=${yesFrozen} != BET_AMOUNT=${BET_AMOUNT}`);
  });
  await timed("wait-claim-window-A", async () => {
    const opensAt = (await publicClient.readContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "claimWindowOpensAt",
    })) as bigint;
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (opensAt > now) {
      const wait = Number(opensAt - now) + 2;
      console.log(`[smoke-f5] sleeping ${wait}s for claim window...`);
      await new Promise((res) => setTimeout(res, wait * 1000));
    }
  });

  // Core F5 step: claimWinnings with real Nox payout.
  let claimSettledHandles: {payoutHandle: Hex; feeHandle: Hex} | null = null;
  await timed("claim-winnings-A", async () => {
    const h = await walletClient.writeContract({
      address: marketAAddr,
      abi: MARKET_ABI,
      functionName: "claimWinnings",
    });
    const rc = await publicClient.waitForTransactionReceipt({hash: h});
    if (rc.status !== "success") throw new Error(`claimWinnings reverted: ${h}`);
    claimSettledHandles = findClaimSettled(rc.logs, marketAAddr);
    if (!claimSettledHandles) throw new Error("ClaimSettled event not found in receipt");
    if (claimSettledHandles.payoutHandle === "0x" + "0".repeat(64)) {
      throw new Error("ClaimSettled.payoutHandle is zero");
    }
  });
  console.log(`[smoke-f5] ClaimSettled.payoutHandle: ${claimSettledHandles!.payoutHandle}`);
  console.log(`[smoke-f5] ClaimSettled.feeHandle:    ${claimSettledHandles!.feeHandle}`);
  console.log(`[smoke-f5] Note: cUSDC balance delta is async (Nox Runner processes after tx)`);

  const claimedA = (await publicClient.readContract({
    address: marketAAddr,
    abi: MARKET_ABI,
    functionName: "hasClaimed",
    args: [account.address],
  })) as boolean;
  if (!claimedA) throw new Error(`Market[${marketIdA}].hasClaimed(deployer) is false after claimWinnings`);
  console.log(`[smoke-f5] Market[${marketIdA}].hasClaimed = true ✓`);

  // ============================================================
  // Lifecycle B — INVALID refund path (unchanged from F4.5)
  // ============================================================
  console.log(`\n[smoke-f5] === Lifecycle B: PreResolved INVALID → refund ===`);

  const beforeIdB = (await publicClient.readContract({
    address: deployment.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "nextMarketId",
  })) as bigint;
  const expiryB = BigInt(Math.floor(Date.now() / 1000) + MARKET_EXPIRY_S);
  await safeWrite(
    "safe-create-market-B",
    deployment.contracts.MarketRegistry,
    encodeFunctionData({
      abi: REGISTRY_ABI,
      functionName: "createMarket",
      args: ["smoke-f5 INVALID", "PreResolvedOracle hardcoded INVALID", 2, expiryB, 200n],
    }),
  );
  const marketIdB = beforeIdB;
  const marketBAddr = (await publicClient.readContract({
    address: deployment.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "markets",
    args: [marketIdB],
  })) as Hex;
  console.log(`[smoke-f5] Market[${marketIdB}] (B) at ${marketBAddr}`);

  await timed("configure-pre-B", async () => {
    const h = await walletClient.writeContract({
      address: preOracleAddr,
      abi: PRE_ORACLE_ABI,
      functionName: "configure",
      args: [marketIdB, 2],
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  await safeWrite(
    "safe-set-adapter-B",
    deployment.contracts.ResolutionOracle,
    encodeFunctionData({abi: RES_ORACLE_ABI, functionName: "setAdapter", args: [marketIdB, preOracleAddr]}),
  );
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
      console.log(`[smoke-f5] sleeping ${wait}s for market B expiry...`);
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
  console.log(`[smoke-f5] state after INVALID resolution: ${stateB} (Invalid) ✓`);
  await timed("refund-B", async () => {
    const h = await walletClient.writeContract({
      address: marketBAddr,
      abi: MARKET_ABI,
      functionName: "refundIfInvalid",
    });
    await publicClient.waitForTransactionReceipt({hash: h});
  });
  const yesBetAfterRefund = (await publicClient.readContract({
    address: marketBAddr,
    abi: MARKET_ABI,
    functionName: "yesBet",
    args: [account.address],
  })) as Hex;
  if (yesBetAfterRefund !== "0x" + "0".repeat(64)) {
    throw new Error(`yesBet not cleared after refund: ${yesBetAfterRefund}`);
  }
  console.log(`[smoke-f5] yesBet cleared after refund ✓`);

  const totalMs = Math.round(performance.now() - overallStart);
  printSummary(totalMs);
  console.log(
    "GREEN — F5 lifecycles A (claimWinnings + Nox payout) and B (refund) validated against real Arb Sepolia",
  );
}

main().catch((err) => {
  const totalMs = results.reduce((acc, r) => acc + r.latencyMs, 0);
  printSummary(totalMs);
  console.error(`\n[smoke-f5] FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  console.error("RED — see BUG_LOG.md");
  process.exit(1);
});
