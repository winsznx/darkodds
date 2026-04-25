/**
 * One-shot: generate a fresh deployer key for Phase F2 and write it to .env.
 * The address is printed so the operator can fund the wallet on Arb Sepolia.
 *
 * Idempotent: refuses to overwrite an existing DEPLOYER_PRIVATE_KEY in .env
 * unless FORCE=1 is set. Safer than ad-hoc shell scripting.
 */

import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {generatePrivateKey, privateKeyToAccount} from "viem/accounts";

const ENV_PATH = `${process.cwd()}/.env`;

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(ENV_PATH)) return map;
  const raw = readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return map;
}

function writeEnv(map: Map<string, string>): void {
  const lines: string[] = [];
  for (const [k, v] of map) lines.push(`${k}=${v}`);
  writeFileSync(ENV_PATH, lines.join("\n") + "\n", {mode: 0o600});
}

const env = readEnv();
const force = process.env["FORCE"] === "1";

if (env.has("DEPLOYER_PRIVATE_KEY") && env.get("DEPLOYER_PRIVATE_KEY") && !force) {
  const existing = privateKeyToAccount(env.get("DEPLOYER_PRIVATE_KEY") as `0x${string}`);
  console.log(`[genkey] DEPLOYER_PRIVATE_KEY already present in .env`);
  console.log(`[genkey] Address: ${existing.address}`);
  console.log(`[genkey] Run with FORCE=1 to rotate.`);
  process.exit(0);
}

const pk = generatePrivateKey();
const acct = privateKeyToAccount(pk);

env.set("DEPLOYER_PRIVATE_KEY", pk);
if (!env.has("ARB_SEPOLIA_RPC_URL")) {
  env.set("ARB_SEPOLIA_RPC_URL", "https://sepolia-rollup.arbitrum.io/rpc");
}
writeEnv(env);

console.log(`[genkey] Generated fresh DEPLOYER_PRIVATE_KEY → /Users/mac/darkodds/.env`);
console.log(`[genkey] Address: ${acct.address}`);
console.log(`[genkey] Fund with ~0.05 ETH on Arbitrum Sepolia from:`);
console.log(`[genkey]   https://faucets.chain.link/arbitrum-sepolia`);
console.log(`[genkey]   https://www.alchemy.com/faucets/arbitrum-sepolia`);
console.log(`[genkey] After funding, reply "funded" to continue with deploy.`);
