/**
 * GET /api/polymarket/market/[id]
 *
 * Server-side proxy for `lib/polymarket/getMarketById()`. Surfaces the full
 * enriched single-market payload — including `clobTokenIds` (the YES/NO
 * ERC-1155 token IDs) and `resolutionSource`, which the /create clone flow
 * uses when seeding a DarkOdds clone from a Polymarket question.
 *
 * Cache: underlying `getMarketById()` uses Next.js fetch revalidate = 30s.
 *
 * Response shape:
 *   200 { ok: true,  data: PolymarketMarket,  degraded: false }
 *   404 { ok: false, data: null,              degraded: false, reason: "Market <id> not found" }
 *   200 { ok: false, data: null,              degraded: true,  reason: "..." }   ← Gamma 5xx / network
 *
 * 404 means "this id genuinely doesn't exist on Polymarket" — distinct
 * from "Polymarket is down" which returns 200 + degraded: true.
 */

import {NextResponse} from "next/server";

import {getMarketById, type PolymarketMarket} from "@/lib/polymarket";

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

export async function GET(_req: Request, ctx: {params: Promise<{id: string}>}): Promise<NextResponse> {
  const {id} = await ctx.params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json(
      {ok: false, data: null, degraded: false, reason: "id must be a numeric string"},
      {status: 400},
    );
  }

  const result = await getMarketById(id);
  if (!result.ok) {
    // Polymarket Gamma returns 422 (not 404) for nonexistent ids — bucket
    // any 4xx as "not found" rather than as a degraded outage so callers
    // can distinguish "this id doesn't exist" from "Gamma is down".
    const isNotFound =
      result.error.kind === "404" ||
      (result.error.status !== undefined && result.error.status >= 400 && result.error.status < 500);
    if (isNotFound) {
      return NextResponse.json(
        {ok: false, data: null, degraded: false, reason: `Market ${id} not found`},
        {status: 404},
      );
    }
    return NextResponse.json(
      {
        ok: false,
        data: null,
        degraded: true,
        reason: `${result.error.kind}${result.error.status ? `:${result.error.status}` : ""} — ${result.error.message}`,
      },
      {status: 200, headers: {"cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120"}},
    );
  }
  if (!result.data) {
    return NextResponse.json(
      {ok: false, data: null, degraded: false, reason: `Market ${id} not found`},
      {status: 404},
    );
  }

  return NextResponse.json(
    {ok: true, data: serialize(result.data), degraded: false},
    {status: 200, headers: {"cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120"}},
  );
}
