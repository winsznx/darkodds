"use client";

import {useEffect, useRef, useState} from "react";

import "./market-detail.css";

import {usePrivy} from "@privy-io/react-auth";
import type {Address, Hex} from "viem";

import type {DarkOddsMarketDetail} from "@/lib/darkodds/single-market";

import {BetModal} from "@/components/bet/BetModal";
import {PoolSparkline, buildStubPoolSeries} from "@/components/charts/PoolSparkline";
import {BatchTimer} from "@/components/primitives/BatchTimer";
import {DarkOddsState} from "@/lib/darkodds/types";

import {BetPanel} from "./BetPanel";
import {EventLog} from "./EventLog";
import {MarketHeader} from "./MarketHeader";
import {MarketMeta} from "./MarketMeta";
import {OutcomesPanel} from "./OutcomesPanel";
import {UserPositions, type UserPositionsHandle} from "./UserPositions";

interface MarketDetailProps {
  /** Server-rendered snapshot. User-bet handles read with no user are null;
   *  client-side we re-fetch with the connected user's address. */
  market: DarkOddsMarketDetail;
}

const RESUME_STORAGE_PREFIX = "darkodds.bet-flow:";

export function MarketDetail({market}: MarketDetailProps): React.ReactElement {
  const {user, authenticated} = usePrivy();
  const positionsRef = useRef<UserPositionsHandle>(null);
  const [betRefreshNonce, setBetRefreshNonce] = useState(0);
  const [betModalOpen, setBetModalOpen] = useState(false);
  const [betParams, setBetParams] = useState<{sideIndex: 0 | 1; amountUsdc: bigint} | null>(null);
  // Captured-at-mount; the sparkline stub is deterministic, so a stable
  // anchor keeps the curve shape from flickering across re-renders.
  const [mountSec] = useState(() => Math.floor(Date.now() / 1000));

  // Per-user bet handles. Server-side rendered without a connected user, so
  // we re-fetch client-side once Privy resolves the connected address. Keeps
  // the page fast (no SSR-blocking on auth) and renders bets correctly.
  const [userBets, setUserBets] = useState<{yes: Hex; no: Hex} | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!authenticated) {
      // Defer to microtask so React 19's set-state-in-effect lint doesn't fire.
      const t = setTimeout(() => {
        if (!cancelled) setUserBets(null);
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    const userAddr = user?.wallet?.address as Address | undefined;
    if (!userAddr) return;
    void (async () => {
      try {
        // Lazy import to keep server-bundle barrel clean.
        const {getDarkOddsMarketDetail} = await import("@/lib/darkodds/single-market");
        const detail = await getDarkOddsMarketDetail(market.id, userAddr);
        if (!cancelled && detail?.userBets) setUserBets(detail.userBets);
      } catch {
        /* leave userBets null on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, user?.wallet?.address, market.id, betRefreshNonce]);

  // Mid-flow recovery banner — F9 HALT 1 ships the empty hook so HALT 2's
  // BetModal state machine can read sessionStorage and resume.
  const [resumeAvailable, setResumeAvailable] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = RESUME_STORAGE_PREFIX + market.id.toString();
    const exists = window.sessionStorage.getItem(key) !== null;
    // Defer to microtask — React 19 set-state-in-effect rule.
    const t = setTimeout(() => setResumeAvailable(exists), 0);
    return () => clearTimeout(t);
  }, [market.id, betRefreshNonce]);

  const onResume = (): void => {
    // Wired up in HALT 2 — for HALT 1 just dismiss the banner.
    setResumeAvailable(false);
  };
  const onCancelResume = (): void => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(RESUME_STORAGE_PREFIX + market.id.toString());
    }
    setResumeAvailable(false);
  };

  const onOpenBetModal = (next: {sideIndex: 0 | 1; amountUsdc: bigint}): void => {
    setBetParams(next);
    setBetModalOpen(true);
  };
  const onBetSuccess = (): void => {
    // Bumps the refresh nonce so UserPositions + EventLog refetch + decrypt
    // the just-placed bet, then scrolls the positions section into view.
    setBetRefreshNonce((n) => n + 1);
    positionsRef.current?.scrollIntoViewAndRefresh();
  };

  return (
    <div className="md-layout">
      <div className="md-main">
        <MarketHeader
          id={market.id}
          question={market.question}
          state={market.state}
          expiryTs={market.expiryTs}
          isResolved={market.isResolved}
        />

        {resumeAvailable && (
          <div className="md-resume-banner">
            <span>BET IN PROGRESS ON THIS MARKET</span>
            <div className="actions">
              <button type="button" onClick={onCancelResume}>
                CANCEL
              </button>
              <button type="button" className="primary" onClick={onResume}>
                RESUME
              </button>
            </div>
          </div>
        )}

        {/* Real-data: lastBatchTs read on the server-side multicall. Sparkline
            is stubbed (see DRIFT_LOG → PoolSparkline). Both render only in
            Open state — once Closed/Resolved, batches stop and the history
            is fixed. */}
        {market.state === DarkOddsState.Open && (
          <>
            <PoolSparkline
              data={buildStubPoolSeries(
                market.yesPoolFrozen,
                market.noPoolFrozen,
                market.id,
                mountSec,
                Number(market.batchIntervalSec),
              )}
            />
            <BatchTimer
              nextBatchTs={
                market.lastBatchTs > BigInt(0) ? Number(market.lastBatchTs + market.batchIntervalSec) : null
              }
            />
          </>
        )}

        <OutcomesPanel outcomes={market.outcomes} />

        <UserPositions
          ref={positionsRef}
          marketAddress={market.address}
          initialUserBets={userBets}
          refreshNonce={betRefreshNonce}
        />

        <MarketMeta
          marketAddress={market.address}
          registryId={market.id}
          resolutionOracle={market.resolutionOracle}
          oracleType={market.oracleType}
          protocolFeeBps={market.protocolFeeBps}
        />

        <EventLog marketAddress={market.address} marketId={market.id} refreshNonce={betRefreshNonce} />
      </div>

      <aside className="md-aside">
        <BetPanel marketState={market.state} outcomes={market.outcomes} onOpenBetModal={onOpenBetModal} />
      </aside>

      <BetModal
        open={betModalOpen}
        onClose={() => setBetModalOpen(false)}
        params={
          betParams
            ? {
                marketAddress: market.address,
                marketId: market.id,
                sideIndex: betParams.sideIndex,
                amountUsdc: betParams.amountUsdc,
              }
            : null
        }
        marketState={{
          yesPoolFrozen: market.yesPoolFrozen,
          noPoolFrozen: market.noPoolFrozen,
          protocolFeeBps: market.protocolFeeBps,
        }}
        outcomeLabels={[market.outcomes[0].label, market.outcomes[1].label]}
        onSuccess={onBetSuccess}
      />
    </div>
  );
}
