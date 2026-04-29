/**
 * Created-by ledger — maps `creator address → market ids`.
 *
 * Recorded by `/api/admin/deploy-market` whenever a sponsored deploy
 * succeeds + setAdapter completes. Read by `/api/markets/created-by/
 * [address]` for the MINE filter on `/markets`.
 *
 * Why server-side: MarketRegistry.sol does not store a creator field
 * (audited in docs/RESOLUTION_AUDIT_2026-04-29.md). Sponsored deploys
 * have `msg.sender === DEPLOYER_PRIVATE_KEY`, so the on-chain trail
 * doesn't lead back to the user's connected wallet. The frontend's
 * localStorage path is fast but device-bound; this server ledger is
 * the authoritative path that survives browser clears + device
 * switches.
 *
 * Self-signed deploys (when the deployer EOA self-deploys via /create
 * instead of going through the sponsored API route) are NOT recorded
 * here. That's intentional — only sponsored deploys representing
 * user-initiated creation are tracked. See KNOWN_LIMITATIONS.
 *
 * Backend selection mirrors the airdrop ledger:
 *   - Vercel KV when `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set
 *   - JSON file at /tmp/created-by-ledger.json otherwise (per-instance
 *     ephemeral on Vercel; doesn't survive deploy cycles)
 */

import "server-only";

import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";

const FILE_PATH = process.env.CREATED_BY_LEDGER_PATH?.trim() || "/tmp/created-by-ledger.json";

interface Ledger {
  /** lowercased creator address → array of market id strings (insertion order). */
  byCreator: Record<string, string[]>;
  /** market id string → lowercased creator address. Useful for reverse lookup
   *  when a market detail page wants to confirm "is this connected wallet
   *  the creator?" without scanning the byCreator map. */
  byMarket: Record<string, string>;
}

function emptyLedger(): Ledger {
  return {byCreator: {}, byMarket: {}};
}

// ─── File backend ───────────────────────────────────────────────────────────

function readFileLedger(): Ledger {
  if (!existsSync(FILE_PATH)) return emptyLedger();
  try {
    const raw = readFileSync(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Ledger>;
    return {byCreator: parsed.byCreator ?? {}, byMarket: parsed.byMarket ?? {}};
  } catch {
    return emptyLedger();
  }
}

function writeFileLedger(l: Ledger): void {
  const dir = dirname(FILE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  writeFileSync(FILE_PATH, JSON.stringify(l, null, 2));
}

// ─── KV backend (lazy via createRequire so the package is optional) ────────

const KV_AVAILABLE = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
const KV_KEY = "darkodds:created-by-ledger";

interface KVClient {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
}

let kvCached: KVClient | null = null;

async function getKV(): Promise<KVClient | null> {
  if (!KV_AVAILABLE) return null;
  if (kvCached) return kvCached;
  try {
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

async function readLedger(): Promise<Ledger> {
  const kv = await getKV();
  if (kv) {
    const stored = await kv.get<Ledger>(KV_KEY);
    return stored ?? emptyLedger();
  }
  return readFileLedger();
}

async function writeLedger(l: Ledger): Promise<void> {
  const kv = await getKV();
  if (kv) {
    await kv.set(KV_KEY, l);
    return;
  }
  writeFileLedger(l);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Record a successful sponsored deploy. No-ops on duplicate marketId
 * (the ledger entry stands; first writer wins).
 */
export async function recordCreator(marketId: string, creator: string): Promise<void> {
  const ledger = await readLedger();
  const c = creator.toLowerCase();
  if (ledger.byMarket[marketId]) return;
  const list = ledger.byCreator[c] ?? [];
  list.push(marketId);
  ledger.byCreator[c] = list;
  ledger.byMarket[marketId] = c;
  await writeLedger(ledger);
}

/**
 * List market ids created by the given address. Returns an empty array
 * if the address has no entries (unknown creator) — never throws.
 */
export async function listMarketsByCreator(creator: string): Promise<string[]> {
  const ledger = await readLedger();
  return ledger.byCreator[creator.toLowerCase()] ?? [];
}

export function persistenceIsDurable(): boolean {
  return KV_AVAILABLE;
}
