/**
 * chaingpt-audit.ts — F10 CI audit tool.
 *
 * Audits all contracts in contracts/src/*.sol via the ChainGPT Smart Contract
 * Auditor API. Saves a single consolidated report to:
 *   contracts/audits/chaingpt-{YYYY-MM-DD}.md
 *
 * Usage:
 *   CHAINGPT_API_KEY=<key> tsx tools/chaingpt-audit.ts
 *
 * Run by .github/workflows/chaingpt-audit.yml on every push to main.
 */

import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const ENDPOINT = "https://api.chaingpt.org/chat/stream";
const KEY = process.env["CHAINGPT_API_KEY"]?.trim();

if (!KEY) {
  console.error("[chaingpt-audit] CHAINGPT_API_KEY missing");
  process.exit(1);
}

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "contracts", "src");
const AUDIT_DIR = join(ROOT, "contracts", "audits");

const today = new Date().toISOString().slice(0, 10);
const OUT_FILE = join(AUDIT_DIR, `chaingpt-${today}.md`);

async function auditContract(name: string, source: string): Promise<string> {
  const body = {
    model: "smart_contract_auditor",
    question:
      `Audit the following Solidity contract from DarkOdds — a confidential ` +
      `prediction market on Arbitrum Sepolia using iExec Nox for encrypted bet sizes.\n\n` +
      `Report every finding categorized as LOW / MEDIUM / HIGH / CRITICAL.\n\n` +
      `Source for ${name}:\n\n\`\`\`solidity\n${source}\n\`\`\``,
    chatHistory: "off",
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {Authorization: `Bearer ${KEY}`, "Content-Type": "application/json"},
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("no stream body");

  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    out += decoder.decode(value, {stream: true});
  }
  out += decoder.decode();
  return out;
}

async function main(): Promise<void> {
  if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, {recursive: true});

  const solFiles = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".sol"))
    .sort();

  console.log(`[chaingpt-audit] ${solFiles.length} contracts to audit → ${OUT_FILE}`);

  const sections: string[] = [
    `# ChainGPT Smart Contract Audit — DarkOdds`,
    ``,
    `_Generated ${new Date().toISOString()} by \`tools/chaingpt-audit.ts\`._`,
    ``,
    `**Contracts audited:** ${solFiles.join(", ")}`,
    ``,
    `---`,
    ``,
  ];

  for (const file of solFiles) {
    const filePath = join(SRC_DIR, file);
    const source = readFileSync(filePath, "utf8");
    console.log(`[chaingpt-audit]   auditing ${file}...`);

    const t0 = Date.now();
    try {
      const result = await auditContract(file, source);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      sections.push(`## ${file}`, ``, `_Audit completed in ${elapsed}s._`, ``, result, ``, `---`, ``);
      console.log(`[chaingpt-audit]   ${file} done (${result.length} chars, ${elapsed}s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sections.push(`## ${file}`, ``, `**AUDIT FAILED:** ${msg}`, ``, `---`, ``);
      console.error(`[chaingpt-audit]   ${file} FAILED:`, msg);
    }
  }

  writeFileSync(OUT_FILE, sections.join("\n"));
  console.log(`[chaingpt-audit] report written → ${OUT_FILE}`);
}

void main();
