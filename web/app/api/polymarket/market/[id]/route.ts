/**
 * GET /api/polymarket/market/[id]
 *
 * Server-side proxy for `lib/polymarket/getMarketById`. The lib is marked
 * server-only (it calls `JSON.parse` on Gamma's stringified `outcomes` /
 * `outcomePrices` fields and uses `next.revalidate` for caching), so the
 * /create clone flow's client-side prefill goes through this route instead
 * of importing the lib directly.
 *
 * Returns:
 *   200 { ok: true, data: PolymarketMarket }
 *   404 { ok: false, error: "Market not found" }
 *   502 { ok: false, error: "<gamma error>" }
 */

import {NextResponse} from "next/server";

import {getMarketById} from "@/lib/polymarket";

export async function GET(_req: Request, ctx: {params: Promise<{id: string}>}): Promise<NextResponse> {
  const {id} = await ctx.params;
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ok: false, error: "id must be a numeric string"}, {status: 400});
  }

  const result = await getMarketById(id);
  if (!result.ok) {
    const status = result.error.kind === "404" ? 404 : 502;
    return NextResponse.json({ok: false, error: result.error.message}, {status});
  }
  if (!result.data) {
    return NextResponse.json({ok: false, error: `Market ${id} not found`}, {status: 404});
  }

  // PolymarketMarket carries Date instances for `endDate` — JSON-serialize as
  // ISO strings explicitly so the client can `new Date(...)` it back.
  const data = {
    ...result.data,
    endDate: result.data.endDate ? result.data.endDate.toISOString() : null,
  };
  return NextResponse.json({ok: true, data});
}
