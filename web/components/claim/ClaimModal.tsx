"use client";

import {useEffect, useMemo, useReducer} from "react";

import {Check, ExternalLink, Loader, X} from "lucide-react";
import {formatUnits} from "viem";

import "./claim-modal.css";

import {txLink} from "@/lib/chains";
import {runClaim} from "@/lib/claim/run-claim";
import {initialClaimState, reduceClaim, type ClaimKind, type ClaimParams} from "@/lib/claim/state-machine";
import {useBetClients} from "@/lib/nox/client-hook";
import {ClaimQueue} from "@/components/primitives/ClaimQueue";

interface ClaimModalProps {
  open: boolean;
  params: ClaimParams | null;
  onClose: () => void;
  /** Triggered after success so the parent can refresh portfolio rows. */
  onSettled: () => void;
  /** Dev-only: freezes the modal in `submitting` phase without firing the
   *  on-chain runClaim. Used by /portfolio?preview-claim-queue=1 to make
   *  the ClaimQueue stub visible without needing a real claimable position.
   *  Production builds dead-code-elim this branch via the NODE_ENV gate
   *  in the parent. */
  preview?: boolean;
}

/**
 * Unified modal for claim + refund flows. Drives a 5-phase FSM (idle →
 * submitting → confirming → decrypting → success | error) via `runClaim`.
 *
 * Single tx, single decrypt. Mirrors BetModal's modal scaffolding but
 * without the multi-step progress rail — claim/refund is one wallet popup.
 */
export function ClaimModal({
  open,
  params,
  onClose,
  onSettled,
  preview = false,
}: ClaimModalProps): React.ReactElement | null {
  const [state, dispatch] = useReducer(reduceClaim, initialClaimState);
  const {walletClient, publicClient, noxClient, ready: clientsReady} = useBetClients();
  // Stub claim-queue position + ETA. Stable per-modal-open via params identity
  // so the user doesn't see numbers flickering during the pending phases.
  // Real values land when F11 indexer ships; see DRIFT_LOG.
  const queueStub = useMemo(() => {
    if (!params) return {position: 0, etaSec: 0};
    // Deterministic but visibly varied. Uses the hash of the marketAddress
    // so the same claim feels consistent across re-opens.
    const seed = params.marketAddress
      .slice(2)
      .split("")
      .reduce((acc, c) => acc * 31 + c.charCodeAt(0), 7);
    const position = (Math.abs(seed) % 5) + 1; // 1..5
    const etaSec = ((Math.abs(seed >> 3) % 13) + 6) * 5; // 30..90 (rounded to 5s)
    return {position, etaSec};
  }, [params]);

  // Open/close handshake — fire OPEN exactly once when params arrive.
  useEffect(() => {
    if (open && params && state.phase === "idle") {
      dispatch({type: "OPEN", params});
    }
    if (!open && state.phase !== "idle" && state.phase !== "submitting" && state.phase !== "confirming") {
      dispatch({type: "CLOSE"});
    }
  }, [open, params, state.phase]);

  // ESC + body scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && state.phase !== "submitting" && state.phase !== "confirming") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, state.phase]);

  // Drive the orchestrator once we're in `submitting` and clients are ready.
  useEffect(() => {
    if (state.phase !== "submitting") return;
    // Dev preview short-circuit — keeps the modal frozen at submitting so
    // the ClaimQueue stub stays visible for visual review.
    if (preview) return;
    if (!clientsReady || !walletClient?.account || !noxClient) return;
    void runClaim({
      kind: state.params.kind,
      marketAddress: state.params.marketAddress,
      onAction: dispatch,
      clients: {
        walletClient,
        publicClient,
        noxClient,
        account: walletClient.account.address,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, clientsReady]);

  // Auto-close + parent refresh on success after 6s.
  useEffect(() => {
    if (state.phase !== "success") return;
    const t = setTimeout(() => {
      onSettled();
      onClose();
    }, 6000);
    return () => clearTimeout(t);
  }, [state.phase, onSettled, onClose]);

  if (!open || !params) return null;
  if (state.phase === "idle") return null;

  const kind = state.params.kind;
  const verb = kind === "claim" ? "Claiming" : "Refunding";
  const verbPast = kind === "claim" ? "Claimed" : "Refunded";
  const titleStamp = kind === "claim" ? "CLAIM // SETTLE WINNINGS" : "REFUND // INVALID MARKET";
  const titleStampSuccess = kind === "claim" ? "WINNINGS CLAIMED" : "REFUND SETTLED";

  return (
    <div
      className="modal-backdrop"
      onClick={state.phase === "submitting" || state.phase === "confirming" ? undefined : onClose}
      role="dialog"
      aria-modal
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {state.phase !== "submitting" && state.phase !== "confirming" && (
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        )}

        <div className="modal-head">
          <div className="modal-stamp">
            <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
              {state.phase === "success" ? titleStampSuccess : titleStamp}
            </span>
          </div>
          <h2 className="modal-title">
            {state.phase === "submitting" && (
              <>
                {verb} <em>position</em>.
              </>
            )}
            {state.phase === "confirming" && (
              <>
                Confirming <em>on-chain</em>.
              </>
            )}
            {state.phase === "decrypting" && (
              <>
                Decrypting <em>amount</em>.
              </>
            )}
            {state.phase === "success" && (
              <>
                {verbPast} <em>{state.amount !== null ? "and decrypted" : "(amount sealed)"}</em>.
              </>
            )}
            {state.phase === "error" && `${kind === "claim" ? "Claim" : "Refund"} failed.`}
          </h2>
        </div>

        {(state.phase === "submitting" || state.phase === "confirming" || state.phase === "decrypting") && (
          <ClaimQueue position={queueStub.position} estimatedWaitSec={queueStub.etaSec} />
        )}

        {(state.phase === "submitting" || state.phase === "confirming" || state.phase === "decrypting") && (
          <div className="cm-progress">
            <div className="cm-step" data-active={state.phase === "submitting"}>
              <Loader size={14} />
              <span className="lbl">Wallet signature</span>
              {state.phase !== "submitting" && <Check size={12} className="ok" />}
            </div>
            <div
              className="cm-step"
              data-active={state.phase === "confirming"}
              data-pending={state.phase === "submitting"}
            >
              <Loader size={14} />
              <span className="lbl">Tx confirming</span>
              {state.phase === "decrypting" && <Check size={12} className="ok" />}
              {"txHash" in state && (
                <a className="tx-hash" href={txLink(state.txHash)} target="_blank" rel="noopener noreferrer">
                  {state.txHash.slice(0, 10)}… <ExternalLink size={10} />
                </a>
              )}
            </div>
            <div
              className="cm-step"
              data-active={state.phase === "decrypting"}
              data-pending={state.phase !== "decrypting"}
            >
              <Loader size={14} />
              <span className="lbl">Decrypting payload</span>
            </div>
          </div>
        )}

        {state.phase === "success" && (
          <div className="cm-success">
            <span className="stamp stamp--red" style={{transform: "rotate(-2deg)"}}>
              {kind === "claim" ? "WINNINGS CLAIMED" : "REFUND SETTLED"}
            </span>
            {state.amount !== null ? (
              <p className="amount">
                {Number(formatUnits(state.amount, 6)).toLocaleString()} <em>cUSDC</em>
              </p>
            ) : (
              <p className="amount sealed">
                <em>Amount sealed</em>
                <span className="sub">
                  Settled on-chain. Decrypt failed off-chain — your balance is correct.
                </span>
              </p>
            )}
            <a className="tx-link" href={txLink(state.txHash)} target="_blank" rel="noopener noreferrer">
              {state.txHash.slice(0, 14)}… ↗
            </a>
            <div className="actions">
              {kind === "claim" && (
                <button
                  type="button"
                  className="modal-cta"
                  onClick={() => {
                    onSettled();
                    onClose();
                    // Soft-link to /audit for attestation generation. Honored if /audit
                    // hosts a query handler — otherwise it's a plain navigation.
                    if (typeof window !== "undefined") {
                      window.location.href = `/audit?marketId=${state.params.marketId.toString()}&tx=${state.txHash}`;
                    }
                  }}
                >
                  GENERATE ATTESTATION →
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  onSettled();
                  onClose();
                }}
              >
                CLOSE
              </button>
            </div>
          </div>
        )}

        {state.phase === "error" && (
          <div className="cm-error">
            <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
              {kind === "claim" ? "CLAIM FAILED" : "REFUND FAILED"}
              {" / "}
              {state.errorKind.replace(/_/g, " ").toUpperCase()}
            </span>
            <p className="reason">
              <code>{state.errorMessage.slice(0, 200)}</code>
            </p>
            <div className="actions">
              <button
                type="button"
                className="modal-cta"
                onClick={() => dispatch({type: "OPEN", params: state.params})}
              >
                RETRY
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                CLOSE
              </button>
            </div>
          </div>
        )}

        <div className="modal-foot">
          {state.phase === "success" && state.amount !== null
            ? "Settled on Arb Sepolia. Amount decrypted via Nox SDK."
            : "Single transaction on Arb Sepolia. Encrypted payload decrypted via iExec Nox."}
        </div>
      </div>
    </div>
  );
}

/**
 * Convenience wrapper — pass a `ClaimKind` and shared params; the modal
 * handles the rest. Used by /portfolio rows.
 */
export function buildClaimParams(
  kind: ClaimKind,
  marketId: bigint,
  marketAddress: `0x${string}`,
  side: "YES" | "NO",
): ClaimParams {
  return {kind, marketId, marketAddress, side};
}
