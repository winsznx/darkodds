import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

import type {NextConfig} from "next";

/**
 * Bridge server-only secrets from the repo-root `.env` into the Next.js dev
 * server environment. Next.js only loads `web/.env*` by default; tools/* and
 * the F4 healthcheck use `<repo>/.env` so we'd otherwise need to duplicate
 * `DEPLOYER_PRIVATE_KEY`, `MULTISIG_SIGNER_2_PK`, `CHAINGPT_API_KEY` in two
 * places. This loader reads `<repo>/.env` ONCE at server boot and injects any
 * keys that aren't already set on `process.env`. Existing values (set in
 * `web/.env.local`, the host shell, or Vercel env) take precedence.
 *
 * No-ops if the parent .env is missing — production builds that rely on
 * platform env (Vercel) are unaffected.
 */
function bridgeRepoRootEnv(): void {
  const parentEnvPath = resolve(join(process.cwd(), "..", ".env"));
  let raw: string;
  try {
    raw = readFileSync(parentEnvPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

bridgeRepoRootEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // React Compiler stays off for now per PRD §F1 — re-evaluate once it's stable.
  poweredByHeader: false,
};

export default nextConfig;
