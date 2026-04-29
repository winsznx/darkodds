import type {DarkOddsCardOutcome} from "@/lib/darkodds/types";

import {formatProbability} from "@/components/markets/format";

interface OutcomesPanelProps {
  outcomes: [DarkOddsCardOutcome, DarkOddsCardOutcome];
}

/**
 * Public outcomes + plaintext odds (when computable) + redaction-bar pool.
 * The pool size is the brand redaction element; pool plaintext IS public per
 * spec but rendered as a bar to reinforce "your bet sizes are hidden."
 *
 * Per PRD §7.5 the odds bar above the rows is:
 *   - 8px tall horizontal split bar
 *   - accent-yes / accent-no colors only
 *   - NO labels embedded inside the bar (numbers are in the rows below)
 */
export function OutcomesPanel({outcomes}: OutcomesPanelProps): React.ReactElement {
  const [a, b] = outcomes;
  const aProb = a.probability ?? null;
  const bProb = b.probability ?? null;
  const aTop = (aProb ?? 0) >= (bProb ?? 0);

  // Bar flex factors. When probabilities are null (no batch yet), split
  // 50/50 so the bar still renders with both colors visible. Min 0.04 on
  // either side so a 99/1 split still shows a visible sliver of the
  // smaller color.
  const aFlex = aProb !== null ? Math.max(aProb, 0.04) : 0.5;
  const bFlex = bProb !== null ? Math.max(bProb, 0.04) : 0.5;

  return (
    <section className="md-outcomes-panel">
      <h2 className="md-section-h">Outcomes</h2>
      <div
        className="md-odds-bar"
        role="img"
        aria-label={`${a.label} ${formatProbability(aProb)}, ${b.label} ${formatProbability(bProb)}`}
      >
        <div className="md-odds-bar-yes" style={{flex: aFlex}} />
        <div className="md-odds-bar-no" style={{flex: bFlex}} />
      </div>
      <div className="md-outcomes-list">
        <div className={`md-outcome-row ${aTop ? "md-outcome-row--top" : ""}`}>
          <span className="lbl">{a.label}</span>
          <span className="pct">{formatProbability(aProb)}</span>
        </div>
        <div className={`md-outcome-row ${!aTop ? "md-outcome-row--top" : ""}`}>
          <span className="lbl">{b.label}</span>
          <span className="pct">{formatProbability(bProb)}</span>
        </div>
      </div>
      <div className="md-outcomes-pool-row">
        <span className="k">Pool</span>
        <span className="v redact-bar" aria-label="Pool size redacted by design" />
      </div>
    </section>
  );
}
