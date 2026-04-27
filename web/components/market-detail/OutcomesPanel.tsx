import type {DarkOddsCardOutcome} from "@/lib/darkodds/types";

import {formatProbability} from "@/components/markets/format";

interface OutcomesPanelProps {
  outcomes: [DarkOddsCardOutcome, DarkOddsCardOutcome];
}

/**
 * Public outcomes + plaintext odds (when computable) + redaction-bar pool.
 * The pool size is the brand redaction element; pool plaintext IS public per
 * spec but rendered as a bar to reinforce "your bet sizes are hidden."
 */
export function OutcomesPanel({outcomes}: OutcomesPanelProps): React.ReactElement {
  const [a, b] = outcomes;
  const aTop = (a.probability ?? 0) >= (b.probability ?? 0);
  return (
    <section className="md-outcomes-panel">
      <h2 className="md-section-h">Outcomes</h2>
      <div className="md-outcomes-list">
        <div className={`md-outcome-row ${aTop ? "md-outcome-row--top" : ""}`}>
          <span className="lbl">{a.label}</span>
          <span className="pct">{formatProbability(a.probability)}</span>
        </div>
        <div className={`md-outcome-row ${!aTop ? "md-outcome-row--top" : ""}`}>
          <span className="lbl">{b.label}</span>
          <span className="pct">{formatProbability(b.probability)}</span>
        </div>
      </div>
      <div className="md-outcomes-pool-row">
        <span className="k">Pool</span>
        <span className="v redact-bar" aria-label="Pool size redacted by design" />
      </div>
    </section>
  );
}
