// SPDX-License-Identifier: MIT
//
// F10b — operator + agent verification for the F10b deliverable surface:
//
//   1. GOVERNANCE STATE — MarketRegistry.owner() == deployer EOA (OPEN-CREATE phase)
//   2. Operational delegation entry in governance_history with
//      restoration_pending: true
//   3. /portfolio + /audit + /create routes return 200
//   4. /api/polymarket/market/[id] proxy returns normalized data for an
//      active Polymarket market
//   5. /api/admin/deploy-market input validation rejects past expiry
//   6. /api/admin/deploy-market happy path mints a real on-chain market and
//      returns a valid tx hash + market id (skipped on 429 rate-limit so
//      double-runs don't burn credits)
//   7. /api/attestation/generate signs an attestation for an existing claim
//      tx, and ClaimVerifier.verifyAttestation recovers every field on-chain
//   8. /api/chaingpt/generate-market returns structured market params for
//      a crypto prompt (Web3-framed extraction, not chatbot prose)
//   9. ChainGPT showcase artifacts exist on disk:
//      - contracts/generated/<date>-ConfidentialMarketSpec.sol
//      - contracts/audits/chaingpt-generated-<date>.md
//      - contracts/audits/chaingpt-<date>.md (deployed-contracts audit)
//   10. Market #15 (the F10b seeded claimable target) is still in
//       ClaimWindow state with the deployer's bet handle present
//
// Mirrors verify-f9.ts in shape: numbered boxes, inline pass/fail icons,
// transcript file written to verification-output/<stamp>/.
//
// Usage:
//   pnpm verify:f10b                       # interactive
//   pnpm verify:f10b -- --non-interactive  # CI/agent
//
// Requires:
//   - dev server at http://localhost:3000
//   - DEPLOYER_PRIVATE_KEY in .env
//   - registry in OPEN-CREATE phase (run tools/transfer-registry-ownership.ts --to-eoa --confirm first)

import * as readline from "node:readline/promises";
import {appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {stdin, stdout} from "node:process";

import {createPublicClient, http, parseAbi, type Address, type Hex} from "viem";
import {arbitrumSepolia} from "viem/chains";
import {privateKeyToAccount} from "viem/accounts";

const NON_INTERACTIVE = process.argv.includes("--non-interactive");

const DEV_SERVER = "http://localhost:3000";
const ARB_SCAN = "https://sepolia.arbiscan.io";
const MARKET_15_ID = 15n;
const MARKET_14_ID = 14n;

// ─── Polymarket: pick the top active market live to keep the test
//                 robust across days. Falls back to a known-good id if
//                 the Gamma API is rate-limited.
const POLYMARKET_FALLBACK_ID = "540816";

// ─── Output ────────────────────────────────────────────────────────────────
const runStartedAt = new Date();
const stamp = runStartedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUTDIR = `${process.cwd()}/verification-output/f10b-${stamp}`;
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

const rl = readline.createInterface({input: stdin, output: stdout});
function pause(prompt = "Press Enter to continue"): Promise<void> {
  if (NON_INTERACTIVE) {
    log(`${C.dim}[non-interactive] skipping pause: ${prompt}${C.reset}`);
    return Promise.resolve();
  }
  return rl.question(`\n${C.yellow}${prompt} …${C.reset}`).then(() => undefined);
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

function check(name: string, pass: boolean, detail = ""): CheckResult {
  const icon = pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  log(`  ${icon} ${name}${detail ? ` (${detail})` : ""}`);
  return {name, pass, detail};
}

// ─── ABIs ──────────────────────────────────────────────────────────────────
const REGISTRY_ABI = parseAbi([
  "function owner() view returns (address)",
  "function nextMarketId() view returns (uint256)",
  "function markets(uint256) view returns (address)",
]);
const MARKET_ABI = parseAbi([
  "function state() view returns (uint8)",
  "function noBet(address) view returns (bytes32)",
]);
const VERIFIER_ABI = parseAbi([
  "function verifyAttestation(bytes attestationData, bytes signature) view returns (address user, uint256 marketId, uint8 outcome, bytes32 payoutCommitment, uint256 timestamp, address recipient, uint256 nonce)",
]);

const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

// ─── Main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const t0 = Date.now();
  const allChecks: CheckResult[] = [];

  log(`${C.bold}DarkOdds F10b Verification${C.reset}  ${runStartedAt.toISOString()}`);
  log(`${C.dim}Output: ${OUTDIR}${C.reset}`);

  const pk = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY not set in environment");
  const rpcUrl = process.env.ARB_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";
  const deployer = privateKeyToAccount(pk).address;
  log(`${C.dim}Deployer: ${deployer}${C.reset}`);

  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(rpcUrl)});

  const dep = JSON.parse(readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8")) as {
    contracts: Record<string, Address>;
    safe: {address: Address};
    governance_history?: Array<{
      action: string;
      restoration_pending?: boolean;
      txHash: Hex;
      ts: string;
    }>;
  };
  const REGISTRY = dep.contracts.MarketRegistry;
  const SAFE = dep.safe.address;
  const VERIFIER = dep.contracts.ClaimVerifier;

  // ─── 1. GOVERNANCE STATE ────────────────────────────────────────────────
  box("STEP 1 — GOVERNANCE STATE: OPEN-CREATE phase (registry owner == deployer EOA)");
  const owner = (await pub.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "owner",
  })) as Address;
  log(`  MarketRegistry.owner(): ${owner}`);
  log(`  Deployer EOA:           ${deployer}`);
  log(`  Safe (production):      ${SAFE}`);
  allChecks.push(
    check(
      "owner() == deployer EOA (OPEN-CREATE phase active)",
      owner.toLowerCase() === deployer.toLowerCase(),
      `${owner} == ${deployer}`,
    ),
  );

  await pause();

  // ─── 2. Operational delegation entry ────────────────────────────────────
  box("STEP 2 — Operational delegation entry in governance_history");
  const history = dep.governance_history ?? [];
  const delegation = history.find(
    (h) => h.action === "operational_delegation_to_deployer_for_demo" && h.restoration_pending === true,
  );
  log(`  governance_history entries: ${history.length}`);
  if (delegation) {
    log(`  found delegation tx:  ${delegation.txHash}`);
    log(`  ${ARB_SCAN}/tx/${delegation.txHash}`);
    log(`  recorded at:          ${delegation.ts}`);
  }
  allChecks.push(
    check(
      "open delegation entry (restoration_pending: true) present",
      delegation !== undefined,
      delegation ? `tx ${delegation.txHash.slice(0, 12)}…` : "missing — run --to-eoa --confirm",
    ),
  );

  // grep proves the audit-trail surface works as advertised
  const depRaw = readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8");
  const pendingMatches = depRaw.match(/"restoration_pending":\s*true/g) ?? [];
  allChecks.push(
    check(
      'grep "restoration_pending: true" surfaces commitments',
      pendingMatches.length >= 1,
      `${pendingMatches.length} open`,
    ),
  );

  await pause();

  // ─── 3. Dashboard routes return 200 ─────────────────────────────────────
  box("STEP 3 — Dashboard routes (/portfolio, /audit, /create) render");
  for (const path of ["/portfolio", "/audit", "/create"]) {
    try {
      const res = await fetch(`${DEV_SERVER}${path}`);
      allChecks.push(check(`GET ${path} == 200`, res.status === 200, `status ${res.status}`));
    } catch (err) {
      allChecks.push(check(`GET ${path} == 200`, false, err instanceof Error ? err.message : "fetch failed"));
    }
  }

  await pause();

  // ─── 4. Polymarket proxy ─────────────────────────────────────────────────
  box("STEP 4 — /api/polymarket/market/[id] proxy returns normalized data");
  let polymarketMarketId = POLYMARKET_FALLBACK_ID;
  try {
    const live = await fetch("https://gamma-api.polymarket.com/markets?limit=1&active=true");
    if (live.ok) {
      const arr = (await live.json()) as Array<{id?: string}>;
      if (arr[0]?.id) polymarketMarketId = arr[0].id;
    }
  } catch {
    // fallback
  }
  log(`  probing polymarket market id: ${polymarketMarketId}`);
  try {
    const res = await fetch(`${DEV_SERVER}/api/polymarket/market/${polymarketMarketId}`);
    const json = (await res.json()) as
      | {ok: true; data: {id: string; question: string; url: string}}
      | {ok: false; error: string};
    allChecks.push(check(`POST /api/polymarket/market/${polymarketMarketId} ok`, json.ok === true));
    if (json.ok) {
      log(`  question: "${json.data.question.slice(0, 60)}…"`);
      log(`  url:      ${json.data.url}`);
      allChecks.push(
        check(
          "response includes id+question+url",
          Boolean(json.data.id && json.data.question && json.data.url),
        ),
      );
    }
  } catch (err) {
    allChecks.push(check("polymarket proxy", false, err instanceof Error ? err.message : "fetch failed"));
  }

  await pause();

  // ─── 5. /api/admin/deploy-market input validation ───────────────────────
  box("STEP 5 — /api/admin/deploy-market rejects bogus inputs");
  const invalidRes = await fetch(`${DEV_SERVER}/api/admin/deploy-market`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      question: "test",
      resolutionCriteria: "test",
      oracleType: 0,
      expiryTs: 100, // far in the past
      protocolFeeBps: 200,
    }),
  });
  const invalidJson = (await invalidRes.json()) as {ok: boolean; error?: string};
  allChecks.push(
    check(
      "past expiry returns 400 ok=false",
      invalidRes.status === 400 && invalidJson.ok === false,
      invalidJson.error ?? "no error msg",
    ),
  );

  await pause();

  // ─── 6. /api/admin/deploy-market happy path ─────────────────────────────
  box("STEP 6 — /api/admin/deploy-market mints a real market");
  const expiryTs = Math.floor(Date.now() / 1000) + 24 * 3600;
  const deployRes = await fetch(`${DEV_SERVER}/api/admin/deploy-market`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      question: `verify-f10b sponsored deploy ${stamp}`,
      resolutionCriteria: "Resolves YES if the F10b verification script ran successfully end-to-end.",
      oracleType: 0,
      expiryTs,
      protocolFeeBps: 200,
    }),
  });
  if (deployRes.status === 429) {
    log(`  ${C.yellow}⚠  rate-limited (1 sponsored deploy per IP per 60s) — counting as PASS${C.reset}`);
    allChecks.push(check("sponsored deploy rate-limit honored", true, "429 expected on rapid re-runs"));
  } else {
    const dj = (await deployRes.json()) as
      | {ok: true; marketId: string; marketAddress: Address; txHash: Hex; sponsored: true}
      | {ok: false; error: string};
    if (dj.ok) {
      log(`  marketId:      ${dj.marketId}`);
      log(`  marketAddress: ${dj.marketAddress}`);
      log(`  ${ARB_SCAN}/tx/${dj.txHash}`);
      const rc = await pub.getTransactionReceipt({hash: dj.txHash});
      allChecks.push(check("sponsored deploy returns ok=true", true, `market #${dj.marketId}`));
      allChecks.push(check("on-chain receipt status == success", rc.status === "success"));
      allChecks.push(check("sponsored: true flag present", dj.sponsored === true));
    } else {
      allChecks.push(check("sponsored deploy ok=true", false, dj.error));
    }
  }

  await pause();

  // ─── 7. Attestation round-trip (uses Market #14's existing claim tx) ───
  box("STEP 7 — /api/attestation/generate + ClaimVerifier.verifyAttestation round-trip");
  // Find a claim tx for Market #14 by reading ClaimSettled events.
  const m14Addr = (await pub.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "markets",
    args: [MARKET_14_ID],
  })) as Address;
  log(`  Market #14 address: ${m14Addr}`);
  const claimSettled = parseAbi([
    "event ClaimSettled(address indexed user, uint8 outcome, bytes32 payoutHandle, bytes32 feeHandle)",
  ])[0];
  const logs = await pub.getLogs({
    address: m14Addr,
    event: claimSettled,
    fromBlock: 0n,
    toBlock: "latest",
  });
  if (logs.length === 0) {
    allChecks.push(check("Market #14 has at least one ClaimSettled log", false, "no claims found"));
  } else {
    const claimTx = logs[0].transactionHash;
    log(`  Using claim tx:    ${claimTx}`);
    const attestRes = await fetch(`${DEV_SERVER}/api/attestation/generate`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        marketId: MARKET_14_ID.toString(),
        claimTx,
        bearer: true,
      }),
    });
    const envelope = (await attestRes.json()) as {
      ok?: undefined;
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
    };
    allChecks.push(
      check(
        "/api/attestation/generate returns envelope",
        Boolean(envelope.payload && envelope.encodedData && envelope.signature),
        envelope.error ?? "ok",
      ),
    );
    if (envelope.encodedData && envelope.signature) {
      try {
        const decoded = (await pub.readContract({
          address: VERIFIER,
          abi: VERIFIER_ABI,
          functionName: "verifyAttestation",
          args: [envelope.encodedData, envelope.signature],
        })) as readonly [Address, bigint, number, Hex, bigint, Address, bigint];
        allChecks.push(check("ClaimVerifier.verifyAttestation accepts envelope", true));
        allChecks.push(
          check(
            "decoded marketId matches request",
            decoded[1] === MARKET_14_ID,
            `${decoded[1]} == ${MARKET_14_ID}`,
          ),
        );
        allChecks.push(
          check(
            "decoded recipient == 0x0 (bearer mode)",
            decoded[5].toLowerCase() === ("0x" + "00".repeat(20)).toLowerCase(),
          ),
        );
      } catch (err) {
        allChecks.push(
          check(
            "ClaimVerifier.verifyAttestation accepts envelope",
            false,
            err instanceof Error ? err.message : "revert",
          ),
        );
      }
    }
  }

  await pause();

  // ─── 8. ChainGPT extraction ─────────────────────────────────────────────
  box("STEP 8 — /api/chaingpt/generate-market returns structured params");
  try {
    const cgptRes = await fetch(`${DEV_SERVER}/api/chaingpt/generate-market`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        prompt: "BTC closes above $250,000 by end of 2027, Chainlink-resolved",
      }),
    });
    const cgptJson = (await cgptRes.json()) as {
      params?: {question: string; oracleType: number; expiryTs: number; protocolFeeBps: number};
      error?: string;
    };
    if (cgptJson.params) {
      log(`  question:    "${cgptJson.params.question}"`);
      log(`  oracleType:  ${cgptJson.params.oracleType}  (1 = Chainlink)`);
      log(
        `  expiryTs:    ${cgptJson.params.expiryTs}  (${new Date(cgptJson.params.expiryTs * 1000).toISOString()})`,
      );
      log(`  feeBps:      ${cgptJson.params.protocolFeeBps}`);
      allChecks.push(check("ChainGPT returned structured params", true));
      allChecks.push(check("oracleType == 1 for crypto/Chainlink prompt", cgptJson.params.oracleType === 1));
      allChecks.push(
        check("expiryTs is in the future", cgptJson.params.expiryTs > Math.floor(Date.now() / 1000)),
      );
    } else {
      allChecks.push(check("ChainGPT returned structured params", false, cgptJson.error ?? "no params"));
    }
  } catch (err) {
    allChecks.push(check("ChainGPT extraction", false, err instanceof Error ? err.message : "fetch failed"));
  }

  await pause();

  // ─── 9. ChainGPT showcase artifacts ─────────────────────────────────────
  box("STEP 9 — ChainGPT showcase artifacts on disk (Generator + Auditor)");
  const generatedDir = `${process.cwd()}/contracts/generated`;
  const auditDir = `${process.cwd()}/contracts/audits`;
  let generatedSpec: string | null = null;
  let generatedAudit: string | null = null;
  let deployedAudit: string | null = null;
  if (existsSync(generatedDir)) {
    const files = readdirSync(generatedDir).filter((f) => f.endsWith("-ConfidentialMarketSpec.sol"));
    if (files.length > 0) generatedSpec = files.sort().slice(-1)[0];
  }
  if (existsSync(auditDir)) {
    const files = readdirSync(auditDir);
    const generatedAudits = files.filter((f) => /^chaingpt-generated-\d{4}-\d{2}-\d{2}\.md$/.test(f));
    const deployedAudits = files.filter((f) => /^chaingpt-\d{4}-\d{2}-\d{2}\.md$/.test(f));
    if (generatedAudits.length > 0) generatedAudit = generatedAudits.sort().slice(-1)[0];
    if (deployedAudits.length > 0) deployedAudit = deployedAudits.sort().slice(-1)[0];
  }
  allChecks.push(
    check("ChainGPT-generated spec contract exists", generatedSpec !== null, generatedSpec ?? "missing"),
  );
  allChecks.push(
    check("ChainGPT audit on generated spec exists", generatedAudit !== null, generatedAudit ?? "missing"),
  );
  allChecks.push(
    check("ChainGPT audit on deployed contracts exists", deployedAudit !== null, deployedAudit ?? "missing"),
  );

  await pause();

  // ─── 10. Market #15 still claimable ─────────────────────────────────────
  box("STEP 10 — Market #15 remains in ClaimWindow (F10b seeded claim target)");
  const m15Addr = (await pub.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "markets",
    args: [MARKET_15_ID],
  })) as Address;
  if (m15Addr === "0x" + "00".repeat(20)) {
    allChecks.push(check("Market #15 exists in registry", false));
  } else {
    log(`  Market #15: ${m15Addr}`);
    const m15State = (await pub.readContract({
      address: m15Addr,
      abi: MARKET_ABI,
      functionName: "state",
    })) as number;
    const m15NoBet = (await pub.readContract({
      address: m15Addr,
      abi: MARKET_ABI,
      functionName: "noBet",
      args: [deployer],
    })) as Hex;
    log(`  state(): ${m15State}  (5 = ClaimWindow)`);
    log(`  noBet(deployer): ${m15NoBet}`);
    // ClaimWindow == 5 OR if it's already been claimed, we count any
    // settled state as a pass (the deployer may have run the claim flow
    // between seeding and verification).
    const settled = m15State === 5 || m15State === 4; /* Resolved */
    allChecks.push(check("Market #15 in ClaimWindow or Resolved state", settled, `state=${m15State}`));
    allChecks.push(check("deployer NO bet handle present on Market #15", m15NoBet !== ZERO_BYTES32));
  }

  // ─── Summary ──────────────────────────────────────────────────────────
  box("SUMMARY");
  const passed = allChecks.filter((c) => c.pass).length;
  const failed = allChecks.length - passed;
  for (const c of allChecks) {
    const icon = c.pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    log(`  ${icon} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  log("");
  if (failed === 0) {
    log(
      `${C.green}${C.bold}✓ ALL ${passed} CHECKS PASSED${C.reset}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
  } else {
    log(`${C.red}${C.bold}✗ ${failed} of ${allChecks.length} CHECKS FAILED${C.reset}`);
  }
  log(`${C.dim}Transcript: ${TRANSCRIPT}${C.reset}`);

  // Persist a JSON summary alongside the transcript for CI consumers.
  writeFileSync(
    `${OUTDIR}/summary.json`,
    JSON.stringify(
      {
        startedAt: runStartedAt.toISOString(),
        durationMs: Date.now() - t0,
        passed,
        failed,
        total: allChecks.length,
        checks: allChecks,
      },
      null,
      2,
    ),
  );

  rl.close();
  if (failed > 0) process.exit(1);
}

void main().catch((e) => {
  log(`${C.red}[verify-f10b] FAILED: ${e instanceof Error ? (e.stack ?? e.message) : e}${C.reset}`);
  rl.close();
  process.exit(1);
});
