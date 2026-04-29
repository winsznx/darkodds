"use client";

import Link from "next/link";

import {addressLink} from "@/lib/chains";

import {DarkOddsState, type DarkOddsMarket} from "@/lib/darkodds/types";

import {CategoryPill} from "./CategoryPill";
import {CreatedByYouBadge} from "./CreatedByYouBadge";
import {formatProbability} from "./format";

/**
 * DarkOdds market card.
 *
 * Brand visual: pool size renders as a redaction bar regardless of whether
 * the on-chain pool is encrypted (Open) or plaintext (post-freeze). The
 * rectangle IS the brand. Odds render in plaintext per F8 constraint #1
 * — the wedge is "public outcomes and odds, hidden bet sizes," and the
 * pool redaction is design language reinforcing it.
 *
 * "PLACE BET →" is intentionally disabled with an F9 tooltip; visible,
 * not hidden, not broken.
 */
export function DarkOddsMarketCard({
  market,
  createdByMe = false,
}: {
  market: DarkOddsMarket;
  createdByMe?: boolean;
}): React.ReactElement {
  const [a, b] = market.outcomes;
  const aTop = (a.probability ?? 0) >= (b.probability ?? 0);

  // Surface a small status hint adjacent to the question. Open → amber.
  // Resolved/ClaimWindow → ink "RESOLVED". Invalid → red.
  let statusLabel = "OPEN";
  let statusClass = "mc-status--open";
  if (market.state === DarkOddsState.Invalid) {
    statusLabel = "INVALID";
    statusClass = "mc-status--invalid";
  } else if (market.isResolved) {
    statusLabel = "RESOLVED";
    statusClass = "mc-status--resolved";
  } else if (market.state === DarkOddsState.Closed) {
    statusLabel = "CLOSED";
    statusClass = "mc-status--resolved";
  } else if (market.state === DarkOddsState.Resolving) {
    statusLabel = "RESOLVING";
    statusClass = "mc-status--resolved";
  }

  return (
    <article className="mc-card" data-source="darkodds">
      <div className="mc-head">
        <div className="mc-id-block">
          <span className="mc-source mc-source--do" aria-label="DarkOdds">
            DO
          </span>
          <CategoryPill label="Private" variant="private" />
        </div>
        <div className="mc-meta">
          <span>#{market.id.toString()}</span>
          {createdByMe && <CreatedByYouBadge />}
          <span className={`mc-status ${statusClass}`} style={{margin: 0}}>
            {statusLabel}
          </span>
        </div>
      </div>

      <h3 className="mc-question">{market.question}</h3>

      <div className="mc-outcomes">
        <div className={`mc-outcome ${aTop ? "mc-outcome--top" : ""}`}>
          <span className="lbl">{a.label}</span>
          <span className="pct">{formatProbability(a.probability)}</span>
        </div>
        <div className={`mc-outcome ${!aTop ? "mc-outcome--top" : ""}`}>
          <span className="lbl">{b.label}</span>
          <span className="pct">{formatProbability(b.probability)}</span>
        </div>
      </div>

      <div className="mc-foot">
        <div className="mc-stat">
          <span className="k">Pool</span>
          {/* THE redaction bar — brand element. Pool is not actually secret;
              the rectangle is the visual signature of the privacy thesis. */}
          <span className="v redact-bar" aria-label="Pool size redacted by design" />
        </div>
        <div className="mc-cta-row">
          {/* HALT 1 of F9: card CTA links to the new detail page. The full
              bet modal (HALT 2) and chain wiring (HALT 3) land behind this. */}
          <Link className="mc-cta" href={`/markets/${market.id.toString()}`}>
            VIEW &amp; BET →
          </Link>
          <a
            className="mc-cta"
            href={addressLink(market.address)}
            target="_blank"
            rel="noopener noreferrer"
            style={{fontSize: 9}}
          >
            VIEW CONTRACT ↗
          </a>
        </div>
      </div>
    </article>
  );
}
