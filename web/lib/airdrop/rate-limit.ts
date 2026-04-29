/**
 * Airdrop rate-limit persistence.
 *
 * Two checks before the transfer:
 *   - per-address: each 0x... can claim AT MOST ONCE EVER
 *   - per-IP: an IP can request AT MOST 24 airdrops in a rolling 24-hour
 *             window (lets a cohort sharing one NAT'd IP onboard, while
 *             still bounding a single bot's drain rate)
 *
 * Backend selection at module load time:
 *   - if `KV_REST_API_URL` + `KV_REST_API_TOKEN` are present (Vercel KV
 *     auto-injects these), use KV — survives serverless cold starts and
 *     fans across regions
 *   - else fall back to a JSON file at /tmp/airdrop-history.json — works
 *     in dev and on Vercel (Vercel mounts /tmp per-instance ephemeral
 *     storage; not durable across deploys, but operator notes call this
 *     out and the address-once-ever check is also enforced on-chain via
 *     the airdrop wallet's tx history if KV is unavailable)
 */

import "server-only";

import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";

const FILE_PATH = process.env.AIRDROP_HISTORY_PATH?.trim() || "/tmp/airdrop-history.json";

interface History {
  /** address (lowercased) → unix-ms of grant. */
  addresses: Record<string, number>;
  /** IP (raw) → array of unix-ms timestamps. Pruned to last 24h on read. */
  ips: Record<string, number[]>;
}

const IP_WINDOW_MS = 24 * 60 * 60 * 1_000;
const IP_LIMIT_PER_WINDOW = 24;

function emptyHistory(): History {
  return {addresses: {}, ips: {}};
}

function readFileHistory(): History {
  if (!existsSync(FILE_PATH)) return emptyHistory();
  try {
    const raw = readFileSync(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<History>;
    return {addresses: parsed.addresses ?? {}, ips: parsed.ips ?? {}};
  } catch {
    return emptyHistory();
  }
}

function writeFileHistory(h: History): void {
  const dir = dirname(FILE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  writeFileSync(FILE_PATH, JSON.stringify(h, null, 2));
}

// ────────────────────────────────────────────────────────────────────────────
// Vercel KV path — lazy-loaded so the file path doesn't drag in @vercel/kv
// when the package isn't installed locally.
// ────────────────────────────────────────────────────────────────────────────

const KV_AVAILABLE = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

interface KVClient {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
}

let kvCached: KVClient | null = null;
async function getKV(): Promise<KVClient | null> {
  if (!KV_AVAILABLE) return null;
  if (kvCached) return kvCached;
  try {
    // createRequire so TS doesn't try to resolve "@vercel/kv" at compile
    // time — the package is optional and only present when the operator
    // attaches Vercel KV via a Vercel integration. Falls through to the
    // file-persistence path when not installed.
    const {createRequire} = await import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = nodeRequire("@vercel/kv") as any;
    if (!mod?.kv) return null;
    kvCached = mod.kv as KVClient;
    return kvCached;
  } catch {
    return null;
  }
}

const KV_KEY = "darkodds:airdrop-history";

async function readHistory(): Promise<History> {
  const kv = await getKV();
  if (kv) {
    const stored = await kv.get<History>(KV_KEY);
    return stored ?? emptyHistory();
  }
  return readFileHistory();
}

async function writeHistory(h: History): Promise<void> {
  const kv = await getKV();
  if (kv) {
    await kv.set(KV_KEY, h);
    return;
  }
  writeFileHistory(h);
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  ok: boolean;
  reason?: "address-already-airdropped" | "ip-rate-limit";
  /** When ok=false on ip-rate-limit, seconds until the IP can request again. */
  retryAfterSec?: number;
}

export async function hasAddressBeenAirdropped(address: string): Promise<boolean> {
  const h = await readHistory();
  return Boolean(h.addresses[address.toLowerCase()]);
}

export async function checkRateLimit(address: string, ip: string): Promise<RateLimitResult> {
  const h = await readHistory();
  if (h.addresses[address.toLowerCase()]) {
    return {ok: false, reason: "address-already-airdropped"};
  }
  const now = Date.now();
  const ipHits = (h.ips[ip] ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (ipHits.length >= IP_LIMIT_PER_WINDOW) {
    const oldest = Math.min(...ipHits);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + IP_WINDOW_MS - now) / 1000));
    return {ok: false, reason: "ip-rate-limit", retryAfterSec};
  }
  return {ok: true};
}

export async function recordAirdrop(address: string, ip: string): Promise<void> {
  const h = await readHistory();
  const now = Date.now();
  h.addresses[address.toLowerCase()] = now;
  const prior = (h.ips[ip] ?? []).filter((t) => now - t < IP_WINDOW_MS);
  prior.push(now);
  h.ips[ip] = prior;
  await writeHistory(h);
}

/** True if storage is durable across deploys (KV) vs ephemeral (file). */
export function persistenceIsDurable(): boolean {
  return KV_AVAILABLE;
}
