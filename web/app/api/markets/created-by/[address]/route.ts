/**
 * GET /api/markets/created-by/[address]
 *
 * Returns the list of market ids the given address created via the
 * sponsored /api/admin/deploy-market route. Used by the MINE filter on
 * /markets as the authoritative path that survives browser-localStorage
 * clears + device switches.
 *
 * Self-signed deploys (deployer EOA self-deploying via /create) are not
 * in the ledger; that's intentional per the design note in
 * lib/markets/created-ledger.ts.
 *
 * Response shape (NEVER 5xx — UI always renders):
 *   200 { ok: true, marketIds: string[], durablePersistence: boolean }
 *   400 { ok: false, error: "invalid-address" }
 *   200 { ok: true, marketIds: [], degraded: true } on read failure
 */

import {NextResponse} from "next/server";

import {listMarketsByCreator, persistenceIsDurable} from "@/lib/markets/created-ledger";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: {params: Promise<{address: string}>}): Promise<NextResponse> {
  const {address} = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json(
      {ok: false, error: "invalid-address"},
      {status: 400, headers: {"cache-control": "no-store"}},
    );
  }
  try {
    const marketIds = await listMarketsByCreator(address);
    return NextResponse.json(
      {ok: true, marketIds, durablePersistence: persistenceIsDurable()},
      {status: 200, headers: {"cache-control": "no-store"}},
    );
  } catch {
    return NextResponse.json(
      {ok: true, marketIds: [], degraded: true},
      {status: 200, headers: {"cache-control": "no-store"}},
    );
  }
}
