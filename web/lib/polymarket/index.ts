/**
 * Polymarket data layer — public API.
 *
 * F8 ships display-only consumption from the Gamma read APIs:
 *  - `getMarkets` — used by `/markets` server component to render the right
 *    column of the parallel feed.
 *  - `getMarketById` / `getMarketBySlug` — used by F11 clone flow when
 *    seeding a DarkOdds market from a Polymarket question.
 *
 * No CLOB writes. No proxied trading. We display public data and link out
 * to `polymarket.com/event/<slug>`. Polymarket's own geo-gate handles
 * restricted regions on their domain.
 *
 * Implementation notes:
 *  - Server-side only. Never import from a client component.
 *  - Caching uses Next.js 16 "Previous Model": fetch + next.revalidate.
 *  - The single JSON.parse() site for `outcomes` / `outcomePrices` lives
 *    inside `client.ts`. Components and the F11 flow consume real arrays.
 *  - All public functions return `PolymarketResult<T>` — even on failure,
 *    `data` is set so UI can render degraded-but-rendering empty states.
 */

export {getMarkets, getMarketById, getMarketBySlug} from "./client";
export type {
  GetMarketsFilters,
  PolymarketError,
  PolymarketErrorKind,
  PolymarketEventId,
  PolymarketMarket,
  PolymarketMarketId,
  PolymarketOutcome,
  PolymarketResult,
} from "./types";
