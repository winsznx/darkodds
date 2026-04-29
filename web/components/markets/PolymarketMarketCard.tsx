"use client";

import {ExternalLink} from "lucide-react";
import Link from "next/link";

import {derivePolymarketCategory} from "@/lib/markets/categories";
import type {PolymarketMarket} from "@/lib/polymarket";

import {CategoryPill} from "./CategoryPill";
import {formatEndDate, formatProbability, formatUsdCompact} from "./format";
import {MarketImage} from "./MarketImage";

/**
 * Polymarket market card. Plaintext volume on the foot (visual contrast
 * against the DarkOdds redaction bar). "VIEW ON POLYMARKET ↗" is a real
 * outbound link with rel="noopener noreferrer"; "MIRROR ON DARKODDS →"
 * deep-links to /create with the Polymarket market id pre-encoded so the
 * ChainGPT-powered create flow can hydrate the prompt textarea with the
 * mirrored question (Model C wedge, F10b).
 */
export function PolymarketMarketCard({market}: {market: PolymarketMarket}): React.ReactElement {
  // Top outcome = the highest-probability label. Renders general-purpose
  // labels (Yes/No, Lakers/Rockets, Trump/Harris/Other) per F8 constraint.
  const sorted = [...market.outcomes].sort((a, b) => b.probability - a.probability);
  const ranked = sorted.slice(0, 4);
  const category = derivePolymarketCategory(market);

  return (
    <article className="mc-card" data-source="polymarket">
      <div className="mc-head">
        <div className="mc-id-block">
          <MarketImage image={market.imageUrl} icon={market.iconUrl} category={category} />
          <span className="mc-source mc-source--pm" aria-label="Polymarket">
            PM
          </span>
          <CategoryPill label={category} variant="public" />
        </div>
        <div className="mc-meta">
          <span>{formatEndDate(market.endDate)}</span>
        </div>
      </div>

      <h3 className="mc-question">{market.question}</h3>

      <div className="mc-outcomes">
        {ranked.map((o, i) => (
          <div key={o.label} className={`mc-outcome ${i === 0 ? "mc-outcome--top" : ""}`}>
            <span className="lbl">{o.label}</span>
            <span className="pct">{formatProbability(o.probability)}</span>
          </div>
        ))}
      </div>

      <div className="mc-foot">
        <div className="mc-stat">
          <span className="k">24h Volume</span>
          <span className="v">{formatUsdCompact(market.volume24hrUsd)}</span>
        </div>
        <div className="mc-cta-row">
          <a
            className="mc-cta"
            href={market.url}
            target="_blank"
            rel="noopener noreferrer"
            data-test="view-on-polymarket"
          >
            VIEW ON POLYMARKET <ExternalLink size={11} />
          </a>
          <Link
            className="mc-cta"
            href={`/create?source=polymarket&id=${encodeURIComponent(market.id)}`}
            data-test="mirror-on-darkodds"
          >
            MIRROR ON DARKODDS →
          </Link>
        </div>
      </div>
    </article>
  );
}
