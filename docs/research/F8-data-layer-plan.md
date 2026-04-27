# F8 Data Layer Plan — Polymarket Gamma + Next 16 caching

_Drafted 2026-04-27 during F8 HALT 0._
_Sample JSON: `polymarket-gamma-2026-04-27.json` (3 markets, 24 KB)._

## Stance: display-only, no proxied trading

DarkOdds renders Polymarket public market data on `/markets` and links out to
`polymarket.com/event/<slug>` via plain hyperlinks. We don't proxy trading;
no CLOB `place_order`, no embedded trading widgets. Polymarket's own
geo-restriction handling fires on their domain when users follow the link.
The F11 "MIRROR ON DARKODDS" flow is a separate clone that creates a fresh
DarkOdds market on Arb Sepolia — zero trading involvement on Polymarket's
side. To be logged in `DRIFT_LOG.md` and `KNOWN_LIMITATIONS.md` at end of
phase.

## Endpoints we will use

Base URL: **`https://gamma-api.polymarket.com`**. No auth required.

| Function                                                  | Endpoint                                         | Cache (Next.js fetch) |
| --------------------------------------------------------- | ------------------------------------------------ | --------------------- |
| `getMarkets({active, closed, order, limit, offset, ...})` | `GET /markets?…`                                 | `next.revalidate: 60` |
| `getMarketById(id)`                                       | `GET /markets/{id}`                              | `next.revalidate: 30` |
| `getMarketBySlug(slug)`                                   | `GET /markets?slug={slug}` (returns array of ≤1) | `next.revalidate: 30` |

Endpoints we are **not** using in F8:

- `/events` (categorical/event aggregation — F11 clone may use it for grouped resolutions)
- `/markets/{id}/clob` (orderbook info, trading-only)
- `/data/*` (positions, fills — trading)
- Anything in `clob-openapi.yaml` (trading)

## Live verification (2026-04-27, no auth)

Every test passed. From terminal:

```sh
curl -fsS "https://gamma-api.polymarket.com/markets?limit=3&active=true&closed=false&order=volume24hr&ascending=false"
# HTTP 200, 24559 bytes, 3 markets

curl -fsS "https://gamma-api.polymarket.com/markets/2036399"
# HTTP 200, 4892 bytes, single market dict

curl -fsS "https://gamma-api.polymarket.com/markets?slug=us-x-iran-ceasefire-extended-by-april-22-2026"
# HTTP 200, 9272 bytes, array of 1
```

20 requests in ~2s with no throttling — undocumented limit but generous in
practice. Our 60s revalidate for list / 30s for single means one cache key
hits Gamma at most ~1 request/min, well under any plausible cap.

## Schema notes (from live response)

A market is binary YES/NO almost always. The four critical fields:

```ts
type GammaMarketRaw = {
  id: string; // numeric string
  conditionId: string; // 0x-prefixed
  slug: string; // url slug
  question: string | null;
  category: string | null;

  // JSON-STRINGIFIED ARRAYS — the gotcha:
  outcomes: string; // e.g. '["Yes", "No"]'
  outcomePrices: string; // e.g. '["0.0015", "0.9985"]' (probabilities, sum ~= 1)

  // Volume/liquidity as numeric (already parsed):
  volumeNum: number | null;
  liquidityNum: number | null;
  volume24hr: number | null;

  // Timing:
  endDate: string | null; // ISO-8601, may be null for evergreen
  endDateIso: string | null;

  // Status flags:
  active: boolean | null;
  closed: boolean | null;
  archived: boolean | null;
  acceptingOrders: boolean | null;

  // Visual:
  image: string | null;
  icon: string | null;

  // … + 50 other fields we don't use (events, tags, AMM-vs-CLOB splits, etc.)
};
```

### Outcome shape — binary vs categorical

Of the 20 highest-volume active markets, **all 20 are binary YES/NO**.
Categorical/multi-outcome markets exist on Polymarket but are modeled as
**collections of binary sub-markets bundled inside an event**. Example:
event `nba-lal-hou-2026-04-26` has 44 sub-markets, each binary. Each
sub-market is its own row in `/markets`.

For F8 we treat every market as binary. Card UI shows YES/NO with their
probabilities. Multi-outcome event aggregation is post-MVP (relevant in F11
if the operator wants the clone flow to mirror an entire event).

## TypeScript shape we'll expose

```ts
// Branded numeric IDs so a Polymarket id can never be confused with a
// DarkOdds market id (which is a uint256).
export type PolymarketMarketId = string & {readonly __brand: "PolymarketMarketId"};

export interface PolymarketOutcome {
  label: string; // "Yes" / "No" / categorical label
  probability: number; // 0–1, parsed from outcomePrices
}

export interface PolymarketMarket {
  id: PolymarketMarketId;
  conditionId: `0x${string}`;
  slug: string;
  url: string; // computed: https://polymarket.com/event/<slug>
  question: string;
  category: string | null;
  endDate: Date | null;
  outcomes: PolymarketOutcome[];
  volumeUsd: number;
  volume24hrUsd: number;
  liquidityUsd: number;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  imageUrl: string | null;
}

// On error, callers receive a typed result so empty-state UI can read
// `result.error.kind` and render an appropriate stamp.
export type PolymarketResult<T> =
  | {ok: true; data: T}
  | {ok: false; data: T; error: {kind: "timeout" | "5xx" | "network" | "404" | "parse"; message: string}};
```

### Public API

```ts
// web/lib/polymarket/index.ts

export async function getMarkets(filters: {
  active?: boolean;
  closed?: boolean;
  category?: string;
  order?: "volume24hr" | "endDate" | "createdAt";
  ascending?: boolean;
  limit?: number;
  offset?: number;
}): Promise<PolymarketResult<PolymarketMarket[]>>;

export async function getMarketById(
  id: PolymarketMarketId,
): Promise<PolymarketResult<PolymarketMarket | null>>;

export async function getMarketBySlug(slug: string): Promise<PolymarketResult<PolymarketMarket | null>>;
```

`getMarketBySlug` is the F11 reuse target — `/create` will call it to seed
a DarkOdds clone from a Polymarket question. It needs `question`, `category`,
`endDate`, `outcomes`, `slug` — all in the shape above.

## Caching strategy

**Per the F7 prompt's "no training memory" rule, I verified Next.js 16.2.4
caching docs fresh.** Two modes available:

1. **Cache Components** (`cacheComponents: true` in `next.config.ts`) — opts
   in to Partial Prerendering. Components must use `'use cache'` + `cacheLife()`
   from `next/cache` OR be wrapped in `<Suspense>`. **This forces a migration
   of every existing route**, which is out of scope for F8.

2. **Previous Model** (`cacheComponents: false`, the default) — supports
   `fetch(url, {next: {revalidate: N}})` per-call and per-route
   `export const revalidate = N`. Documented and current. This is what F8
   will use.

> Migration to Cache Components can be a separate phase — adding `'use cache'`
> would be one-line per data function once the route tree is `<Suspense>`-wrapped.
> Out of scope for F8. Logged in DRIFT.

### Concrete cache values

| What                                   | revalidate            | Why                                                                                                   |
| -------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `/markets` list endpoint               | 60s                   | Lists drift slowly (new featured markets weekly); judges seeing the page won't hit Gamma per pageview |
| Single market by id/slug               | 30s                   | When F11 clones a market, we want fresher state — but 30s is still infra-friendly                     |
| DarkOdds `MarketRegistry.nextMarketId` | client-side via wagmi | Already cached by react-query default 5s                                                              |

## Error handling

Each public function returns `PolymarketResult<T>` with `data` set even on
failure:

- **list errors** → `data: []`, `error.kind`
- **single 404** → `data: null`, `error.kind: "404"`
- **5xx** → retry once with exponential backoff (250ms), then return `data: []`/`null`
- **timeout** → 6s upper bound (Next.js fetch default + custom AbortSignal), then `kind: "timeout"`
- **JSON parse error** → `kind: "parse"`, log to server console for triage

This shape lets the UI render the DarkOdds column normally even when the
Polymarket column has degraded — the Polymarket column shows a
"POLYMARKET DATA UNAVAILABLE" stamp + retry. No global error swallowed.

## Files to land at HALT 1

```
web/lib/polymarket/types.ts                # interfaces + branded types
web/lib/polymarket/client.ts               # fetch wrappers + normalizers
web/lib/polymarket/index.ts                # public API + JSDoc + F11 reuse note
web/lib/polymarket/__tests__/client.test.ts # vitest, gated behind ENABLE_POLYMARKET_TESTS=1
web/lib/polymarket/__smoke__.ts            # tsx-runnable smoke
docs/research/polymarket-gamma-2026-04-27.json  # already saved
docs/research/F8-data-layer-plan.md        # this file
```

(Vitest as a new devDep — not yet in `web/package.json`. If the operator
prefers to defer testing infrastructure to a later phase, smoke script alone
suffices; both options listed in HALT 1.)

## Surprises vs initial assumptions

- **`outcomes` and `outcomePrices` are JSON-stringified, not arrays.** Have
  to `JSON.parse()` after fetch. Easy to miss; the OpenAPI spec lists them
  as `type: string` which is technically correct but unhelpful — they're
  always serialized arrays of strings.
- **No documented rate limit on Gamma read endpoints.** Polymarket has a
  rate-limits page but it covers CLOB. Gamma list/single appears unlimited
  in practice. Our 60s revalidate is conservative.
- **Categorical markets don't exist as a schema variant.** They're always
  arrangements of binary sub-markets under a parent event. The `marketType`
  / `formatType` fields returned `null` on every market we sampled.
- **No `marketType` distinction yet.** Both fields were `null` in samples.
  We won't branch on these.
- **`endDate` can be `null`** (evergreen markets). Card UI must handle this.
