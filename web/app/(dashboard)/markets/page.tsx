import {getDarkOddsMarkets} from "@/lib/darkodds/markets";
import {
  getMarkets,
  type PolymarketError,
  type PolymarketResult,
  type PolymarketMarket,
} from "@/lib/polymarket";

import {MarketsLayout} from "@/components/markets/MarketsLayout";

/**
 * /markets — parallel feed showing DarkOdds (left) + Polymarket (right).
 *
 * Server component. Fetches both sides server-side; the client `MarketsLayout`
 * handles search/sort/filter on the loaded data. No client-side Polymarket
 * calls — Gamma reads stay on the server (display-only, ToS-compliant).
 *
 * Uses Next.js 16 "Previous Model" caching via fetch + next.revalidate (60s
 * for Polymarket list, see DRIFT_LOG for Cache Components migration note).
 *
 * Per-route revalidate covers the DarkOdds chain reads (which use
 * publicClient.multicall, not fetch — Next can't auto-revalidate those).
 */
export const revalidate = 60;

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  // Dev-only debug: ?force-pm-error=1 simulates a Polymarket Gamma 5xx so we
  // can capture the empty-state stamp without network monkey-patching.
  // Dead-code-eliminated in production builds (process.env.NODE_ENV is
  // statically replaced by the bundler).
  const params = await searchParams;
  const forcePmError = process.env.NODE_ENV === "development" && params["force-pm-error"] === "1";

  const polymarketPromise: Promise<PolymarketResult<PolymarketMarket[]>> = forcePmError
    ? Promise.resolve({
        ok: false,
        data: [],
        error: {
          kind: "5xx",
          status: 503,
          message: "Forced via ?force-pm-error=1 (dev-only)",
        } as PolymarketError,
      })
    : getMarkets({limit: 50, active: true, closed: false, order: "volume24hr"});

  const [polymarket, darkOdds] = await Promise.all([polymarketPromise, getDarkOddsMarkets()]);

  return (
    <>
      <header className="page-header">
        <h1 className="h">
          Markets. <em>Listed.</em>
        </h1>
      </header>

      <MarketsLayout
        darkOddsMarkets={darkOdds.markets}
        darkOddsErrors={darkOdds.errors}
        polymarketMarkets={polymarket.data}
        polymarketError={polymarket.ok ? null : polymarket.error}
      />
    </>
  );
}
