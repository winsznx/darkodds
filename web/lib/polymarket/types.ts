/**
 * Polymarket Gamma API — typed shapes for DarkOdds consumption.
 *
 * Two layers:
 *
 *   1. `GammaMarketRaw` — what the wire returns. NOT exported. Lives here so
 *      `client.ts` can type the raw response, but components and callers must
 *      never see it. The `outcomes` and `outcomePrices` fields are
 *      JSON-stringified arrays on the wire (see feedback.md "JSON-stringified
 *      array footgun" entry); the normalizer in `client.ts` parses them
 *      exactly once.
 *
 *   2. `PolymarketMarket` — the normalized public type every consumer uses.
 *      Outcomes are real arrays. Probabilities are real numbers. Dates are
 *      `Date` instances. Any field a downstream caller might want is here.
 *
 * F11 reuse note: `eventSlug` and `eventId` are populated even though F8's
 * UI doesn't render them. The `/create` clone flow will need event metadata
 * to seed a DarkOdds clone from a Polymarket question; cheap to add now,
 * retrofit-tax later.
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

export interface PolymarketMarket {
  id: PolymarketMarketId;
  conditionId: `0x${string}`;
  slug: string;

  /** Computed: `https://polymarket.com/event/<eventSlug ?? slug>`. */
  url: string;

  question: string;
  category: string | null;

  /** May be null for evergreen / unbounded markets. */
  endDate: Date | null;

  outcomes: PolymarketOutcome[];

  // Volume / liquidity in USD, plaintext (this is the visual contrast
  // against DarkOdds' redacted bars on /markets).
  volumeUsd: number;
  volume24hrUsd: number;
  liquidityUsd: number;

  // Status flags (collapsed null → false on normalize).
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;

  imageUrl: string | null;

  // Event metadata for F11 clone flow. Markets always have an `events` array
  // of length 0 or 1 in our samples; we surface the parent event's ids
  // when present.
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
  /** 1..500. Default 50. Gamma silently caps. */
  limit?: number;
  offset?: number;
  /**
   * Category filter is not a Gamma server-side query param — we do
   * client-side filtering after fetch. Documented here so the type is
   * complete and the UI only has one place to filter.
   */
  category?: string;
}
