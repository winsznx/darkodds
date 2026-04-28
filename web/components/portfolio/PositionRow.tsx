"use client";

import {useEffect, useState} from "react";

import {usePrivy} from "@privy-io/react-auth";
import {formatUnits} from "viem";

import {DarkOddsState} from "@/lib/darkodds/types";
import type {PortfolioPosition} from "@/lib/darkodds/portfolio";
import {safeDecrypt, useNoxClient} from "@/lib/nox/client-hook";

interface PositionRowProps {
  position: PortfolioPosition;
  /** Bumped after a successful claim/refund to force a re-decrypt + re-render. */
  refreshNonce: number;
  onClaim: () => void;
  onRefund: () => void;
}

interface Decrypted {
  status: "loading" | "ok" | "error";
  amount: bigint | null;
  message: string | null;
}

/**
 * Single-position card for /portfolio. Decrypts the user's bet handle via
 * `useNoxClient()` (mirrors UserPositions from F9 detail page) and renders
 * one of three CTAs based on `position.canClaim` / `canRefund` / OPEN.
 *
 * Estimated payout calculation matches Market.claimWinnings (F9 contract):
 *    gross = bet * totalPool / winningSide
 *    fee   = gross * feeBps / 10000
 *    net   = gross - fee
 */
export function PositionRow({
  position,
  refreshNonce,
  onClaim,
  onRefund,
}: PositionRowProps): React.ReactElement {
  const {client: nox, ready: noxReady} = useNoxClient();
  const {user} = usePrivy();
  const walletAddress = user?.wallet?.address;
  const [decrypted, setDecrypted] = useState<Decrypted>({status: "loading", amount: null, message: null});
  const [internalNonce, setInternalNonce] = useState(0);

  // F9 MarketDetail pattern: defer sync setStates into setTimeout so React
  // 19's set-state-in-effect lint doesn't fire. Async work inside .then()
  // branches is exempt.
  //
  // Decrypts go through `safeDecrypt` (lib/nox/client-hook.ts) which
  // serializes the FIRST decrypt per wallet so concurrent PositionRows
  // don't all trigger parallel auth signature popups.
  useEffect(() => {
    let cancelled = false;
    if (!noxReady || !nox || !walletAddress) {
      const t = setTimeout(() => {
        if (!cancelled) setDecrypted({status: "loading", amount: null, message: null});
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    void safeDecrypt(nox, position.betHandle, walletAddress)
      .then((out) => {
        if (cancelled) return;
        if (typeof out.value !== "bigint") {
          setDecrypted({status: "error", amount: null, message: "non-bigint"});
          return;
        }
        setDecrypted({status: "ok", amount: out.value, message: null});
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setDecrypted({status: "error", amount: null, message});
      });
    return () => {
      cancelled = true;
    };
  }, [nox, noxReady, walletAddress, position.betHandle, refreshNonce, internalNonce]);

  // Suppress the state badge when the user has already claimed — otherwise
  // a settled ClaimWindow row would render BOTH "CLAIMABLE" and "CLAIMED",
  // which is confusing. "CLAIMED" alone is the canonical post-settle label.
  const stateLabel: {label: string; cls: string} | null = (() => {
    if (position.hasClaimed) return null;
    if (position.state === DarkOddsState.Open) return {label: "OPEN", cls: "open"};
    if (position.state === DarkOddsState.ClaimWindow) return {label: "CLAIMABLE", cls: "claimwindow"};
    if (position.state === DarkOddsState.Invalid) return {label: "INVALID", cls: "invalid"};
    if (position.state === DarkOddsState.Resolved) return {label: "RESOLVED", cls: "resolved"};
    if (position.state === DarkOddsState.Closed) return {label: "CLOSED", cls: "resolved"};
    if (position.state === DarkOddsState.Resolving) return {label: "RESOLVING", cls: "resolved"};
    return {label: "PENDING", cls: "resolved"};
  })();

  // Estimated net payout for ClaimWindow + winning side. Requires decrypted bet.
  const estPayout = ((): bigint | null => {
    if (!position.isWinner || decrypted.status !== "ok" || decrypted.amount === null) return null;
    const totalPool = position.yesPoolFrozen + position.noPoolFrozen;
    const winningSide = position.outcome === 1 ? position.yesPoolFrozen : position.noPoolFrozen;
    if (winningSide === BigInt(0)) return null;
    const gross = (decrypted.amount * totalPool) / winningSide;
    const fee = (gross * position.protocolFeeBps) / BigInt(10_000);
    return gross - fee;
  })();

  const renderStakeValue = (): React.ReactElement => {
    if (decrypted.status === "loading") {
      return (
        <span className="v loading" aria-label="Decrypting">
          <span className="rbar pulse" />
        </span>
      );
    }
    if (decrypted.status === "error") {
      return (
        <span className="v error" title={decrypted.message ?? "decrypt failed"}>
          <span className="rbar" /> RETRY
          <button
            type="button"
            onClick={() => setInternalNonce((n) => n + 1)}
            style={{
              marginLeft: 6,
              background: "transparent",
              border: "1px solid var(--hairline-strong)",
              padding: "2px 6px",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              color: "var(--fg)",
            }}
          >
            ↻
          </button>
        </span>
      );
    }
    if (decrypted.amount === null) return <span className="v">—</span>;
    return <span className="v">{Number(formatUnits(decrypted.amount, 6)).toLocaleString()} cUSDC</span>;
  };

  const sideClass = position.side === "YES" ? "yes" : "no";

  return (
    <div className="pf-row">
      <div>
        <a className="question" href={`/markets/${position.marketId.toString()}`}>
          {position.question}
        </a>
        <div className="meta-row">
          <span className={`side ${sideClass}`}>BET: {position.side}</span>
          {stateLabel && <span className={`state-badge ${stateLabel.cls}`}>{stateLabel.label}</span>}
          {position.hasClaimed && <span className="state-badge resolved">CLAIMED</span>}
        </div>
      </div>

      <div className="stake-block">
        <span className="k">Stake</span>
        {renderStakeValue()}
        {estPayout !== null && (
          <>
            <span className="k" style={{marginTop: 6}}>
              Est. payout
            </span>
            <span className="v">{Number(formatUnits(estPayout, 6)).toLocaleString()} cUSDC</span>
          </>
        )}
      </div>

      <div className="actions">
        {position.canClaim && (
          <button type="button" className="cta" onClick={onClaim}>
            CLAIM WINNINGS
          </button>
        )}
        {position.canRefund && (
          <button type="button" className="cta" onClick={onRefund}>
            CLAIM REFUND
          </button>
        )}
        {!position.canClaim &&
          !position.canRefund &&
          position.state === DarkOddsState.ClaimWindow &&
          !position.hasClaimed && <span className="cta ghost">DID NOT WIN</span>}
        {!position.canClaim && !position.canRefund && position.state === DarkOddsState.Open && (
          <span className="cta ghost">POSITION ACTIVE — NO ACTION</span>
        )}
        {position.hasClaimed && <span className="cta ghost">SETTLED</span>}
      </div>
    </div>
  );
}
