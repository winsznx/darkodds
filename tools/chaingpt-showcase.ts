/**
 * chaingpt-showcase.ts — F10b "ChainGPT used both ways" deliverable.
 *
 * Two-pass demonstration that hits BOTH ChainGPT products end-to-end:
 *
 *   1. Smart Contract Generator: prompts ChainGPT to generate a binary
 *      prediction market spec contract from a natural-language description
 *      of DarkOdds. Output is saved verbatim to
 *      `contracts/generated/<date>-ConfidentialMarketSpec.sol` — a static
 *      deliverable that judges (and us) can read alongside the real
 *      DarkOdds contracts.
 *
 *   2. Smart Contract Auditor: feeds the just-generated source back into
 *      the auditor and saves the structured HIGH/MEDIUM/LOW report to
 *      `contracts/audits/chaingpt-generated-<date>.md`.
 *
 * Why both? PRD §8 lists Generator AND Auditor as separate ChainGPT
 * deliverables. Until F10b, only the Auditor was in CI (against our real
 * contracts). This script closes the loop on the Generator side without
 * polluting our shipped runtime code — the generated spec is documentation
 * /reference, never deployed.
 *
 * Usage:
 *   pnpm exec tsx tools/chaingpt-showcase.ts
 *   (requires CHAINGPT_API_KEY in env)
 *
 * Output:
 *   contracts/generated/<YYYY-MM-DD>-ConfidentialMarketSpec.sol
 *   contracts/audits/chaingpt-generated-<YYYY-MM-DD>.md
 */

import {existsSync, mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";

// We hit the ChainGPT REST API directly (same pattern as tools/chaingpt-audit.ts,
// tools/audit-f4.ts, tools/audit-f45.ts). The SDK packages live under
// web/node_modules and aren't direct deps of the repo root, so importing them
// from this script would break module resolution. Raw fetch keeps the script
// self-contained and matches the existing tool conventions.

const KEY = process.env["CHAINGPT_API_KEY"]?.trim();
if (!KEY) {
  console.error("[showcase] CHAINGPT_API_KEY missing");
  process.exit(1);
}

const ENDPOINT_BLOB = "https://api.chaingpt.org/chat/blob";
const ENDPOINT_STREAM = "https://api.chaingpt.org/chat/stream";

const ROOT = process.cwd();
const today = new Date().toISOString().slice(0, 10);
const GEN_DIR = join(ROOT, "contracts", "generated");
const AUDIT_DIR = join(ROOT, "contracts", "audits");
const SPEC_OUT = join(GEN_DIR, `${today}-ConfidentialMarketSpec.sol`);
const AUDIT_OUT = join(AUDIT_DIR, `chaingpt-generated-${today}.md`);

const SPEC_PROMPT = `Generate a Solidity 0.8.x contract called \`ConfidentialMarketSpec\` representing the spec of a binary prediction market — DarkOdds, a confidential pari-mutuel market on Arbitrum.

Requirements:
- Two outcomes: YES (1) and NO (0)
- Pari-mutuel proportional payout: winners share the losing pool proportionally to their stake
- 2% protocol fee on winnings (configurable, max 10%)
- State machine: Open → Closed → Resolving → ClaimWindow → (terminal) | Invalid (refund branch)
- Functions: placeBet(uint8 side, uint256 amount), closeMarket(), resolveOracle(uint8 outcome), claimWinnings(), refundIfInvalid()
- Events: BetPlaced, MarketResolved, ClaimSettled, Refunded
- Custom errors instead of require strings
- Use OpenZeppelin ReentrancyGuard for placeBet/claim/refund
- Pure spec — no encryption details, no iExec specifics, just the binary market shape

Output ONLY the Solidity source file with SPDX header and license. No markdown fences, no commentary.`;

// The generator's /chat/blob endpoint double-wraps the response:
//   { statusCode, message, data: { bot: { statusCode, message, data: { bot: <text> } } } }
// The auditor's /chat/stream endpoint is single-level streamed text.
// Probed live before shipping (see DRIFT_LOG F10b).
interface GeneratorBlobEnvelope {
  data?: {bot?: {data?: {bot?: string}}};
}

async function generateSpec(): Promise<string> {
  console.log(`[showcase] step 1/2: ChainGPT Smart Contract Generator`);
  const t0 = Date.now();
  const res = await fetch(ENDPOINT_BLOB, {
    method: "POST",
    headers: {Authorization: `Bearer ${KEY!}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      model: "smart_contract_generator",
      question: SPEC_PROMPT,
      chatHistory: "off",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Generator HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as GeneratorBlobEnvelope;
  const text = json.data?.bot?.data?.bot ?? "";
  if (!text.trim()) throw new Error("Generator returned empty body");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[showcase]   ✓ ${text.length} chars in ${elapsed}s`);
  return text;
}

async function auditSpec(source: string): Promise<string> {
  console.log(`[showcase] step 2/2: ChainGPT Smart Contract Auditor`);
  const t0 = Date.now();
  // Use the same raw-fetch path as tools/chaingpt-audit.ts for consistency
  // with the existing audit trail (F4 / F4.5 / F10).
  const res = await fetch(ENDPOINT_STREAM, {
    method: "POST",
    headers: {Authorization: `Bearer ${KEY!}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      model: "smart_contract_auditor",
      question:
        `Audit this Solidity contract — a binary prediction market with pari-mutuel ` +
        `payouts. The contract was just generated by ChainGPT's Smart Contract Generator ` +
        `from a natural-language spec; this audit closes the AI-generates / AI-audits ` +
        `loop. Categorize every finding LOW / MEDIUM / HIGH / CRITICAL.\n\n` +
        `\`\`\`solidity\n${source}\n\`\`\``,
      chatHistory: "off",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auditor HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Auditor: no stream body");
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    out += dec.decode(value, {stream: true});
  }
  out += dec.decode();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[showcase]   ✓ ${out.length} chars in ${elapsed}s`);
  return out;
}

async function main(): Promise<void> {
  if (!existsSync(GEN_DIR)) mkdirSync(GEN_DIR, {recursive: true});
  if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, {recursive: true});

  const spec = await generateSpec();
  writeFileSync(SPEC_OUT, spec);
  console.log(`[showcase]   wrote ${SPEC_OUT}`);

  const audit = await auditSpec(spec);
  const wrapped = [
    `# ChainGPT Smart Contract Auditor — generated spec contract`,
    ``,
    `_Generated ${new Date().toISOString()} by \`tools/chaingpt-showcase.ts\`._`,
    ``,
    `**Source:** [\`contracts/generated/${today}-ConfidentialMarketSpec.sol\`](../generated/${today}-ConfidentialMarketSpec.sol) — ` +
      `produced by ChainGPT Smart Contract Generator from a natural-language DarkOdds spec.`,
    ``,
    `**This audit closes the AI-generates → AI-audits loop** that PRD §8 (Generator + Auditor) calls for.`,
    `Findings on the generated spec are advisory — the spec is a documentation artifact, not deployed runtime code.`,
    `The real DarkOdds contracts under \`contracts/src/\` are audited separately in \`chaingpt-${today}.md\`.`,
    ``,
    `---`,
    ``,
    audit,
  ].join("\n");
  writeFileSync(AUDIT_OUT, wrapped);
  console.log(`[showcase]   wrote ${AUDIT_OUT}`);

  console.log(`\n[showcase] DONE.`);
  console.log(`[showcase]   spec  → ${SPEC_OUT}`);
  console.log(`[showcase]   audit → ${AUDIT_OUT}`);
}

void main().catch((e) => {
  console.error("[showcase] FAILED:", e);
  process.exit(1);
});
