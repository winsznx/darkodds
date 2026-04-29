# Polymarket Gamma API integration

**Status:** v1, written against live API on 2026-04-28.
**Scope:** read-only display layer. DarkOdds never writes back to Gamma; we render odds + metadata side-by-side with our own private markets.

---

## Endpoint we use

```
GET https://gamma-api.polymarket.com/markets
```

The list endpoint. Two important query knobs:

| Param         | Value we send | Why                                                                                                                |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `active`      | `true`        | Hides resolved/archived markets from the default feed.                                                             |
| `closed`      | `false`       | Same — drops post-resolution rows.                                                                                 |
| `order`       | `volume24hr`  | Default sort. Surfaces the most-traded contracts first, matches what /markets renders.                             |
| `ascending`   | `false`       | Descending by volume.                                                                                              |
| `limit`       | up to 100     | Gamma silently caps higher requests; 100 is plenty for the dashboard. Pagination via `offset`.                     |
| `offset`      | 0..N          | Pagination, when needed.                                                                                           |
| `include_tag` | `true`        | **Critical.** Without it, the response has no `tags` field. With it, each market gets a `tags: TagObject[]` array. |
| `slug`        | `<slug>`      | Used by `/create` clone flow to look up a market by URL slug; returns `[market]` on hit.                           |

For single-market lookups (e.g. `/api/polymarket/market/[id]`):

```
GET https://gamma-api.polymarket.com/markets/{id}?include_tag=true
```

Same shape as a list element, returned as a single object.

---

## Cache + error policy

- **Primary fetch:** Next.js 16 fetch with `{next: {revalidate: 60}}` for the list, `30` for single-market.
- **On 5xx / network / timeout:** retry once after 250 ms. Then fall through to degraded.
- **Degraded:** `{ok: false, data: [], error: {...}}` (list) or `{ok: false, data: null, error: {...}}` (single). UI renders an "external markets temporarily unavailable" stamp instead of crashing.
- **Timeout:** 6 s per request via `AbortController`.
- **Never throws.** Every consumer pattern-matches on `result.ok`.

---

## Real wire shape (top-level keys, sample fetched 2026-04-28)

A market with `include_tag=true` returns ~80 keys. The ones we care about:

```jsonc
{
  // identity
  "id": "2036399",                          // string — Polymarket numeric ID
  "conditionId": "0x1d2787cb...",           // 0x-prefixed bytes32
  "slug": "us-x-iran-ceasefire-extended-by-april-22-2026",
  "questionID": "0xae907dab...",            // separate from conditionId

  // content
  "question": "US x Iran ceasefire extended by April 22, 2026?",
  "description": "This market will resolve to \"Yes\" if...",  // long prose
  "image": "https://polymarket-upload.s3.../Cgmx3GCuOwjs.jpg",
  "icon":  "https://polymarket-upload.s3.../Cgmx3GCuOwjs.jpg",  // often duplicate of image

  // outcomes — JSON-STRINGIFIED. Both fields are strings on the wire.
  "outcomes":       "[\"Yes\", \"No\"]",
  "outcomePrices":  "[\"0.0025\", \"0.9975\"]",
  "clobTokenIds":   "[\"50049642...\", \"110959653...\"]",  // YES / NO ERC-1155 token ids

  // numeric volume / liquidity (number form — *Num suffix, prefer these)
  "volumeNum":     87607726.61575776,
  "liquidityNum":  13730264.37866,
  "volume24hr":    18075080.84806113,
  "volume1wk":     87466603.35544878,
  "volume1mo":     87607726.61575776,
  "volume1yr":     87607726.61575776,

  // string-encoded duplicates (older API surface) — we ignore these
  "volume":     "87607726.61575776",
  "liquidity":  "13730264.37866",

  // dates — ISO 8601 strings. Use endDateIso/startDateIso (they're consistently zoned).
  "endDate":      "2026-04-21T00:00:00Z",
  "endDateIso":   "2026-04-21",
  "startDate":    "2026-04-20T19:37:22.15054Z",
  "startDateIso": "2026-04-20",
  "createdAt":    "2026-04-20T19:28:43.717892Z",
  "updatedAt":    "2026-04-28T16:33:42.833164Z",
  "acceptingOrdersTimestamp": "2026-04-20T19:36:18Z",

  // status flags
  "active":           true,
  "closed":           false,
  "acceptingOrders":  true,
  "approved":         true,
  "archived":         false,
  "restricted":       true,    // geo-restricted in some jurisdictions
  "featured":         false,
  "new":              false,

  // resolution
  "resolutionSource":      "",                                  // often empty; UMA-resolved
  "resolvedBy":            "0x65070BE9...",                    // resolver multisig/oracle
  "umaResolutionStatus":   "disputed",                         // proposed | disputed | resolved | ""

  // group + event metadata
  "groupItemTitle":     "April 22",                            // title within a multi-market event
  "groupItemThreshold": "3",
  "events": [                                                  // length 0 or 1; parent event
    {
      "id":     "357625",
      "slug":   "us-x-iran-ceasefire-extended-by",
      "ticker": "us-x-iran-ceasefire-extended-by",
      "title":  "US x Iran ceasefire extended by...?"
      // ... ~30 more event fields we don't surface
    }
  ],

  // tags — ONLY present when ?include_tag=true was on the request
  "tags": [
    {"id": "2",     "label": "Politics",    "slug": "politics", "forceShow": false, ...},
    {"id": "78",    "label": "Iran",        "slug": "iran"},
    {"id": "100265","label": "Geopolitics", "slug": "geopolitics", "forceShow": true},
    // ... up to ~10 tags. First non-`forceHide` one is what we surface as `category`.
  ],

  // pricing internals (we ignore for cards but expose for /create)
  "lastTradePrice": 0.003,
  "bestBid":        0.002,
  "bestAsk":        0.003,
  "spread":         0.001,
  "orderPriceMinTickSize": 0.001,
  "orderMinSize":          5
}
```

---

## Quirks worth knowing about

### 1. JSON-stringified arrays

`outcomes`, `outcomePrices`, `clobTokenIds` are **strings**, not arrays.
Every consumer must parse via `JSON.parse(raw.outcomes)`. We do this exactly once in `lib/polymarket/client.ts → normalizeMarket()`. Anywhere else is a bug.

### 2. There is no top-level `category` field

The `category` field DarkOdds surfaces is derived: `tags[0].label` (after filtering `forceHide=true` tags). If the API stops returning tags or returns an empty array, `category` is `null`. Don't rely on it for required logic.

### 3. There is no `closedTime` field

Polymarket exposes `closed: bool` (current state) and `endDate` (scheduled expiry). When `closed === true`, `updatedAt` is the closest proxy for "when it closed." We don't surface a `closedTime` because it doesn't exist on the wire.

### 4. Two volume/liquidity field families

`volumeNum` / `liquidityNum` are real numbers. `volume` / `liquidity` are strings of the same value (legacy). We use the `Num` variants. The `*Clob` variants (`volume24hrClob`, `liquidityClob`) match the regular ones for CLOB-resolved markets and zero out for AMM markets — we treat them as identical for display.

### 5. `image` vs `icon`

For cards we prefer `image`. If null, fall back to `icon`. They're typically identical S3 URLs but `icon` sometimes points to a square crop. The normalizer surfaces both; UI picks per-context.

### 6. Date fields

`endDateIso` / `startDateIso` are date-only (`YYYY-MM-DD`). `endDate` / `startDate` are full ISO timestamps. Prefer `*Iso` for the display "Resolves Apr 21, 2026" string; prefer the full timestamp for sort comparators. Watch for `null` on evergreen markets.

### 7. Pagination silently bounds

`?limit=500` returns at most ~250 (cap rotates by season). For ranking, paginate via `offset` and accumulate.

### 8. Single-market endpoint omits `events`

`GET /markets/{id}` (single) returns the market object **without** the `events` array, even though the list endpoint (`GET /markets?...`) includes it as a join. Consequence: `eventId`, `eventSlug`, `eventTitle` are always `null` on the normalized output of `getMarketById()`. If a caller needs event metadata for a specific id, fetch via `getMarkets({slug: ...})` instead — the slug filter goes through the list endpoint and includes the join.

### 9. 422, not 404, for nonexistent ids

Asking for an id that doesn't exist (e.g. `GET /markets/9999999999`) returns **HTTP 422 Unprocessable Entity**, not 404. Our route handler at `/api/polymarket/market/[id]` treats any 4xx as "not found" so callers can distinguish a missing id from a Gamma outage cleanly.

---

## What we surface in `PolymarketMarket`

See `web/lib/polymarket/types.ts`. The normalized shape strips the noise: parsed outcomes, real Date instances, `category` derived from tags, raw `tags` array preserved for UI filters, a `clobTokenIds: [yes, no]` parsed pair for the `/create` clone path, and the parent event's `id`/`slug`/`title` flattened up.
