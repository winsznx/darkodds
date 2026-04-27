import {notFound} from "next/navigation";

import {getDarkOddsMarketDetail} from "@/lib/darkodds/single-market";

import {MarketDetail} from "@/components/market-detail/MarketDetail";

/**
 * /markets/[id] — single-market detail page.
 *
 * Server component. Reads market state via viem multicall (single round-trip
 * to chain). Hands off to `MarketDetail` (client) which re-reads with the
 * connected user's address for per-user bet handles + decryption.
 *
 * 404 if the market id is invalid or the registry returns the zero address.
 */
export const revalidate = 30;

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{id: string}>;
}): Promise<React.ReactElement> {
  const {id: idStr} = await params;
  let id: bigint;
  try {
    id = BigInt(idStr);
  } catch {
    notFound();
  }
  if (id <= BigInt(0)) notFound();

  const market = await getDarkOddsMarketDetail(id);
  if (!market) notFound();

  return <MarketDetail market={market} />;
}
