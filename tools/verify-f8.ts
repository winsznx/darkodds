// SPDX-License-Identifier: MIT
//
// F8 — Operator verification for the /markets parallel-feed UI.
//
// Steps:
//   1. Hit Polymarket Gamma API directly, confirm reachability + sample shape.
//   2. Read MarketRegistry.nextMarketId from chain (Arb Sepolia).
//   3. Boot the Next.js dev server (or expect one already running) and fetch
//      /markets server-side render. Parse the HTML to assert:
//        - Both columns present (DARKODDS // PRIVATE + POLYMARKET // PUBLIC)
//        - DarkOdds card count matches MarketRegistry.nextMarketId - 1
//        - At least one VIEW ON POLYMARKET ↗ outbound link present
//        - Every Polymarket outbound href is a well-formed
//          polymarket.com/event/<slug> URL
//        - "MIRROR ON DARKODDS" disabled CTA visibly present
//        - "PLACE BET" disabled CTA visibly present
//   4. Output to verification-output/<timestamp>/.
//
// Usage:
//   pnpm verify:f8                       # interactive
//   pnpm verify:f8 -- --non-interactive  # CI/agent
//
// Assumes a dev server at http://localhost:3000. If not running, prints how
// to start it and exits 1.

import * as readline from "node:readline/promises";
import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {stdin, stdout} from "node:process";

import {createPublicClient, http, parseAbi, type Hex, type Address} from "viem";
import {arbitrumSepolia} from "viem/chains";

const NON_INTERACTIVE = process.argv.includes("--non-interactive");

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const DEV_SERVER = "http://localhost:3000";

const REGISTRY_ABI = parseAbi(["function nextMarketId() view returns (uint256)"]);
const MARKET_CREATED_ABI = parseAbi([
  "event MarketCreated(uint256 indexed id, address market, string question, uint256 expiryTs)",
]);
const BET_PLACED_ABI = parseAbi([
  "event BetPlaced(address indexed user, uint8 side, bytes32 handle, uint256 indexed batchId)",
]);

const runStartedAt = new Date();
const stamp = runStartedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUTDIR = `${process.cwd()}/verification-output/${stamp}`;
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
    log(`${C.dim}━━ ${prompt} (auto-skipped: --non-interactive) ━━${C.reset}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    rl.question(`\n${C.yellow}━━ ${prompt} ━━${C.reset} `).then(() => resolve());
  });
}

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main(): Promise<void> {
  if (!stdin.isTTY && !NON_INTERACTIVE) {
    throw new Error("verify-f8 must run from a TTY or with --non-interactive.");
  }

  const t0 = Date.now();
  const RPC = need("ARB_SEPOLIA_RPC_URL");

  box("F8 VERIFICATION — /markets parallel feed");

  // ─── Step 1: Gamma API reach + sample ──────────────────────────────────
  box("STEP 1 — Polymarket Gamma reachability");
  const gammaUrl = `${GAMMA_BASE}/markets?limit=3&active=true&closed=false&order=volume24hr&ascending=false`;
  const gammaRes = await fetch(gammaUrl);
  if (!gammaRes.ok) throw new Error(`Gamma returned ${gammaRes.status}`);
  const gammaJson = (await gammaRes.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(gammaJson) || gammaJson.length === 0) {
    throw new Error("Gamma returned empty array");
  }
  const sample = gammaJson[0]!; // length > 0 guaranteed by check above
  log(`  ${C.green}✓${C.reset} Gamma 200, ${gammaJson.length} markets`);
  log(`  Sample id=${sample.id} slug=${sample.slug}`);
  log(`  outcomes raw: ${sample.outcomes}`);
  log(`  outcomePrices raw: ${sample.outcomePrices}`);
  await pause();

  // ─── Step 2: chain registry consistency ────────────────────────────────
  box("STEP 2 — MarketRegistry.nextMarketId on Arb Sepolia");
  const dep = JSON.parse(readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8")) as {
    contracts: {MarketRegistry: Address};
  };
  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const nextId = (await pub.readContract({
    address: dep.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "nextMarketId",
  })) as bigint;
  const expectedDarkOddsCount = Number(nextId - BigInt(1));
  log(`  MarketRegistry.nextMarketId = ${nextId.toString()}`);
  log(`  Expected DarkOdds card count (max ${50}): ${Math.min(expectedDarkOddsCount, 50)}`);
  await pause();

  // ─── Step 3: /markets HTML render assertions ───────────────────────────
  box("STEP 3 — fetch /markets and parse HTML");
  let pageHtml: string;
  try {
    const res = await fetch(`${DEV_SERVER}/markets`, {cache: "no-store"});
    if (!res.ok) throw new Error(`/markets returned ${res.status}`);
    pageHtml = await res.text();
  } catch (err) {
    log(`${C.red}  /markets fetch failed:${C.reset} ${err instanceof Error ? err.message : String(err)}`);
    log(`  Start the dev server first:  ${C.bold}pnpm dev:web${C.reset}`);
    log(`  Then re-run verify:f8.`);
    rl.close();
    process.exit(1);
  }
  log(`  ${C.green}✓${C.reset} /markets fetched (${pageHtml.length} bytes)`);

  const checks: Array<{name: string; pass: boolean; detail: string}> = [];

  const darkColMatch = pageHtml.includes("DARKODDS // PRIVATE");
  checks.push({name: "DARKODDS // PRIVATE column header", pass: darkColMatch, detail: ""});
  const pmColMatch = pageHtml.includes("POLYMARKET // PUBLIC");
  checks.push({name: "POLYMARKET // PUBLIC column header", pass: pmColMatch, detail: ""});

  const doSourceCount = (pageHtml.match(/mc-source--do/g) ?? []).length;
  const pmSourceCount = (pageHtml.match(/mc-source--pm/g) ?? []).length;
  log(`  DO source badges: ${doSourceCount}`);
  log(`  PM source badges: ${pmSourceCount}`);

  // DarkOdds card count must equal what MarketRegistry says (capped at lib limit 50).
  // Server-side multicall reads up to 50 most-recent; tolerate that range.
  const expectedDoCap = Math.min(expectedDarkOddsCount, 50);
  const doCountOk = doSourceCount === expectedDoCap;
  checks.push({
    name: `DarkOdds card count matches MarketRegistry`,
    pass: doCountOk,
    detail: `expected=${expectedDoCap} actual=${doSourceCount}`,
  });

  // Polymarket cards: at least 1, normally 50.
  checks.push({name: "Polymarket cards rendered", pass: pmSourceCount > 0, detail: `count=${pmSourceCount}`});

  // Polymarket outbound URLs all well-formed
  const hrefMatches = [...pageHtml.matchAll(/href="(https:\/\/polymarket\.com\/event\/[a-z0-9-]+)"/g)];
  const polymarketUrls: string[] = hrefMatches.map((m) => m[1] ?? "").filter(Boolean);
  const allUrlsWellFormed = polymarketUrls.every((u) =>
    /^https:\/\/polymarket\.com\/event\/[a-z0-9-]+$/.test(u),
  );
  checks.push({
    name: "All polymarket.com/event/ URLs well-formed",
    pass: allUrlsWellFormed && polymarketUrls.length > 0,
    detail: `count=${polymarketUrls.length}`,
  });

  // DarkOdds CTAs — F9 HALT 1 enables the card link to /markets/[id]; the
  // disabled tooltip pattern remains on the Polymarket card's MIRROR CTA.
  const viewBetCtaPresent = pageHtml.includes("VIEW &amp; BET") || pageHtml.includes("VIEW & BET");
  checks.push({name: "VIEW & BET CTA on DarkOdds card (F9 HALT 1)", pass: viewBetCtaPresent, detail: ""});
  const detailLinks = (pageHtml.match(/href="\/markets\/\d+"/g) ?? []).length;
  checks.push({
    name: "DarkOdds cards link to /markets/[id]",
    pass: detailLinks > 0,
    detail: `count=${detailLinks}`,
  });
  const mirrorPresent = pageHtml.includes("MIRROR ON DARKODDS");
  checks.push({name: "MIRROR ON DARKODDS disabled CTA present", pass: mirrorPresent, detail: ""});
  const f11TipPresent = pageHtml.includes("Phase F11");
  checks.push({name: "F11 tooltip on MIRROR ON DARKODDS", pass: f11TipPresent, detail: ""});

  // ─── F9 HALT 1.5: BetPlaced data path ──────────────────────────────────
  // The /markets/[id] EventLog component fetches client-side, so the initial
  // HTML shows a "LOADING EVENTS…" scaffold. We verify the data path by
  // running the same chain query the component runs, against a known market
  // with a real bet (smoke-f5 lifecycle A → market #12 → tx 0x0071b846).
  const KNOWN_BET_TX = "0x0071b846a052aecad462cb09456905c5c4ee1b21236c74710913fff253763518";
  let betPlacedFound = false;
  let betPlacedDetail = "";
  try {
    const created = await pub.getLogs({
      address: dep.contracts.MarketRegistry,
      event: MARKET_CREATED_ABI[0],
      args: {id: BigInt(12)},
      fromBlock: BigInt(0),
      toBlock: "latest",
    });
    const birthBlock = created[0]?.blockNumber ?? BigInt(0);
    const market12 = (created[0]?.args as {market?: Address})?.market;
    if (market12) {
      const bets = await pub.getLogs({
        address: market12,
        event: BET_PLACED_ABI[0],
        fromBlock: birthBlock,
        toBlock: "latest",
      });
      betPlacedFound = bets.some((b) => b.transactionHash.toLowerCase() === KNOWN_BET_TX.toLowerCase());
      betPlacedDetail = `${bets.length} BetPlaced on market#12 from block ${birthBlock}`;
    } else {
      betPlacedDetail = "MarketCreated lookup empty";
    }
  } catch (e) {
    betPlacedDetail = e instanceof Error ? e.message : String(e);
  }
  checks.push({
    name: "BetPlaced query reaches known market#12 bet (F9 HALT 1.5)",
    pass: betPlacedFound,
    detail: betPlacedDetail,
  });

  // Display-only stance: no Polymarket trading SDK pulled into the web bundle.
  // This is a static guarantee — we never installed @polymarket/clob-client.
  // Verify by reading web/package.json (more reliable than a runtime regex
  // over the rendered HTML, which gets false positives on innocent
  // co-occurrence of "Privy" + "POLYMARKET").
  const webPkg = JSON.parse(readFileSync(`${process.cwd()}/web/package.json`, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allDeps = {...(webPkg.dependencies ?? {}), ...(webPkg.devDependencies ?? {})};
  const polymarketDeps = Object.keys(allDeps).filter(
    (k) => k.startsWith("@polymarket/") || k === "polymarket",
  );
  checks.push({
    name: "No @polymarket/* SDK in web bundle (display-only stance)",
    pass: polymarketDeps.length === 0,
    detail: polymarketDeps.length > 0 ? `found: ${polymarketDeps.join(", ")}` : "0 deps",
  });

  log("");
  for (const c of checks) {
    const tag = c.pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    log(`  ${tag} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }

  const failures = checks.filter((c) => !c.pass);
  await pause();

  // ─── Output files ──────────────────────────────────────────────────────
  writeFileSync(`${OUTDIR}/markets.html`, pageHtml);
  writeFileSync(`${OUTDIR}/polymarket-urls.txt`, polymarketUrls.slice(0, 20).join("\n") + "\n");
  writeFileSync(
    `${OUTDIR}/checks.json`,
    JSON.stringify(
      {
        runStartedAt: runStartedAt.toISOString(),
        gammaSampleId: sample.id,
        marketRegistryNextId: nextId.toString(),
        darkOddsCardCount: doSourceCount,
        polymarketCardCount: pmSourceCount,
        polymarketUrlCount: polymarketUrls.length,
        polymarketUrlSamples: polymarketUrls.slice(0, 5),
        checks,
        failures: failures.length,
        elapsedMs: Date.now() - t0,
      },
      null,
      2,
    ),
  );

  // ─── Summary ───────────────────────────────────────────────────────────
  box(failures.length === 0 ? "F8 VERIFICATION — GREEN" : `F8 VERIFICATION — ${failures.length} FAILURE(S)`);
  log(`  Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log(`  Output: ${OUTDIR}/`);
  log(`    ├── transcript.txt`);
  log(`    ├── markets.html  (${pageHtml.length} bytes)`);
  log(`    ├── polymarket-urls.txt`);
  log(`    └── checks.json`);

  rl.close();
  if (failures.length > 0) process.exit(1);
}

main().catch((e) => {
  process.stdout.write(`\n${C.red}[verify-f8] FAILED:${C.reset} ${e instanceof Error ? e.stack : e}\n`);
  appendFileSync(TRANSCRIPT, `\n[FAILED] ${e instanceof Error ? e.stack : e}\n`);
  rl.close();
  process.exit(1);
});

// silence unused-import lint when the file is read in isolation
type _Hex = Hex;
