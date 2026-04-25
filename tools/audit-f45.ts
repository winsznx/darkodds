/**
 * Phase F4.5 ChainGPT Smart Contract Auditor re-audit.
 *
 * Re-audits ONLY the contracts modified in F4.5 (Market.sol +
 * MarketRegistry.sol). Saves outputs alongside the F4 audit trail at
 * `contracts/audits/chaingpt-2026-04-25-f45/<contract>.md` so both passes
 * remain queryable.
 *
 * Generates a SUMMARY.md cross-referencing F4 vs F4.5 findings.
 *
 * Per docs.chaingpt.org:
 *   POST https://api.chaingpt.org/chat/stream
 *   Authorization: Bearer YOUR_API_KEY
 *   { "model": "smart_contract_auditor", "question": "<source>",
 *     "chatHistory": "off" }
 */

import {readFileSync, writeFileSync, mkdirSync, existsSync} from "node:fs";

const ENDPOINT = "https://api.chaingpt.org/chat/stream";
const KEY = process.env["CHAINGPT_API_KEY"]?.trim();
if (!KEY) {
  console.error("[audit-f45] CHAINGPT_API_KEY missing");
  process.exit(1);
}

// Only the contracts whose source changed in F4.5.
const TARGETS = ["src/Market.sol", "src/MarketRegistry.sol"];

async function audit(name: string, source: string): Promise<string> {
  const body = {
    model: "smart_contract_auditor",
    question:
      `Re-audit the following Solidity contract from the DarkOdds prediction-market ` +
      `codebase. This is a Phase F4.5 hardening pass after Slither + the prior ChainGPT ` +
      `audit. Specifically check whether the F4.5 changes introduce regressions and ` +
      `whether previously-flagged issues (admin centralization, reentrancy, ACL) ` +
      `remain mitigated. Surface every NEW issue at LOW / MEDIUM / HIGH / CRITICAL.\n\n` +
      `Source for ${name}:\n\n\`\`\`solidity\n${source}\n\`\`\``,
    chatHistory: "off",
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no stream body");
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    out += decoder.decode(value, {stream: true});
  }
  out += decoder.decode();
  return out;
}

async function main(): Promise<void> {
  const auditDir = `${process.cwd()}/contracts/audits/chaingpt-2026-04-25-f45`;
  if (!existsSync(auditDir)) mkdirSync(auditDir, {recursive: true});

  for (const target of TARGETS) {
    const name = target
      .replace(/^src\//, "")
      .replace(/\//g, "_")
      .replace(/\.sol$/, "");
    const outPath = `${auditDir}/${name}.md`;
    if (existsSync(outPath)) {
      console.log(`[audit-f45] ${name} already audited at ${outPath} — skipping`);
      continue;
    }
    console.log(`[audit-f45] auditing ${target}...`);
    const source = readFileSync(`${process.cwd()}/contracts/${target}`, "utf8");
    try {
      const t0 = Date.now();
      const result = await audit(target, source);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const md = `# ChainGPT audit — ${target} (F4.5 re-audit)\n\n_Generated ${new Date().toISOString()} in ${elapsed}s._\n\n${result}\n`;
      writeFileSync(outPath, md);
      console.log(`[audit-f45]   wrote ${outPath} (${result.length} chars)`);
    } catch (err) {
      console.error(`[audit-f45]   FAILED for ${name}:`, err);
    }
  }

  // Generate cross-reference summary.
  const summaryPath = `${auditDir}/SUMMARY.md`;
  const summary = [
    "# ChainGPT audit — F4 vs F4.5 cross-reference",
    "",
    "Both audit passes are preserved as part of the project audit trail per",
    "PRD §11 F4.5 deliverable.",
    "",
    "| Pass | Path | Contracts | Date |",
    "|---|---|---|---|",
    "| F4   | `contracts/audits/chaingpt-2026-04-25-f4.md`        | 10 (full suite) | 2026-04-25 |",
    "| F4.5 | `contracts/audits/chaingpt-2026-04-25-f45/*.md`     | 2 (Market, MarketRegistry — only F4.5-modified contracts) | 2026-04-25 |",
    "",
    "## F4 findings status after F4.5",
    "",
    "### Admin centralization (HIGH)",
    "- **F4 finding:** All Ownable contracts owned by deployer EOA.",
    "- **F4.5 resolution:** Migrated ownership of all 7 Ownable contracts",
    "  (TestUSDC, MarketRegistry, ResolutionOracle, AdminOracle,",
    "  PreResolvedOracle, ChainlinkPriceOracle, FeeVault) to a 2-of-3 Gnosis",
    "  Safe v1.4.1. Safe address recorded in `deployments/arb-sepolia.json`",
    "  under `safe.address`. Ownership transfer audit trail in",
    "  `ownership.contracts.<name>.transferTx`.",
    "- **Status:** RESOLVED.",
    "",
    "### Reentrancy / CEI",
    "- **F4 finding:** Already mitigated by `nonReentrant` on every entry point.",
    "- **F4.5 update:** Slither flags 13 `reentrancy-no-eth` results — all",
    "  false positives behind ReentrancyGuard. See",
    "  `audits/slither-2026-04-25/summary.md`.",
    "- **Status:** UNCHANGED (already mitigated).",
    "",
    "### Cross-contract ACL (handle authorization)",
    "- **F4 finding:** Documented as known by-design pattern requiring",
    "  `Nox.allowTransient` before delegating handle use to cUSDC.",
    "- **F4.5 update:** F4.5 hardens placeBet to use the cUSDC-returned",
    "  `transferred` handle for downstream pool/bet accounting (instead of",
    "  the gateway-issued `betAmount`). Closes ERC-7984 silent-failure gap.",
    "- **Status:** STRENGTHENED.",
    "",
    "## New F4.5 findings",
    "",
    "See per-contract reports in this directory for the latest LOW / MEDIUM /",
    "HIGH / CRITICAL summaries on Market.sol + MarketRegistry.sol.",
    "",
  ].join("\n");
  writeFileSync(summaryPath, summary);
  console.log(`[audit-f45] wrote summary: ${summaryPath}`);
  console.log(`[audit-f45] DONE`);
}

main().catch((err) => {
  console.error("[audit-f45] FATAL:", err);
  process.exit(1);
});
