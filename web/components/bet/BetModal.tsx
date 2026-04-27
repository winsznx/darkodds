"use client";

import {useEffect, useMemo, useReducer} from "react";

import {Check, Eye, X} from "lucide-react";
import {formatUnits} from "viem";

import "./bet-modal.css";

import {txLink} from "@/lib/chains";
import {classifyError} from "@/lib/bet/errors";
import {runPlaceBet} from "@/lib/bet/place-bet";
import {runPreflight} from "@/lib/bet/preflight";
import {computeBetQuote} from "@/lib/bet/quote";
import {
  clearPersistedState,
  initialState,
  persistState,
  reduce,
  type BetParams,
  type BetState,
} from "@/lib/bet/state-machine";
import {useBetClients} from "@/lib/nox/client-hook";

import {BetProgress} from "./BetProgress";

interface BetModalProps {
  open: boolean;
  onClose: () => void;
  /** Triggered when the user opens the modal — orchestrator runs pre-flight. */
  params: BetParams | null;
  /** Pari-mutuel inputs to compute the quote in REVIEW state. */
  marketState: {
    yesPoolFrozen: bigint;
    noPoolFrozen: bigint;
    protocolFeeBps: bigint;
  };
  /** Outcome labels (e.g. ["YES","NO"] or ["Lakers","Rockets"]) for display. */
  outcomeLabels: [string, string];
  /**
   * Called after a successful bet so the parent (MarketDetail) can refresh
   * UserPositions and scroll the section into view.
   */
  onSuccess: () => void;
}

/**
 * BetModal — HALT 3 wires the real orchestrator. preflight runs a chain
 * multicall (TestUSDC.balanceOf/allowance, cUSDC.isOperator) to populate
 * skip-flags; processing dispatches through `runPlaceBet` which walks the
 * 5-step real-tx sequence.
 *
 * The reducer is the source of truth — the orchestrator dispatches actions
 * on every step transition (STEP_START → STEP_OK / STEP_FAIL), and
 * sessionStorage persistence happens in a side-effect on every state
 * change so a mid-flow refresh recovers.
 */
export function BetModal(props: BetModalProps): React.ReactElement | null {
  const {open, onClose, params, marketState, outcomeLabels, onSuccess} = props;
  const [state, dispatch] = useReducer(reduce, initialState);
  const {walletClient, publicClient, noxClient, ready: clientsReady} = useBetClients();

  // Open/close handshake
  useEffect(() => {
    if (open && params && state.phase === "idle") {
      dispatch({type: "OPEN", params});
    }
    if (!open && state.phase !== "idle" && state.phase !== "processing") {
      dispatch({type: "CLOSE"});
    }
  }, [open, params, state.phase]);

  // ESC to close, body scroll lock — disabled mid-processing so users can't
  // accidentally lose track of an in-flight wallet popup.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && state.phase !== "processing") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, state.phase]);

  // Persist FSM state on every transition for sessionStorage-backed resume.
  useEffect(() => {
    persistState(state);
    if (state.phase === "success" || state.phase === "idle") {
      // Successful bet or modal closed — clear the resume entry.
      if (state.phase === "success") clearPersistedState(state.params.marketId);
    }
  }, [state]);

  // ─── Pre-flight: read chain state, dispatch PREFLIGHT_OK / FAIL ─────────
  useEffect(() => {
    if (state.phase !== "preflight") return;
    if (!clientsReady || !walletClient?.account) return;
    const userAddress = walletClient.account.address;
    const {amountUsdc} = state.params;
    let cancelled = false;
    void runPreflight({
      userAddress,
      marketAddress: state.params.marketAddress,
      amountUsdc,
    })
      .then((preflight) => {
        if (cancelled) return;
        if (preflight.tusdcBalance < amountUsdc) {
          dispatch({
            type: "PREFLIGHT_FAIL",
            errorKind: "insufficient_balance",
            errorMessage: `Wallet balance (${(Number(preflight.tusdcBalance) / 1e6).toLocaleString()} tUSDC) is below bet amount (${(Number(amountUsdc) / 1e6).toLocaleString()} tUSDC). Get more from the faucet.`,
          });
        } else {
          dispatch({type: "PREFLIGHT_OK", preflight});
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const {kind, message} = classifyError(err);
        dispatch({type: "PREFLIGHT_FAIL", errorKind: kind, errorMessage: message});
      });
    return () => {
      cancelled = true;
    };
  }, [state, clientsReady, walletClient]);

  // ─── Processing: real orchestrator walks the 5 steps ────────────────────
  useEffect(() => {
    if (state.phase !== "processing") return;
    if (!clientsReady || !walletClient?.account || !noxClient) return;
    void runPlaceBet({
      onAction: dispatch,
      initialState: state,
      clients: {
        walletClient,
        publicClient,
        noxClient,
        account: walletClient.account.address,
      },
    });
    // We deliberately ignore re-runs of this effect when `state.steps`
    // changes mid-flow — the orchestrator handles the entire sequence in a
    // single async call. The dependency array carries phase only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, clientsReady]);

  // Auto-close on success after 8s.
  useEffect(() => {
    if (state.phase !== "success") return;
    const t = setTimeout(() => {
      onSuccess();
      onClose();
    }, 8000);
    return () => clearTimeout(t);
  }, [state.phase, onSuccess, onClose]);

  if (!open || !params) return null;
  if (state.phase === "idle") return null;

  return (
    <div
      className="modal-backdrop"
      onClick={state.phase !== "processing" ? onClose : undefined}
      role="dialog"
      aria-modal
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {state.phase !== "processing" && (
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        )}

        <div className="modal-head">
          <div className="modal-stamp">
            <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
              {state.phase === "success" ? "BET PLACED // SETTLED" : "BET PLACEMENT // CONFIRM"}
            </span>
          </div>
          <h2 className="modal-title">
            {state.phase === "preflight" && "Reading chain state…"}
            {state.phase === "review" && (
              <>
                Confirm your <em>wager</em>.
              </>
            )}
            {state.phase === "processing" && (
              <>
                Placing <em>bet</em>.
              </>
            )}
            {state.phase === "success" && (
              <>
                Bet <em>placed</em>.
              </>
            )}
            {state.phase === "error" && "Bet failed."}
          </h2>
        </div>

        {state.phase === "preflight" && (
          <div className="bm-progress">
            <p className="bm-section-h" style={{color: "var(--fg)", marginBottom: 0}}>
              Loading allowance, balance, operator status…
            </p>
          </div>
        )}

        {state.phase === "review" && (
          <ReviewState
            state={state}
            marketState={marketState}
            outcomeLabels={outcomeLabels}
            onConfirm={() => dispatch({type: "CONFIRM"})}
            onToggleAllowance={() => dispatch({type: "TOGGLE_INFINITE_ALLOWANCE"})}
            onCancel={onClose}
          />
        )}

        {state.phase === "processing" && <BetProgress state={state} />}

        {state.phase === "success" && (
          <div className="bm-success">
            <span className="stamp stamp--red" style={{transform: "rotate(-2deg)"}}>
              BET PLACED
            </span>
            <p className="summary">
              {Number(formatUnits(state.params.amountUsdc, 6)).toLocaleString()} cUSDC on{" "}
              <em>{outcomeLabels[state.params.sideIndex]}</em>
            </p>
            <a className="tx-link" href={txLink(state.placeBetTx)} target="_blank" rel="noopener noreferrer">
              {state.placeBetTx.slice(0, 14)}… ↗
            </a>
            <div className="actions">
              <button
                type="button"
                className="modal-cta"
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                style={{maxWidth: 240}}
              >
                <Eye size={12} /> VIEW POSITION
              </button>
            </div>
          </div>
        )}

        {state.phase === "error" && (
          <div className="bm-error">
            <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
              BET FAILED // {state.errorKind.replace(/_/g, " ").toUpperCase()}
            </span>
            <p className="reason">
              <code>{state.errorMessage.slice(0, 200)}</code>
            </p>
            <div className="actions">
              {state.errorKind === "insufficient_balance" ? (
                <>
                  <button
                    type="button"
                    className="modal-cta"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("darkodds:open-faucet"));
                      dispatch({type: "RESET"});
                      onClose();
                    }}
                  >
                    GET TESTUSDC FROM FAUCET
                  </button>
                  <button type="button" className="secondary" onClick={() => dispatch({type: "RESET"})}>
                    START OVER
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="modal-cta" onClick={() => dispatch({type: "RETRY"})}>
                    RETRY STEP
                  </button>
                  <button type="button" className="secondary" onClick={() => dispatch({type: "RESET"})}>
                    START OVER
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="modal-foot">All txs are on Arb Sepolia. Your bet size is encrypted on iExec Nox.</div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Review state — separated to keep the main component readable
// ────────────────────────────────────────────────────────────────────────────

interface ReviewStateProps {
  state: Extract<BetState, {phase: "review"}>;
  marketState: BetModalProps["marketState"];
  outcomeLabels: [string, string];
  onConfirm: () => void;
  onToggleAllowance: () => void;
  onCancel: () => void;
}

function ReviewState({
  state,
  marketState,
  outcomeLabels,
  onConfirm,
  onToggleAllowance,
  onCancel,
}: ReviewStateProps): React.ReactElement {
  const quote = useMemo(
    () =>
      computeBetQuote({
        amountUsdc: state.params.amountUsdc,
        sideIndex: state.params.sideIndex,
        yesPoolFrozen: marketState.yesPoolFrozen,
        noPoolFrozen: marketState.noPoolFrozen,
        protocolFeeBps: marketState.protocolFeeBps,
      }),
    [state.params, marketState],
  );

  // First-time bettor: needs APPROVE step. Show the disclosure banner.
  const isFirstTimeApprove = !state.preflight.approveSkippable;

  return (
    <div className="bm-review">
      <h3 className="bm-section-h">Review</h3>

      <div className="bm-summary">
        <div>
          <span className="k">Outcome</span>
          <span className="v">{outcomeLabels[state.params.sideIndex]}</span>
        </div>
        <div>
          <span className="k">Stake</span>
          <span className="v">{Number(formatUnits(state.params.amountUsdc, 6)).toLocaleString()} cUSDC</span>
        </div>
        <div>
          <span className="k">Estimated payout</span>
          <span className="v">
            {quote.netPayoutUsdc > BigInt(0)
              ? `${Number(formatUnits(quote.netPayoutUsdc, 6)).toLocaleString()} cUSDC`
              : "—"}
          </span>
        </div>
        <div>
          <span className="k">Multiplier</span>
          <span className="v">{quote.multiplier !== null ? `${quote.multiplier.toFixed(2)}×` : "—"}</span>
        </div>
        <div>
          <span className="k">Protocol fee</span>
          <span className="v">{(Number(marketState.protocolFeeBps) / 100).toFixed(2)}%</span>
        </div>
        <div>
          <span className="k">Network</span>
          <span className="v">Arb Sepolia</span>
        </div>
      </div>

      {isFirstTimeApprove && state.preflight.useInfiniteAllowance && (
        <div className="bm-allowance-disclosure">
          <span className="label">{"// First-time bettor — approval required"}</span>
          <p className="body">
            DarkOdds will be authorized to spend <strong>any amount</strong> of TestUSDC from this wallet,
            today and in future bets. You can revoke anytime in your wallet settings.
          </p>
          <div className="actions">
            <button type="button" aria-pressed={state.preflight.useInfiniteAllowance}>
              APPROVE INFINITE
            </button>
            <button
              type="button"
              aria-pressed={!state.preflight.useInfiniteAllowance}
              onClick={onToggleAllowance}
            >
              USE EXACT AMOUNT
            </button>
          </div>
        </div>
      )}
      {isFirstTimeApprove && !state.preflight.useInfiniteAllowance && (
        <div className="bm-allowance-disclosure">
          <span className="label">{"// Exact-amount mode"}</span>
          <p className="body">
            DarkOdds will be authorized to spend exactly{" "}
            <strong>{Number(formatUnits(state.params.amountUsdc, 6)).toLocaleString()} TestUSDC</strong>. Each
            future bet will require a fresh approval transaction.
          </p>
          <div className="actions">
            <button
              type="button"
              aria-pressed={state.preflight.useInfiniteAllowance}
              onClick={onToggleAllowance}
            >
              APPROVE INFINITE
            </button>
            <button type="button" aria-pressed={!state.preflight.useInfiniteAllowance}>
              USE EXACT AMOUNT
            </button>
          </div>
        </div>
      )}
      {!isFirstTimeApprove && (
        <div className="bm-allowance-confirmed">INFINITE ALLOWANCE ACTIVE — APPROVE STEP WILL BE SKIPPED</div>
      )}

      <div className="bm-cta-row">
        <button type="button" className="secondary" onClick={onCancel}>
          CANCEL
        </button>
        <button type="button" className="modal-cta" onClick={onConfirm} style={{flex: 1}}>
          <Check size={12} /> CONFIRM BET
        </button>
      </div>
    </div>
  );
}
