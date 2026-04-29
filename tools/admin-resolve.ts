/**
 * tools/admin-resolve.ts — AdminOracle resolve flow CLI.
 *
 * Single command that walks an Admin-typed market through the full
 * commit-reveal-resolve sequence:
 *
 *   1. Validates marketId exists, oracleType=0, state ∈ {Open, Closed, Resolving}.
 *   2. Reads ResolutionOracle.adapterOf(marketId). If unwired (zero address),
 *      Safe-cosigns setAdapter(marketId, AdminOracle) as a preflight step.
 *      This recovers markets deployed before the create-route patch.
 *   3. Generates or accepts a 32-byte salt; computes
 *      keccak256(abi.encode(uint8 outcome, bytes32 salt)).
 *   4. Safe-cosigns AdminOracle.commit(marketId, hash).
 *   5. Sleeps REVEAL_DELAY (60s) + 5s buffer with a visible countdown.
 *   6. Safe-cosigns AdminOracle.reveal(marketId, outcome, salt).
 *   7. Direct EOA call: Market.resolveOracle().
 *   8. If state lands in Resolving (non-INVALID outcome), publicDecrypts
 *      the published handles via Nox SDK and submits Market.freezePool().
 *   9. Persists the full audit trail to tools/admin-resolve-history.json.
 *
 * Usage:
 *   pnpm tsx tools/admin-resolve.ts --market=16 --outcome=YES
 *   pnpm tsx tools/admin-resolve.ts --market=18 --outcome=NO --salt=0x<32 bytes hex>
 *
 * Env requirements:
 *   DEPLOYER_PRIVATE_KEY   Safe signer 1 + EOA caller for resolveOracle/freezePool
 *   MULTISIG_SIGNER_2_PK   Safe signer 2 (cosign for setAdapter/commit/reveal)
 *   ARB_SEPOLIA_RPC_URL    optional (default: public Arbitrum Sepolia RPC)
 */

import {randomBytes} from "node:crypto";
import {readFileSync, existsSync, writeFileSync} from "node:fs";

import Safe from "@safe-global/protocol-kit";
import {createViemHandleClient} from "@iexec-nox/handle";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";

const ARB_SEPOLIA_CHAIN_ID = 421614;
const REVEAL_DELAY_S = 60;
const REVEAL_BUFFER_S = 5;

const STATE_NAMES = ["Created", "Open", "Closed", "Resolving", "Resolved", "ClaimWindow", "Invalid"];
const ORACLE_NAMES = ["Admin", "Chainlink", "PreResolved"];
const HISTORY_PATH = `${process.cwd()}/tools/admin-resolve-history.json`;

type OutcomeName = "YES" | "NO" | "INVALID";

interface CliArgs {
  market: bigint;
  outcome: OutcomeName;
  salt: Hex | null;
}

interface HistoryEntry {
  ts: string;
  marketId: string;
  marketAddress: Address;
  outcomeName: OutcomeName;
  outcomeNum: number;
  salt: Hex;
  commitmentHash: Hex;
  setAdapterTx: Hex | null;
  commitTx: Hex;
  revealTx: Hex;
  resolveTx: Hex;
  freezePoolTx: Hex | null;
  finalState: number;
  finalStateName: string;
}

function outcomeNum(name: OutcomeName): 0 | 1 | 2 {
  if (name === "NO") return 0;
  if (name === "YES") return 1;
  return 2;
}

function parseArgs(argv: string[]): CliArgs {
  let market: bigint | null = null;
  let outcome: OutcomeName | null = null;
  let salt: Hex | null = null;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: admin-resolve --market=N --outcome=YES|NO|INVALID [--salt=0x<64hex>]\n\n` +
          `Env:\n  DEPLOYER_PRIVATE_KEY  required\n  MULTISIG_SIGNER_2_PK  required\n  ARB_SEPOLIA_RPC_URL   optional`,
      );
      process.exit(0);
    } else if (arg.startsWith("--market=")) {
      const v = arg.slice("--market=".length).trim();
      if (!/^\d+$/.test(v)) throw new Error(`--market must be a positive integer (got "${v}")`);
      market = BigInt(v);
    } else if (arg.startsWith("--outcome=")) {
      const v = arg.slice("--outcome=".length).trim().toUpperCase();
      if (v !== "YES" && v !== "NO" && v !== "INVALID") {
        throw new Error(`--outcome must be YES, NO, or INVALID (got "${v}")`);
      }
      outcome = v;
    } else if (arg.startsWith("--salt=")) {
      const v = arg.slice("--salt=".length).trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(v))
        throw new Error(`--salt must be a 0x-prefixed 32-byte hex (got "${v}")`);
      salt = v as Hex;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg} (try --help)`);
    }
  }
  if (market === null) throw new Error("--market is required (try --help)");
  if (outcome === null) throw new Error("--outcome is required (try --help)");
  return {market, outcome, salt};
}

type Deployment = {
  chainId: number;
  contracts: {
    MarketRegistry: Hex;
    ResolutionOracle: Hex;
    AdminOracle: Hex;
  };
  safe: {address: Hex};
};

const REGISTRY_ABI = parseAbi(["function markets(uint256) view returns (address)"]);
const RES_ORACLE_ABI = parseAbi([
  "function adapterOf(uint256) view returns (address)",
  "function setAdapter(uint256 marketId, address adapter) external",
]);
const ADMIN_ORACLE_ABI = parseAbi([
  "function commit(uint256 marketId, bytes32 commitmentHash) external",
  "function reveal(uint256 marketId, uint8 outcome, bytes32 salt) external",
  "function commitments(uint256) view returns (bytes32 hash, uint256 committedAt, bool revealed, uint8 outcome)",
]);
const MARKET_ABI = parseAbi([
  "function oracleType() view returns (uint8)",
  "function state() view returns (uint8)",
  "function question() view returns (string)",
  "function expiryTs() view returns (uint256)",
  "function resolveOracle() external",
  "function freezePool(bytes yesProof, bytes noProof) external",
  "function yesPoolPublishedHandle() view returns (bytes32)",
  "function noPoolPublishedHandle() view returns (bytes32)",
]);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function countdown(seconds: number): Promise<void> {
  for (let s = seconds; s > 0; s--) {
    process.stdout.write(`\r[admin-resolve]   waiting ${s}s for REVEAL_DELAY…   `);
    await sleep(1_000);
  }
  process.stdout.write(`\r[admin-resolve]   REVEAL_DELAY elapsed.                \n`);
}

function appendHistory(entry: HistoryEntry): void {
  let arr: HistoryEntry[] = [];
  if (existsSync(HISTORY_PATH)) {
    try {
      arr = JSON.parse(readFileSync(HISTORY_PATH, "utf8")) as HistoryEntry[];
    } catch {
      arr = [];
    }
  }
  arr.push(entry);
  writeFileSync(HISTORY_PATH, JSON.stringify(arr, null, 2));
  console.log(`[admin-resolve]   history appended → ${HISTORY_PATH}`);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));

  const RPC = process.env["ARB_SEPOLIA_RPC_URL"]?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
  const PK1 = process.env["DEPLOYER_PRIVATE_KEY"]?.trim() as Hex | undefined;
  const PK2 = process.env["MULTISIG_SIGNER_2_PK"]?.trim() as Hex | undefined;
  if (!PK1 || !PK2) throw new Error("DEPLOYER_PRIVATE_KEY / MULTISIG_SIGNER_2_PK missing");

  const dep = JSON.parse(
    readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8"),
  ) as Deployment;
  if (dep.chainId !== ARB_SEPOLIA_CHAIN_ID) throw new Error(`bad chainId ${dep.chainId}`);

  const account = privateKeyToAccount(PK1);
  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const wallet = createWalletClient({account, chain: arbitrumSepolia, transport: http(RPC)});
  const nox = await createViemHandleClient(wallet);
  const sdk1 = await Safe.init({provider: RPC, signer: PK1, safeAddress: dep.safe.address});
  const sdk2 = await Safe.init({provider: RPC, signer: PK2, safeAddress: dep.safe.address});

  async function safeWrite(label: string, target: Hex, data: Hex): Promise<Hex> {
    let tx = await sdk1.createTransaction({transactions: [{to: target, value: "0", data}]});
    tx = await sdk1.signTransaction(tx);
    tx = await sdk2.signTransaction(tx);
    const exec = await sdk1.executeTransaction(tx);
    const hash =
      (exec as unknown as {hash?: Hex}).hash ??
      (exec as unknown as {transactionResponse?: {hash: Hex}}).transactionResponse?.hash;
    if (!hash) throw new Error(`Safe exec returned no hash (${label})`);
    const rc = await pub.waitForTransactionReceipt({hash});
    if (rc.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`[admin-resolve]   ${label} ✓ ${hash}`);
    return hash;
  }

  console.log(`[admin-resolve] market=${args.market} outcome=${args.outcome}`);
  console.log(`[admin-resolve] caller=${account.address}`);
  console.log(`[admin-resolve] safe=${dep.safe.address}`);

  // ── 1. Read market state + sanity-check ──
  const marketAddr = (await pub.readContract({
    address: dep.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "markets",
    args: [args.market],
  })) as Address;
  if (!marketAddr || marketAddr === "0x0000000000000000000000000000000000000000") {
    throw new Error(`market #${args.market} does not exist on this registry`);
  }
  const ot = Number(
    await pub.readContract({address: marketAddr, abi: MARKET_ABI, functionName: "oracleType"}),
  );
  if (ot !== 0) {
    throw new Error(
      `market #${args.market} has oracleType=${ot} (${ORACLE_NAMES[ot]}), not Admin (0). admin-resolve only handles Admin markets.`,
    );
  }
  let state = Number(await pub.readContract({address: marketAddr, abi: MARKET_ABI, functionName: "state"}));
  console.log(`[admin-resolve]   market addr=${marketAddr}, state=${state} (${STATE_NAMES[state]})`);
  if (state !== 1 && state !== 2 && state !== 3) {
    throw new Error(
      `market state ${state} (${STATE_NAMES[state]}) cannot transition through resolution (need Open=1, Closed=2, or Resolving=3)`,
    );
  }
  const question = await pub.readContract({address: marketAddr, abi: MARKET_ABI, functionName: "question"});
  console.log(`[admin-resolve]   question="${question.slice(0, 80)}${question.length > 80 ? "…" : ""}"`);

  // Existing AdminOracle commitment? If revealed already, refuse to proceed.
  // If committed-not-revealed, reuse it (operator must pass the matching salt).
  const existing = (await pub.readContract({
    address: dep.contracts.AdminOracle,
    abi: ADMIN_ORACLE_ABI,
    functionName: "commitments",
    args: [args.market],
  })) as readonly [Hex, bigint, boolean, number];
  const [existingHash, committedAt, revealed] = existing;
  if (revealed) {
    throw new Error(
      `market #${args.market} already revealed — re-resolution is not supported on AdminOracle (one commit per market)`,
    );
  }

  // ── 2. Preflight: setAdapter if unwired ──
  const adapter = (await pub.readContract({
    address: dep.contracts.ResolutionOracle,
    abi: RES_ORACLE_ABI,
    functionName: "adapterOf",
    args: [args.market],
  })) as Address;
  let setAdapterTx: Hex | null = null;
  if (adapter === "0x0000000000000000000000000000000000000000") {
    console.log(`[admin-resolve] step preflight: ResolutionOracle.setAdapter(${args.market}, AdminOracle)`);
    const data = encodeFunctionData({
      abi: RES_ORACLE_ABI,
      functionName: "setAdapter",
      args: [args.market, dep.contracts.AdminOracle],
    });
    setAdapterTx = await safeWrite("setAdapter", dep.contracts.ResolutionOracle, data);
  } else if (adapter.toLowerCase() !== dep.contracts.AdminOracle.toLowerCase()) {
    throw new Error(
      `market #${args.market} adapter is ${adapter}, not the AdminOracle ${dep.contracts.AdminOracle}. Cannot proceed safely.`,
    );
  } else {
    console.log(`[admin-resolve]   adapter already wired to AdminOracle`);
  }

  // ── 3. Salt + commitment hash ──
  let salt: Hex;
  if (args.salt) {
    salt = args.salt;
    console.log(`[admin-resolve]   using operator-supplied salt: ${salt}`);
  } else {
    salt = `0x${Buffer.from(randomBytes(32)).toString("hex")}` as Hex;
    console.log(`[admin-resolve]   generated random salt: ${salt}`);
    console.log(`[admin-resolve]   ↑ SAVE THIS — required to recover commit if interrupted`);
  }
  const outNum = outcomeNum(args.outcome);
  const commitmentHash = keccak256(
    encodeAbiParameters([{type: "uint8"}, {type: "bytes32"}], [outNum, salt]),
  ) as Hex;
  console.log(`[admin-resolve]   commitmentHash=${commitmentHash}`);

  // ── 4. Commit (or reuse existing commitment) ──
  let commitTx: Hex;
  let waitSeconds: number;
  if (committedAt > BigInt(0)) {
    if (existingHash !== commitmentHash) {
      throw new Error(
        `market #${args.market} already has a different commitment hash on AdminOracle. Pass the matching --salt or wait for a fresh deploy.`,
      );
    }
    console.log(`[admin-resolve]   reusing existing commit (committed at ${committedAt})`);
    const elapsed = Math.floor(Date.now() / 1000) - Number(committedAt);
    waitSeconds = Math.max(0, REVEAL_DELAY_S - elapsed) + REVEAL_BUFFER_S;
    commitTx = `0x${"0".repeat(64)}` as Hex;
  } else {
    console.log(`[admin-resolve] step 1/4: AdminOracle.commit`);
    const data = encodeFunctionData({
      abi: ADMIN_ORACLE_ABI,
      functionName: "commit",
      args: [args.market, commitmentHash],
    });
    commitTx = await safeWrite("commit", dep.contracts.AdminOracle, data);
    waitSeconds = REVEAL_DELAY_S + REVEAL_BUFFER_S;
  }

  // ── 5. Wait REVEAL_DELAY ──
  if (waitSeconds > 0) {
    console.log(`[admin-resolve] step 2/4: REVEAL_DELAY (${waitSeconds}s)`);
    await countdown(waitSeconds);
  }

  // ── 6. Reveal ──
  console.log(`[admin-resolve] step 3/4: AdminOracle.reveal`);
  const revealData = encodeFunctionData({
    abi: ADMIN_ORACLE_ABI,
    functionName: "reveal",
    args: [args.market, outNum, salt],
  });
  const revealTx = await safeWrite("reveal", dep.contracts.AdminOracle, revealData);

  // ── 7. resolveOracle (anyone can call; permissionless trigger) ──
  console.log(`[admin-resolve] step 4/4: Market.resolveOracle`);
  const resolveTx = await wallet.writeContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: "resolveOracle",
  });
  await pub.waitForTransactionReceipt({hash: resolveTx});
  console.log(`[admin-resolve]   resolveOracle ✓ ${resolveTx}`);
  state = Number(await pub.readContract({address: marketAddr, abi: MARKET_ABI, functionName: "state"}));
  console.log(`[admin-resolve]   state after resolveOracle: ${state} (${STATE_NAMES[state]})`);

  // ── 8. freezePool if needed ──
  let freezePoolTx: Hex | null = null;
  if (state === 3) {
    console.log(
      `[admin-resolve] post: freezePool (state=Resolving means non-INVALID outcome — finalize via Nox publicDecrypt)`,
    );
    const yesHandle = (await pub.readContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "yesPoolPublishedHandle",
    })) as Hex;
    const noHandle = (await pub.readContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "noPoolPublishedHandle",
    })) as Hex;
    const yesPub = await nox.publicDecrypt(yesHandle);
    const noPub = await nox.publicDecrypt(noHandle);
    console.log(`[admin-resolve]   yes plain=${yesPub.value}, no plain=${noPub.value}`);
    freezePoolTx = await wallet.writeContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "freezePool",
      args: [yesPub.decryptionProof as Hex, noPub.decryptionProof as Hex],
    });
    await pub.waitForTransactionReceipt({hash: freezePoolTx});
    console.log(`[admin-resolve]   freezePool ✓ ${freezePoolTx}`);
    state = Number(await pub.readContract({address: marketAddr, abi: MARKET_ABI, functionName: "state"}));
    console.log(`[admin-resolve]   state after freezePool: ${state} (${STATE_NAMES[state]})`);
  }

  // ── 9. Persist + summary ──
  const entry: HistoryEntry = {
    ts: new Date().toISOString(),
    marketId: args.market.toString(),
    marketAddress: marketAddr,
    outcomeName: args.outcome,
    outcomeNum: outNum,
    salt,
    commitmentHash,
    setAdapterTx,
    commitTx,
    revealTx,
    resolveTx,
    freezePoolTx,
    finalState: state,
    finalStateName: STATE_NAMES[state] ?? `unknown(${state})`,
  };
  appendHistory(entry);

  const arbiscan = `https://sepolia.arbiscan.io/address/${marketAddr}`;
  console.log(`\n[admin-resolve] ============================================================`);
  console.log(`[admin-resolve] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[admin-resolve] Market #${args.market} resolved.`);
  console.log(`[admin-resolve]   outcome:    ${args.outcome} (${outNum})`);
  console.log(`[admin-resolve]   final state: ${state} (${STATE_NAMES[state]})`);
  console.log(`[admin-resolve]   address:    ${marketAddr}`);
  console.log(`[admin-resolve]   arbiscan:   ${arbiscan}`);
  if (state === 5) console.log(`[admin-resolve]   /portfolio: winning bettors can now claim`);
  if (state === 6)
    console.log(
      `[admin-resolve]   /portfolio: bettors can refund (winning side had zero or outcome was INVALID)`,
    );
}

main().catch((e) => {
  console.error("[admin-resolve] FAILED:", e);
  process.exit(1);
});
