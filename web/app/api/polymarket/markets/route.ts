/**
 * GET /api/polymarket/markets
 *
 * Server-side proxy for `lib/polymarket/getMarkets()`. Surfaces the full
 * enriched Polymarket card payload (parsed outcomes, tags, image, group
 * title, clobTokenIds, etc.) to anywhere on the frontend that needs JSON
 * over the wire — currently the /markets featured strip and category
 * filter UIs in Section D.
 *
 * Query params (all optional):
 *   ?limit=N         1..100, default 100
 *   ?offset=N        pagination, default 0
 *   ?category=Crypto client-side filter against the surfaced category
 *   ?order=...       volume24hr | endDate | createdAt | liquidityNum
 *   ?ascending=bool  defaults to false (descending)
 *   ?active=bool     defaults to true
 *   ?closed=bool     defaults to false
 *
 * Cache: the underlying `getMarkets()` already uses Next.js fetch revalidate
 * = 60s. Per-request cache is implicit to the lib.
 *
 * Response shape:
 *   200 { ok: true,  data: PolymarketMarket[],  degraded: false }
 *   200 { ok: false, data: [],                  degraded: true,  reason: "..." }
 *
 * Important: we NEVER 5xx from this route. /markets is the most-visited
 * dashboard page and a Gamma outage must not break it. On any failure we
 * return 200 with `degraded: true` so the UI can render an "external
 * markets temporarily unavailable" state.
 */

import {NextResponse} from "next/server";

import {getMarkets, type GetMarketsFilters, type PolymarketMarket} from "@/lib/polymarket";

interface PublicMarket extends Omit<PolymarketMarket, "endDate" | "startDate"> {
  endDate: string | null;
  startDate: string | null;
}

function serialize(m: PolymarketMarket): PublicMarket {
  return {
    ...m,
    endDate: m.endDate ? m.endDate.toISOString() : null,
    startDate: m.startDate ? m.startDate.toISOString() : null,
  };
}

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v === null) return fallback;
  return v === "true" || v === "1";
}

function parseInRange(v: string | null, min: number, max: number, fallback: number): number {
  if (v === null) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseOrder(v: string | null): GetMarketsFilters["order"] | undefined {
  if (v === "volume24hr" || v === "endDate" || v === "createdAt" || v === "liquidityNum") return v;
  return undefined;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const filters: GetMarketsFilters = {
    active: parseBool(sp.get("active"), true),
    closed: parseBool(sp.get("closed"), false),
    limit: parseInRange(sp.get("limit"), 1, 100, 100),
    offset: parseInRange(sp.get("offset"), 0, 10_000, 0),
    order: parseOrder(sp.get("order")) ?? "volume24hr",
    ascending: parseBool(sp.get("ascending"), false),
  };
  const category = sp.get("category");
  if (category && category.toLowerCase() !== "all") {
    filters.category = category;
  }

  const result = await getMarkets(filters);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        data: [],
        degraded: true,
        reason: `${result.error.kind}${result.error.status ? `:${result.error.status}` : ""} — ${result.error.message}`,
      },
      // 200 on purpose — see header comment.
      {status: 200, headers: {"cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300"}},
    );
  }

  return NextResponse.json(
    {ok: true, data: result.data.map(serialize), degraded: false},
    {status: 200, headers: {"cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300"}},
  );
}
