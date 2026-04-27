"use client";

import {useEffect, useState} from "react";

import {Check, X} from "lucide-react";

import {txLink} from "@/lib/chains";
import {STEP_LABEL, STEPS, type BetState, type StepId, type StepState} from "@/lib/bet/state-machine";

interface BetProgressProps {
  state: Extract<BetState, {phase: "processing"}>;
}

function StepRow({step, stepState}: {step: StepId; stepState: StepState}): React.ReactElement {
  // Live elapsed-time tick for the active step. Lazy-init Date.now() so the
  // call doesn't happen during render (React 19 react-hooks/purity rule).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (stepState.status !== "active") return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [stepState.status]);

  const elapsed =
    stepState.status === "active"
      ? `${((now - stepState.startedAt) / 1000).toFixed(1)}s`
      : stepState.status === "ok" || stepState.status === "failed"
        ? `${((stepState.endedAt - stepState.startedAt) / 1000).toFixed(1)}s`
        : "";

  const sub =
    stepState.status === "skipped"
      ? stepState.reason
      : stepState.status === "failed"
        ? stepState.errorMessage
        : "";

  return (
    <div className="bm-step" data-status={stepState.status}>
      <span className="icon" aria-hidden>
        {stepState.status === "ok" && <Check size={12} />}
        {stepState.status === "failed" && <X size={12} />}
      </span>
      <div>
        <div className="label">{STEP_LABEL[step]}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div style={{display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2}}>
        {elapsed && <span className="timer">{elapsed}</span>}
        {stepState.status === "ok" && stepState.txHash && (
          <a className="tx-link" href={txLink(stepState.txHash)} target="_blank" rel="noopener noreferrer">
            {stepState.txHash.slice(0, 10)}…
          </a>
        )}
      </div>
    </div>
  );
}

export function BetProgress({state}: BetProgressProps): React.ReactElement {
  return (
    <div className="bm-progress">
      <h3 className="bm-section-h">Placing bet — 5 steps</h3>
      {STEPS.map((s) => (
        <StepRow key={s} step={s} stepState={state.steps[s]} />
      ))}
    </div>
  );
}
