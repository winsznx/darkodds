"use client";

/**
 * Client-side localStorage helpers for "markets I created."
 *
 * Fast path for the MINE filter — instant flag without an RPC roundtrip,
 * available on the same device the deploy happened on. The authoritative
 * path lives server-side at /api/markets/created-by/[address] (see
 * lib/markets/created-ledger.ts); the MINE filter merges both sources.
 *
 * Storage shape:
 *   localStorage['darkodds.created-markets'] = JSON.stringify(CreatedMarket[])
 *
 * Stays bound to the browser/device — clearing storage or switching
 * devices loses every entry, which is why the server ledger is the
 * load-bearing path. This file is the optimization, not the source of
 * truth.
 */

const STORAGE_KEY = "darkodds.created-markets";

export interface CreatedMarket {
  /** Market id as a string (bigint serialization). */
  id: string;
  /** Unix milliseconds when the deploy succeeded. */
  deployedAt: number;
  /** First 200 chars of the question, for the post-deploy banner. */
  question: string;
}

function safeRead(): CreatedMarket[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is CreatedMarket =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as CreatedMarket).id === "string" &&
        typeof (m as CreatedMarket).deployedAt === "number" &&
        typeof (m as CreatedMarket).question === "string",
    );
  } catch {
    return [];
  }
}

function safeWrite(arr: CreatedMarket[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // private mode / quota — caller's flow doesn't depend on this
  }
}

/** Append a market to localStorage. No-op on duplicate id. */
export function recordCreatedMarketLocal(market: CreatedMarket): void {
  const arr = safeRead();
  if (arr.some((m) => m.id === market.id)) return;
  arr.push({...market, question: market.question.slice(0, 200)});
  safeWrite(arr);
}

/** Read every locally-recorded market. Sorted newest first. */
export function listCreatedMarketsLocal(): CreatedMarket[] {
  return [...safeRead()].sort((a, b) => b.deployedAt - a.deployedAt);
}

/** Set of market ids the local browser recorded. */
export function localCreatedIdSet(): Set<string> {
  return new Set(safeRead().map((m) => m.id));
}

/** Wipe everything — operator escape hatch + test affordance. */
export function clearCreatedMarketsLocal(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
