// SPDX-License-Identifier: MIT
//
// verify-claim-flow.ts — end-to-end verification of the demo's claim path.
//
// Walks the exact lifecycle the demo recording exercises: claimWinnings()
// on chain → ClaimSettled event parsed → claimed[user] toggled → Nox
// publicDecrypt of the payout handle → /api/attestation/generate signs
// the envelope → ClaimVerifier.verifyAttestation recovers every field
// on-chain. If this passes 16/16, the demo recording's claim segment will
// also work.
//
// Modes:
//   --existing-market=N  Skip seed; claim against Market #N. ~30s.
//   --auto               Force seeding via tools/seed-claimable-market.ts
//                        --stage=claimable. ~3-4 min.
//   (default)            Auto-detect: if deployer has a claimable position
//                        on any recent market, use it; otherwise fall back
//                        to --auto.
//
// Required env:
//   DEPLOYER_PRIVATE_KEY  signer for the claim tx + matches ClaimVerifier.attestationSigner
//   ARB_SEPOLIA_RPC_URL   optional (default: public Arb Sepolia RPC)
//
// Required runtime:
//   - dev server at http://localhost:3000 (used for /api/attestation/generate)
//
// Transcript saved to verification-output/claim-flow-{stamp}/transcript.txt

import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";

import {createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";
import {createViemHandleClient} from "@iexec-nox/handle";

const DEV_SERVER = process.env.DEV_SERVER_URL ?? "http://localhost:3000";
const ARB_SCAN = "https://sepolia.arbiscan.io";

// ─── CLI ──────────────────────────────────────────────────────────────────
type Mode = "auto" | "existing" | "default";
interface CliArgs {
  mode: Mode;
  existingMarketId?: bigint;
}
function parseArgs(argv: string[]): CliArgs {
  let mode: Mode = "default";
  let existingMarketId: bigint | undefined;
  for (const arg of argv) {
    if (arg === "--auto") mode = "auto";
    else if (arg.startsWith("--existing-market=")) {
      const v = arg.slice("--existing-market=".length).trim();
      if (!/^\d+$/.test(v)) throw new Error(`--existing-market must be a positive integer (got "${v}")`);
      existingMarketId = BigInt(v);
      mode = "existing";
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: verify-claim-flow [--auto | --existing-market=N]\n\n` +
          `Default behavior: detect a claimable position; fall back to --auto if none.\n` +
          `--auto seeds a fresh market via tools/seed-claimable-market.ts --stage=claimable.`,
      );
      process.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg} (try --help)`);
    }
  }
  return {mode, existingMarketId};
}

// ─── Output ───────────────────────────────────────────────────────────────
const runStartedAt = new Date();
const stamp = runStartedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUTDIR = `${process.cwd()}/verification-output/claim-flow-${stamp}`;
mkdirSync(OUTDIR, {recursive: true});
const TRANSCRIPT = `${OUTDIR}/transcript.txt`;
writeFileSync(TRANSCRIPT, "");

const C = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function log(...parts: unknown[]): void {
  const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  process.stdout.write(line + "\n");
  appendFileSync(TRANSCRIPT, line.replace(/\x1b\[[0-9;]*m/g, "") + "\n");
}

function box(title: string): void {
  const bar = "═".repeat(72);
  log("");
  log(`${C.cyan}╔${bar}╗${C.reset}`);
  log(`${C.cyan}║${C.reset}  ${C.bold}${title.padEnd(70)}${C.reset}${C.cyan}║${C.reset}`);
  log(`${C.cyan}╚${bar}╝${C.reset}`);
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}
const allChecks: CheckResult[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  const icon = pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  log(`  ${icon} ${name}${detail ? ` (${detail})` : ""}`);
  allChecks.push({name, pass, detail});
}

// ─── ABIs ─────────────────────────────────────────────────────────────────
const REGISTRY_ABI = parseAbi([
  "function nextMarketId() view returns (uint256)",
  "function markets(uint256) view returns (address)",
]);
const MARKET_ABI = parseAbi([
  "function state() view returns (uint8)",
  "function outcome() view returns (uint8)",
  "function claimWindowOpensAt() view returns (uint256)",
  "function claimed(address) view returns (bool)",
  "function yesBet(address) view returns (bytes32)",
  "function noBet(address) view returns (bytes32)",
  "function claimWinnings() external",
  "event ClaimSettled(address indexed user, uint8 outcome, bytes32 payoutHandle, bytes32 feeHandle)",
]);
const VERIFIER_ABI = parseAbi([
  "function attestationSigner() view returns (address)",
  "function verifyAttestation(bytes attestationData, bytes signature) view returns (address user, uint256 marketId, uint8 outcome, bytes32 payoutCommitment, uint256 timestamp, address recipient, uint256 nonce)",
]);

const ZERO_BYTES32: Hex = `0x${"0".repeat(64)}`;
const STATE_NAMES = ["Created", "Open", "Closed", "Resolving", "Resolved", "ClaimWindow", "Invalid"];

interface Deployment {
  chainId: number;
  contracts: {MarketRegistry: Hex; ClaimVerifier: Hex};
}

// ─── Auto-detect a claimable target by scanning recent markets ────────────
async function findClaimableMarket(
  pub: ReturnType<typeof createPublicClient>,
  registry: Hex,
  deployer: Address,
): Promise<bigint | null> {
  const next = (await pub.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "nextMarketId",
  })) as bigint;
  // Scan newest 10 markets (cheap) for a ClaimWindow market where the
  // deployer has an unclaimed winning bet handle.
  const stop = next > 10n ? next - 10n : 1n;
  for (let i = next - 1n; i >= stop; i--) {
    if (i <= 0n) break;
    try {
      const addr = (await pub.readContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: "markets",
        args: [i],
      })) as Address;
      if (!addr || addr === "0x0000000000000000000000000000000000000000") continue;
      const state = Number(await pub.readContract({address: addr, abi: MARKET_ABI, functionName: "state"}));
      if (state !== 5) continue; // not ClaimWindow
      const claimedAlready = (await pub.readContract({
        address: addr,
        abi: MARKET_ABI,
        functionName: "claimed",
        args: [deployer],
      })) as boolean;
      if (claimedAlready) continue;
      const out = Number(await pub.readContract({address: addr, abi: MARKET_ABI, functionName: "outcome"}));
      const winningSideBet = (await pub.readContract({
        address: addr,
        abi: MARKET_ABI,
        functionName: out === 1 ? "yesBet" : "noBet",
        args: [deployer],
      })) as Hex;
      if (winningSideBet === ZERO_BYTES32) continue;
      return i;
    } catch {
      // skip read failures, keep scanning
    }
  }
  return null;
}

// ─── Spawn seed-claimable-market ───────────────────────────────────────────
function runSeedScript(): bigint {
  log(`${C.dim}  spawning: tools/seed-claimable-market.ts --stage=claimable …${C.reset}`);
  const result = spawnSync(
    "node",
    ["--env-file=.env", "--import", "tsx/esm", "tools/seed-claimable-market.ts", "--stage=claimable"],
    {cwd: process.cwd(), encoding: "utf8", stdio: ["inherit", "pipe", "inherit"]},
  );
  if (result.status !== 0) {
    throw new Error(`seed-claimable-market exited with code ${result.status}`);
  }
  // Parse the seed script's "Market #N ready for claim by" line.
  const match = result.stdout.match(/Market #(\d+) ready for claim by/);
  const captured = match?.[1];
  if (!captured) throw new Error(`seed-claimable-market output didn't match expected pattern`);
  return BigInt(captured);
}

interface AttestationEnvelope {
  payload?: {
    user: Address;
    marketId: string;
    outcome: number;
    payoutCommitment: Hex;
    timestamp: string;
    recipient: Address;
    nonce: string;
    tdxMeasurement: Hex;
  };
  encodedData?: Hex;
  signature?: Hex;
  signer?: Address;
  error?: string;
}
type DecodedAttestation = readonly [Address, bigint, number, Hex, bigint, Address, bigint];

// ─── Main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));

  log(`${C.bold}DarkOdds claim-flow verifier${C.reset}`);
  log(`${C.dim}  started: ${runStartedAt.toISOString()}${C.reset}`);
  log(`${C.dim}  output:  ${OUTDIR}${C.reset}`);

  // Env + deployment
  const RPC = process.env.ARB_SEPOLIA_RPC_URL?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
  const PK1 = process.env.DEPLOYER_PRIVATE_KEY?.trim() as Hex | undefined;
  if (!PK1) throw new Error("DEPLOYER_PRIVATE_KEY missing");
  const deployer = privateKeyToAccount(PK1);
  const dep = JSON.parse(
    readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8"),
  ) as Deployment;

  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const wallet = createWalletClient({account: deployer, chain: arbitrumSepolia, transport: http(RPC)});
  const nox = await createViemHandleClient(wallet);

  log(`  deployer: ${deployer.address}`);
  log(`  rpc:      ${RPC}`);
  log(`  registry: ${dep.contracts.MarketRegistry}`);
  log(`  verifier: ${dep.contracts.ClaimVerifier}`);
  log(`  mode:     ${args.mode}${args.existingMarketId ? ` (market #${args.existingMarketId})` : ""}`);

  // ─── STEP 1 — Resolve target market ────────────────────────────────────
  box("STEP 1 — Resolve target claimable market");
  let marketId: bigint;
  if (args.mode === "existing") {
    marketId = args.existingMarketId!;
    log(`  using operator-supplied market #${marketId}`);
  } else if (args.mode === "auto") {
    log(`  forcing seed via tools/seed-claimable-market.ts (~3-4 min)…`);
    marketId = runSeedScript();
    log(`  seeded market #${marketId}`);
  } else {
    log(`  scanning recent markets for unclaimed winning position…`);
    const found = await findClaimableMarket(pub, dep.contracts.MarketRegistry, deployer.address);
    if (found !== null) {
      marketId = found;
      log(`  ${C.green}found existing claimable market #${marketId}${C.reset}`);
    } else {
      log(`  ${C.yellow}no existing claimable position; falling back to --auto seed${C.reset}`);
      marketId = runSeedScript();
      log(`  seeded market #${marketId}`);
    }
  }

  const marketAddr = (await pub.readContract({
    address: dep.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "markets",
    args: [marketId],
  })) as Address;
  if (!marketAddr || marketAddr === "0x0000000000000000000000000000000000000000") {
    check(`Market #${marketId} resolves to a deployed clone`, false, `registry returned 0x0`);
    return finish(t0);
  }
  check(`Market #${marketId} resolves to a deployed clone`, true, marketAddr);
  log(`  arbiscan:    ${ARB_SCAN}/address/${marketAddr}`);

  // ─── STEP 2 — Pre-claim state reads ───────────────────────────────────
  box("STEP 2 — Pre-claim state reads");
  const stateBefore = Number(
    await pub.readContract({address: marketAddr, abi: MARKET_ABI, functionName: "state"}),
  );
  check(
    "Market.state() == ClaimWindow",
    stateBefore === 5,
    `state=${stateBefore} (${STATE_NAMES[stateBefore] ?? "?"})`,
  );

  const opensAt = (await pub.readContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: "claimWindowOpensAt",
  })) as bigint;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  check(
    "block.timestamp >= claimWindowOpensAt",
    nowSec >= opensAt,
    `now=${nowSec}, opens=${opensAt}, delta=${nowSec - opensAt}s`,
  );

  const outcomeOnChain = Number(
    await pub.readContract({address: marketAddr, abi: MARKET_ABI, functionName: "outcome"}),
  );
  log(
    `  market outcome: ${outcomeOnChain} (${outcomeOnChain === 1 ? "YES" : outcomeOnChain === 0 ? "NO" : "INVALID"})`,
  );

  const winningSideFn = outcomeOnChain === 1 ? "yesBet" : "noBet";
  const winningBet = (await pub.readContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: winningSideFn,
    args: [deployer.address],
  })) as Hex;
  check(
    "Deployer has bet handle on winning side",
    winningBet !== ZERO_BYTES32,
    `${winningSideFn}=${winningBet.slice(0, 18)}…`,
  );

  const claimedBefore = (await pub.readContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: "claimed",
    args: [deployer.address],
  })) as boolean;
  check("claimed[deployer] == false (not yet claimed)", !claimedBefore);

  // ─── STEP 3 — Submit claimWinnings() ──────────────────────────────────
  box("STEP 3 — Submit claimWinnings()");
  let txHash: Hex;
  try {
    txHash = await wallet.writeContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "claimWinnings",
    });
    check("claimWinnings tx submitted", true, `tx=${txHash}`);
  } catch (err) {
    check("claimWinnings tx submitted", false, err instanceof Error ? err.message.slice(0, 120) : "unknown");
    return finish(t0);
  }
  log(`  ${C.dim}arbiscan: ${ARB_SCAN}/tx/${txHash}${C.reset}`);

  // ─── STEP 4 — Wait for receipt + parse ClaimSettled ───────────────────
  box("STEP 4 — Receipt + ClaimSettled event");
  let receivedSettlement: {payoutHandle: Hex; outcome: number; user: Address; feeHandle: Hex} | null = null;
  try {
    const rc = await pub.waitForTransactionReceipt({hash: txHash, timeout: 30_000});
    check("Tx receipt confirmed within 30s", rc.status === "success", `status=${rc.status}`);
    if (rc.status !== "success") return finish(t0);

    // Parse ClaimSettled. Use viem's decodeEventLog via abi reflection.
    const {decodeEventLog} = await import("viem");
    for (const evLog of rc.logs) {
      if (evLog.address.toLowerCase() !== marketAddr.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({abi: MARKET_ABI, ...evLog});
        if (decoded.eventName === "ClaimSettled") {
          const a = decoded.args as {user: Address; outcome: number; payoutHandle: Hex; feeHandle: Hex};
          receivedSettlement = a;
          break;
        }
      } catch {
        // not our event
      }
    }
    check("ClaimSettled event present in receipt", receivedSettlement !== null);
    if (!receivedSettlement) return finish(t0);
    check(
      "ClaimSettled.user == deployer",
      receivedSettlement.user.toLowerCase() === deployer.address.toLowerCase(),
      `${receivedSettlement.user} == ${deployer.address}`,
    );
    check(
      "ClaimSettled.outcome matches market outcome",
      receivedSettlement.outcome === outcomeOnChain,
      `${receivedSettlement.outcome} == ${outcomeOnChain}`,
    );
  } catch (err) {
    check(
      "Tx receipt confirmed within 30s",
      false,
      err instanceof Error ? err.message.slice(0, 120) : "unknown",
    );
    return finish(t0);
  }

  // ─── STEP 5 — Post-claim state reads ──────────────────────────────────
  box("STEP 5 — Post-claim state reads");
  const claimedAfter = (await pub.readContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: "claimed",
    args: [deployer.address],
  })) as boolean;
  check("claimed[deployer] == true post-tx", claimedAfter);

  // Decrypt payout handle — confirms the settlement produced a non-zero
  // payout. Use `decrypt` (user-bound) not `publicDecrypt`: Market.sol
  // grants the payout handle to msg.sender via Nox.allow(), not via
  // allowPublicDecryption. The Nox client handles the auth signature
  // internally using the wallet we passed at createViemHandleClient.
  let decryptedPayout: bigint | null = null;
  try {
    const out = (await nox.decrypt(receivedSettlement!.payoutHandle)) as {value: unknown};
    if (typeof out.value === "bigint") decryptedPayout = out.value;
  } catch (err) {
    log(`  ${C.dim}decrypt error: ${err instanceof Error ? err.message : String(err)}${C.reset}`);
  }
  check(
    "nox.decrypt(payoutHandle) succeeds",
    decryptedPayout !== null,
    decryptedPayout !== null ? `payout=${decryptedPayout}` : "decrypt failed",
  );
  if (decryptedPayout !== null) {
    check("Decrypted payout > 0", decryptedPayout > 0n, `${decryptedPayout} > 0`);
  }

  // ─── STEP 6 — /api/attestation/generate (bearer mode) ─────────────────
  box("STEP 6 — /api/attestation/generate");
  let envelope: AttestationEnvelope | null = null;
  try {
    const res = await fetch(`${DEV_SERVER}/api/attestation/generate`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({marketId: marketId.toString(), claimTx: txHash, bearer: true}),
    });
    envelope = (await res.json()) as AttestationEnvelope;
    check(
      "/api/attestation/generate returns envelope",
      Boolean(envelope?.payload && envelope?.encodedData && envelope?.signature),
      envelope?.error ?? "ok",
    );
  } catch (err) {
    check(
      "/api/attestation/generate reachable",
      false,
      `${err instanceof Error ? err.message.slice(0, 120) : "unknown"} (is dev server running on ${DEV_SERVER}?)`,
    );
    return finish(t0);
  }
  if (!envelope?.encodedData || !envelope?.signature) return finish(t0);

  // ─── STEP 7 — ClaimVerifier.verifyAttestation round-trip ──────────────
  box("STEP 7 — ClaimVerifier.verifyAttestation");
  const verifierSigner = (await pub.readContract({
    address: dep.contracts.ClaimVerifier,
    abi: VERIFIER_ABI,
    functionName: "attestationSigner",
  })) as Address;
  check(
    "envelope.signer == ClaimVerifier.attestationSigner",
    (envelope.signer ?? "").toLowerCase() === verifierSigner.toLowerCase(),
    `${envelope.signer} == ${verifierSigner}`,
  );

  let decoded: DecodedAttestation | null = null;
  try {
    decoded = (await pub.readContract({
      address: dep.contracts.ClaimVerifier,
      abi: VERIFIER_ABI,
      functionName: "verifyAttestation",
      args: [envelope.encodedData, envelope.signature],
    })) as DecodedAttestation;
    check("verifyAttestation accepts envelope (signature recovers)", true);
  } catch (err) {
    check(
      "verifyAttestation accepts envelope (signature recovers)",
      false,
      err instanceof Error ? err.message.slice(0, 160) : "revert",
    );
    return finish(t0);
  }
  if (!decoded) return finish(t0);

  const [decUser, decMarketId, decOutcome, decPayout, , decRecipient] = decoded;
  check(
    "decoded user == deployer",
    decUser.toLowerCase() === deployer.address.toLowerCase(),
    `${decUser} == ${deployer.address}`,
  );
  check("decoded marketId matches target", decMarketId === marketId, `${decMarketId} == ${marketId}`);
  check(
    "decoded outcome matches on-chain outcome",
    decOutcome === outcomeOnChain,
    `${decOutcome} == ${outcomeOnChain}`,
  );
  check("decoded payoutCommitment is non-zero", decPayout !== ZERO_BYTES32, `${decPayout.slice(0, 18)}…`);
  check(
    "decoded recipient == 0x0 (bearer mode)",
    decRecipient.toLowerCase() === "0x" + "00".repeat(20),
    decRecipient,
  );

  return finish(t0);
}

function finish(t0: number): void {
  // ─── Summary ──────────────────────────────────────────────────────────
  box(`SUMMARY — ${allChecks.filter((c) => c.pass).length}/${allChecks.length} PASS`);
  for (const c of allChecks) {
    const icon = c.pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    log(`  ${icon} ${c.name}`);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log("");
  log(`  total: ${elapsed}s`);
  log(`  transcript: ${TRANSCRIPT}`);

  const failed = allChecks.filter((c) => !c.pass).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  log(`${C.red}FAILED:${C.reset} ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
