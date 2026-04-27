"use client";

import {ExternalLink} from "lucide-react";

import type {PolymarketMarket} from "@/lib/polymarket";

import {formatEndDate, formatProbability, formatUsdCompact} from "./format";

/**
 * Polymarket market card. Plaintext volume on the foot (visual contrast
 * against the DarkOdds redaction bar). "VIEW ON POLYMARKET ↗" is a real
 * outbound link with rel="noopener noreferrer"; "MIRROR ON DARKODDS →" is
 * disabled with an F11 tooltip — visibly present per F8 spec.
 */
export function PolymarketMarketCard({market}: {market: PolymarketMarket}): React.ReactElement {
  // Top outcome = the highest-probability label. Renders general-purpose
  // labels (Yes/No, Lakers/Rockets, Trump/Harris/Other) per F8 constraint.
  const sorted = [...market.outcomes].sort((a, b) => b.probability - a.probability);
  const ranked = sorted.slice(0, 4);

  return (
    <article className="mc-card" data-source="polymarket">
      <div className="mc-head">
        <span className="mc-source mc-source--pm" aria-label="Polymarket">
          PM
        </span>
        <div className="mc-meta">
          {market.category && <span className="cat">{market.category.toUpperCase()}</span>}
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
          <span className="mc-cta" data-disabled="true" aria-disabled>
            MIRROR ON DARKODDS →<span className="mc-tip">Coming in /create — Phase F11</span>
          </span>
        </div>
      </div>
    </article>
  );
}
