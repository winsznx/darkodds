"use client";

import {useMemo, useState} from "react";

import {usePrivy} from "@privy-io/react-auth";

import type {DarkOddsCardOutcome, DarkOddsStateValue} from "@/lib/darkodds/types";
import {DarkOddsState} from "@/lib/darkodds/types";

import {formatProbability} from "@/components/markets/format";

interface BetPanelProps {
  marketState: DarkOddsStateValue;
  outcomes: [DarkOddsCardOutcome, DarkOddsCardOutcome];
  /** Stub for HALT 2 — opens BetModal once it lands. */
  onOpenBetModal: (params: {sideIndex: 0 | 1; amountUsdc: bigint}) => void;
}

/**
 * Right-rail bet panel. HALT 1 ships the read-only shell (side toggle, amount
 * input, plaintext payout estimate). The CTA opens the BetModal scaffold but
 * the modal itself comes in HALT 2 with the real state machine + chain wiring
 * in HALT 3. For now the CTA logs intent; in HALT 2 it triggers the modal.
 */
export function BetPanel({marketState, outcomes, onOpenBetModal}: BetPanelProps): React.ReactElement {
  const {authenticated, login} = usePrivy();
  const [sideIndex, setSideIndex] = useState<0 | 1>(0);
  const [amountStr, setAmountStr] = useState("50");

  const isOpen = marketState === DarkOddsState.Open;
  const selected = outcomes[sideIndex];
  const probability = selected?.probability ?? null;

  const amountUsdc = useMemo(() => {
    const trimmed = amountStr.trim();
    if (!trimmed) return BigInt(0);
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) return BigInt(0);
    return BigInt(Math.round(n * 1_000_000));
  }, [amountStr]);

  // Estimated payout: amount × (totalPool / winningSidePool) ≈ amount / probability.
  // For Open markets without odds: show "—".
  const estimatedPayoutLabel = useMemo(() => {
    if (probability === null || probability <= 0) return "—";
    const payout = Number(amountStr || "0") / probability;
    if (!Number.isFinite(payout) || payout <= 0) return "—";
    return `${payout.toLocaleString("en-US", {maximumFractionDigits: 2})} cUSDC`;
  }, [amountStr, probability]);

  return (
    <section className="md-bet-panel" aria-label="Place a bet">
      <h2 className="md-section-h">Place a bet</h2>

      <div className="md-side-toggle" role="radiogroup">
        {outcomes.map((o, i) => (
          <button
            type="button"
            key={o.label}
            aria-pressed={sideIndex === i}
            onClick={() => setSideIndex(i as 0 | 1)}
          >
            {o.label} {formatProbability(o.probability)}
          </button>
        ))}
      </div>

      <label className="md-amount" aria-label="Bet amount">
        <input
          type="number"
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          min="1"
          step="1"
          placeholder="50"
        />
        <span className="unit">tUSDC</span>
      </label>

      <div className="md-quote-row">
        <span className="k">Estimated payout</span>
        <span className="v">{estimatedPayoutLabel}</span>
      </div>

      {!authenticated && (
        <button type="button" className="md-cta" onClick={login}>
          CONNECT WALLET TO BET
        </button>
      )}
      {authenticated && !isOpen && <span className="md-locked">MARKET CLOSED — BETS LOCKED</span>}
      {authenticated && isOpen && (
        <button
          type="button"
          className="md-cta"
          disabled={amountUsdc === BigInt(0)}
          onClick={() => onOpenBetModal({sideIndex, amountUsdc})}
        >
          REVIEW BET →
        </button>
      )}
    </section>
  );
}
