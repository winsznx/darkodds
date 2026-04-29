import {DarkOddsState, type DarkOddsStateValue} from "@/lib/darkodds/types";

import {CreatedByYouBadge} from "@/components/markets/CreatedByYouBadge";
import {formatEndDate} from "@/components/markets/format";

interface MarketHeaderProps {
  id: bigint;
  question: string;
  state: DarkOddsStateValue;
  expiryTs: bigint;
  isResolved: boolean;
  createdByMe?: boolean;
}

function stateLabel(state: DarkOddsStateValue): {label: string; cls: string} {
  if (state === DarkOddsState.Invalid) return {label: "INVALID", cls: "md-state-badge--invalid"};
  if (state === DarkOddsState.Resolved || state === DarkOddsState.ClaimWindow)
    return {label: "RESOLVED", cls: "md-state-badge--resolved"};
  if (state === DarkOddsState.Closed) return {label: "CLOSED", cls: "md-state-badge--resolved"};
  if (state === DarkOddsState.Resolving) return {label: "RESOLVING", cls: "md-state-badge--resolved"};
  return {label: "OPEN", cls: "md-state-badge--open"};
}

export function MarketHeader({
  id,
  question,
  state,
  expiryTs,
  createdByMe = false,
}: MarketHeaderProps): React.ReactElement {
  const {label, cls} = stateLabel(state);
  const endDate = expiryTs === BigInt(0) ? null : new Date(Number(expiryTs) * 1000);
  return (
    <header className="md-header">
      <div className="md-meta-row">
        <span className="id">MARKET #{id.toString()}</span>
        {createdByMe && <CreatedByYouBadge />}
        <span className={`md-state-badge ${cls}`}>{label}</span>
        <span className="md-end">{formatEndDate(endDate)}</span>
      </div>
      <h1 className="md-question">{question}</h1>
    </header>
  );
}
