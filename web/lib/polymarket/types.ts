/**
 * Polymarket Gamma API — typed shapes for DarkOdds consumption.
 *
 * Two layers:
 *
 *   1. `GammaMarketRaw` — what the wire returns. NOT exported. Lives next to
 *      `client.ts` so it can type the raw response, but components and
 *      callers must never see it. The `outcomes`, `outcomePrices`, and
 *      `clobTokenIds` fields are JSON-stringified arrays on the wire (see
 *      docs/POLYMARKET_INTEGRATION.md → "JSON-stringified arrays"); the
 *      normalizer parses them exactly once.
 *
 *   2. `PolymarketMarket` — the normalized public type every consumer uses.
 *      Outcomes are real arrays. Probabilities are real numbers. Dates are
 *      `Date` instances. Tags are surfaced both as the raw array (for
 *      filtering) and a derived `category` string (for cards).
 *
 * F11 reuse note: `eventSlug`, `eventId`, and `clobTokenIds` are populated
 * even though the F8 UI doesn't render them — the `/create` clone flow
 * needs them to seed a DarkOdds clone from a Polymarket question.
 */

// ────────────────────────────────────────────────────────────────────────────
// Branded ID types — keep Polymarket numeric IDs from being confused with
// DarkOdds market IDs (which are uint256 strings from MarketRegistry).
// ────────────────────────────────────────────────────────────────────────────

export type PolymarketMarketId = string & {readonly __brand: "PolymarketMarketId"};
export type PolymarketEventId = string & {readonly __brand: "PolymarketEventId"};

export const polymarketMarketId = (raw: string): PolymarketMarketId => raw as PolymarketMarketId;
export const polymarketEventId = (raw: string): PolymarketEventId => raw as PolymarketEventId;

// ────────────────────────────────────────────────────────────────────────────
// Public normalized types
// ────────────────────────────────────────────────────────────────────────────

export interface PolymarketOutcome {
  /** Display label, e.g. "Yes" / "No" / "Lakers" / "Rockets". */
  label: string;
  /** Probability 0..1. Parsed from the JSON-stringified probabilities array. */
  probability: number;
}

export interface PolymarketTag {
  id: string;
  label: string;
  slug: string;
  /** Some tags are server-side hidden from the public-facing pickers. */
  forceHide?: boolean;
  forceShow?: boolean;
}

export interface PolymarketMarket {
  // Identity
  id: PolymarketMarketId;
  conditionId: `0x${string}`;
  slug: string;

  /** Computed: `https://polymarket.com/event/<eventSlug ?? slug>`. */
  url: string;

  // Content
  question: string;
  /** Long prose. May be empty string. */
  description: string;
  /** Group-multimarket label, e.g. "April 22" within a parent event. */
  groupItemTitle: string | null;

  /** First non-`forceHide` tag's label, or null if no tags. Convenience for
   *  category pills on cards. */
  category: string | null;
  /** Full tag array for filter UIs. */
  tags: PolymarketTag[];

  // Dates
  /** Scheduled close — null for evergreen markets. */
  endDate: Date | null;
  /** First listed-for-trading timestamp. */
  startDate: Date | null;

  // Outcomes
  outcomes: PolymarketOutcome[];
  /** YES/NO ERC-1155 token IDs (parsed from clobTokenIds), parallel to
   *  `outcomes`. Used by the /create clone flow. Empty array if Gamma
   *  didn't surface them (rare). */
  clobTokenIds: string[];

  // Volume / liquidity in USD, plaintext (this is the visual contrast
  // against DarkOdds' redacted bars on /markets).
  volumeUsd: number;
  volume24hrUsd: number;
  liquidityUsd: number;

  // Status flags (collapsed null → false on normalize).
  active: boolean;
  closed: boolean;
  /** Proxy for "is bettable right now" — reflects orderbook open state. */
  acceptingOrders: boolean;

  // Imagery (for cards)
  imageUrl: string | null;
  iconUrl: string | null;

  // Resolution
  /** Where the outcome will be sourced. Often empty (UMA-resolved). */
  resolutionSource: string;

  // Event metadata for /create clone flow.
  eventId: PolymarketEventId | null;
  eventSlug: string | null;
  eventTitle: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Result envelope — degraded-but-rendering pattern. UI gets `data` even when
// the call failed, plus `error` describing what went wrong so empty-state
// stamps can render an appropriate message.
// ────────────────────────────────────────────────────────────────────────────

export type PolymarketErrorKind = "timeout" | "5xx" | "network" | "404" | "parse";

export interface PolymarketError {
  kind: PolymarketErrorKind;
  message: string;
  /** HTTP status if relevant. */
  status?: number;
}

export type PolymarketResult<T> = {ok: true; data: T} | {ok: false; data: T; error: PolymarketError};

// ────────────────────────────────────────────────────────────────────────────
// Filter shape for getMarkets()
// ────────────────────────────────────────────────────────────────────────────

export interface GetMarketsFilters {
  active?: boolean;
  closed?: boolean;
  /** Server-side ordering. */
  order?: "volume24hr" | "endDate" | "createdAt" | "liquidityNum";
  ascending?: boolean;
  /** 1..100. Default 100. Gamma silently caps higher requests. */
  limit?: number;
  offset?: number;
  /**
   * Category filter is not a Gamma server-side query param — we do
   * client-side filtering after fetch (matches against any tag label).
   */
  category?: string;
}
