/**
 * Phase F4 ChainGPT Smart Contract Auditor pass.
 *
 * POSTs each F2 + F3 + F4 production contract to the ChainGPT auditor and
 * concatenates the responses into `contracts/audits/chaingpt-2026-04-25-f4.md`.
 *
 * Per docs.chaingpt.org:
 *   POST https://api.chaingpt.org/chat/stream
 *   Authorization: Bearer YOUR_API_KEY
 *   { "model": "smart_contract_auditor", "question": "<Solidity source>",
 *     "chatHistory": "off" }
 *
 * The stream returns `data: <text>\n\n` SSE-ish chunks. We concatenate.
 */

import {readFileSync, writeFileSync, mkdirSync, existsSync} from "node:fs";

const ENDPOINT = "https://api.chaingpt.org/chat/stream";
const KEY = process.env["CHAINGPT_API_KEY"]?.trim();
if (!KEY) {
  console.error("[audit-f4] CHAINGPT_API_KEY missing");
  process.exit(1);
}

const TARGETS = [
  "src/TestUSDC.sol",
  "src/ConfidentialUSDC.sol",
  "src/Market.sol",
  "src/MarketRegistry.sol",
  "src/ResolutionOracle.sol",
  "src/oracles/AdminOracle.sol",
  "src/oracles/PreResolvedOracle.sol",
  "src/oracles/ChainlinkPriceOracle.sol",
  "src/ClaimVerifier.sol",
  "src/FeeVault.sol",
];

async function audit(name: string, source: string): Promise<string> {
  const body = {
    model: "smart_contract_auditor",
    question:
      `Audit the following Solidity contract from the DarkOdds prediction-market codebase. ` +
      `Surface every issue at LOW / MEDIUM / HIGH / CRITICAL severity. Highlight any ` +
      `reentrancy, access-control, ACL, integer-overflow, signature-replay, oracle-manipulation, ` +
      `or proxy-pattern concerns specifically. Source for ${name}:\n\n` +
      "```solidity\n" +
      source +
      "\n```",
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
  // The stream is text — concatenate everything.
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
  const auditDir = `${process.cwd()}/contracts/audits`;
  if (!existsSync(auditDir)) mkdirSync(auditDir, {recursive: true});
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = `${auditDir}/chaingpt-${date}-f4.md`;

  const lines: string[] = [
    `# ChainGPT Smart Contract Auditor — F4 pass`,
    ``,
    `**Date:** ${date}`,
    `**Model:** \`smart_contract_auditor\``,
    `**Endpoint:** ${ENDPOINT}`,
    `**Contracts audited:** ${TARGETS.length}`,
    ``,
    `Each section below is the raw model response for the named contract. Operator must triage findings ≥ medium severity per PRD §F4.5; fixes either land in source or get documented in \`KNOWN_LIMITATIONS.md\` as accepted risk.`,
    ``,
    `---`,
    ``,
  ];

  for (const target of TARGETS) {
    const fullPath = `${process.cwd()}/contracts/${target}`;
    if (!existsSync(fullPath)) {
      console.warn(`[audit-f4] ${target} not found, skipping`);
      continue;
    }
    const source = readFileSync(fullPath, "utf8");
    console.log(`[audit-f4] auditing ${target} (${source.length} chars)...`);
    const start = Date.now();
    try {
      const out = await audit(target, source);
      const ms = Date.now() - start;
      console.log(`[audit-f4]   ${ms}ms, ${out.length} chars`);
      lines.push(`## ${target}`, ``, out, ``, `---`, ``);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[audit-f4]   FAILED: ${msg}`);
      lines.push(`## ${target}`, ``, `**ChainGPT request failed:** \`${msg}\``, ``, `---`, ``);
    }
  }

  writeFileSync(reportPath, lines.join("\n"));
  console.log(`[audit-f4] wrote ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
