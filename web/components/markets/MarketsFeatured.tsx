"use client";

import {ExternalLink} from "lucide-react";
import Link from "next/link";

import type {DarkOddsMarket} from "@/lib/darkodds/types";
import {derivePolymarketCategory} from "@/lib/markets/categories";
import type {PolymarketMarket} from "@/lib/polymarket";

import {CategoryPill} from "./CategoryPill";
import {formatEndDate, formatProbability, formatUsdCompact} from "./format";
import {MarketImage} from "./MarketImage";

/**
 * Featured strip — top 3 markets across both feeds, ranked by 24h volume.
 * DarkOdds-native markets don't expose a comparable volume yet (encrypted
 * pools), so they sort by id-descending as a stand-in. The user-facing
 * ranking is "what's hot right now"; missing-volume markets land below
 * any Polymarket market with real numbers.
 *
 * Cards are larger than the column variants — Fraunces 24px question,
 * 48×48 image, prominent volume + bettor counts. On mobile they stack
 * 1-up; on tablet/desktop they're 3-up.
 */

type FeaturedMarket =
  | {kind: "darkodds"; market: DarkOddsMarket}
  | {kind: "polymarket"; market: PolymarketMarket};

interface MarketsFeaturedProps {
  darkOddsMarkets: DarkOddsMarket[];
  polymarketMarkets: PolymarketMarket[];
}

function buildRanking(
  darkOddsMarkets: DarkOddsMarket[],
  polymarketMarkets: PolymarketMarket[],
): FeaturedMarket[] {
  // Polymarket scored by 24h volume (real number). DarkOdds scored by id
  // descending (a stand-in until subgraph volume aggregation lands).
  const pmRanked: FeaturedMarket[] = [...polymarketMarkets]
    .filter((m) => m.active && !m.closed && m.acceptingOrders)
    .sort((a, b) => b.volume24hrUsd - a.volume24hrUsd)
    .map((market) => ({kind: "polymarket", market}));

  const doRanked: FeaturedMarket[] = [...darkOddsMarkets]
    .filter((m) => m.isOpen)
    .sort((a, b) => Number(b.id - a.id))
    .map((market) => ({kind: "darkodds", market}));

  // Force-lead with DarkOdds when both sides have markets — the strip is
  // the wedge narrative ("DarkOdds runs PRIVATE markets alongside the
  // public PM feed"), not "DarkOdds reads Polymarket". Polymarket's
  // 24h-volume gap would otherwise crowd PM into all 3 slots.
  //
  //   both available  →  [DO #1, PM #1, PM #2]
  //   only DarkOdds   →  [DO #1, DO #2, DO #3]
  //   only Polymarket →  [PM #1, PM #2, PM #3]
  //   neither         →  []
  if (doRanked.length > 0 && pmRanked.length > 0) {
    return [doRanked[0], ...pmRanked.slice(0, 2)];
  }
  if (doRanked.length > 0) {
    return doRanked.slice(0, 3);
  }
  return pmRanked.slice(0, 3);
}

export function MarketsFeatured({
  darkOddsMarkets,
  polymarketMarkets,
}: MarketsFeaturedProps): React.ReactElement | null {
  const featured = buildRanking(darkOddsMarkets, polymarketMarkets);
  if (featured.length === 0) return null;

  return (
    <section className="markets-featured" aria-label="Featured markets">
      <div className="markets-featured-head">
        <span className="kicker">FEATURED</span>
        <h2 className="markets-featured-h">
          Top markets <em>by 24h volume.</em>
        </h2>
      </div>
      <div className="markets-featured-row">
        {featured.map((f) =>
          f.kind === "darkodds" ? (
            <FeaturedDarkOddsCard key={`do-${f.market.id.toString()}`} market={f.market} />
          ) : (
            <FeaturedPolymarketCard key={`pm-${f.market.id}`} market={f.market} />
          ),
        )}
      </div>
    </section>
  );
}

function FeaturedDarkOddsCard({market}: {market: DarkOddsMarket}): React.ReactElement {
  const [a, b] = market.outcomes;
  const aProb = a.probability ?? null;
  const bProb = b.probability ?? null;
  const aFlex = aProb !== null ? Math.max(aProb, 0.04) : 0.5;
  const bFlex = bProb !== null ? Math.max(bProb, 0.04) : 0.5;

  return (
    <Link href={`/markets/${market.id.toString()}`} className="featured-card" data-source="darkodds">
      <div className="featured-head">
        <div className="mc-id-block">
          <span className="mc-source mc-source--do" aria-label="DarkOdds">
            DO
          </span>
          <CategoryPill label="Private" variant="private" />
        </div>
        <span className="featured-ends">{formatEndDate(deriveDoEnd(market))}</span>
      </div>
      <h3 className="featured-q">{market.question}</h3>
      <div className="featured-bar">
        <div
          style={{flex: aFlex}}
          className="bar-yes"
          aria-label={`${a.label} ${formatProbability(aProb)}`}
        />
        <div style={{flex: bFlex}} className="bar-no" aria-label={`${b.label} ${formatProbability(bProb)}`} />
      </div>
      <div className="featured-bar-row">
        <span>
          {a.label} {formatProbability(aProb)}
        </span>
        <span>
          {b.label} {formatProbability(bProb)}
        </span>
      </div>
      <div className="featured-foot">
        <div className="featured-stat">
          <span className="k">Pool</span>
          <span className="v redact-bar" aria-label="Pool size redacted by design" />
        </div>
        <span className="featured-cta">VIEW &amp; BET →</span>
      </div>
    </Link>
  );
}

function deriveDoEnd(market: DarkOddsMarket): Date | null {
  if (market.expiryTs === BigInt(0)) return null;
  return new Date(Number(market.expiryTs) * 1000);
}

function FeaturedPolymarketCard({market}: {market: PolymarketMarket}): React.ReactElement {
  const sorted = [...market.outcomes].sort((a, b) => b.probability - a.probability);
  const top = sorted[0];
  const second = sorted[1];
  const category = derivePolymarketCategory(market);

  return (
    <a
      href={market.url}
      target="_blank"
      rel="noopener noreferrer"
      className="featured-card"
      data-source="polymarket"
    >
      <div className="featured-head">
        <div className="mc-id-block">
          <MarketImage image={market.imageUrl} icon={market.iconUrl} category={category} size={48} />
          <CategoryPill label={category} variant="public" />
        </div>
        <span className="featured-ends">{formatEndDate(market.endDate)}</span>
      </div>
      <h3 className="featured-q">{market.question}</h3>
      <div className="featured-bar">
        <div
          style={{flex: Math.max(top?.probability ?? 0, 0.04)}}
          className="bar-yes"
          aria-label={`${top?.label ?? ""} ${formatProbability(top?.probability ?? null)}`}
        />
        <div
          style={{flex: Math.max(second?.probability ?? 0, 0.04)}}
          className="bar-no"
          aria-label={`${second?.label ?? ""} ${formatProbability(second?.probability ?? null)}`}
        />
      </div>
      <div className="featured-bar-row">
        <span>
          {top?.label} {formatProbability(top?.probability ?? null)}
        </span>
        <span>
          {second?.label} {formatProbability(second?.probability ?? null)}
        </span>
      </div>
      <div className="featured-foot">
        <div className="featured-stat">
          <span className="k">24h Volume</span>
          <span className="v">{formatUsdCompact(market.volume24hrUsd)}</span>
        </div>
        <span className="featured-cta">
          VIEW <ExternalLink size={11} aria-hidden />
        </span>
      </div>
    </a>
  );
}
