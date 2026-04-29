"use client";

import {useEffect, useState} from "react";

import {usePrivy} from "@privy-io/react-auth";
import Link from "next/link";
import type {Address} from "viem";

import "./portfolio.css";

import {ClaimModal} from "@/components/claim/ClaimModal";
import {PositionRow} from "@/components/portfolio/PositionRow";
import {getPortfolio, type PortfolioPosition} from "@/lib/darkodds/portfolio";
import {type ClaimParams} from "@/lib/claim/state-machine";

/// Stub params used by the dev-only `?preview-claim-queue=1` toggle. Targets
/// the placeholder Market.sol address so any unintended runClaim attempt
/// would simply fail rather than touching a real market.
const PREVIEW_PARAMS: ClaimParams = {
  kind: "claim",
  marketId: BigInt(1),
  marketAddress: "0x0000000000000000000000000000000000000001",
  side: "YES",
};

/**
 * /portfolio — wallet-gated list of every market the connected user has
 * a non-zero bet handle on. Per row: decrypted stake, state badge, action
 * CTA (CLAIM WINNINGS / CLAIM REFUND / no-op).
 *
 * Client component because position decryption requires the connected
 * wallet's signature via Nox SDK. Reuses `getPortfolio` (server-callable)
 * directly — Next allows server-side imports inside client modules; the
 * dynamic-import barrier in MarketDetail (F9) is only needed when the
 * server fn touches Node-only APIs, which `getPortfolio` does not.
 */
export default function PortfolioPage(): React.ReactElement {
  const {authenticated, user, ready: privyReady} = usePrivy();

  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimParams, setClaimParams] = useState<ClaimParams | null>(null);

  const userAddress = user?.wallet?.address as Address | undefined;

  // Dev-only ClaimQueue preview. `?preview-claim-queue=1` opens the modal
  // frozen at the submitting phase with stub params so the ClaimQueue
  // strip is visible without needing a real claimable position. Mirrors
  // the existing ?force-pm-error=1 dev toggle on /markets. The literal
  // `process.env.NODE_ENV` check is statically replaced by the bundler, so
  // production builds dead-code-elim the entire branch. Reads
  // `window.location.search` directly inside an effect rather than
  // useSearchParams() to keep /portfolio prerenderable without a Suspense
  // boundary.
  const [previewClaimQueue, setPreviewClaimQueue] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("preview-claim-queue") !== "1") return;
    const t = setTimeout(() => {
      setPreviewClaimQueue(true);
      setClaimParams(PREVIEW_PARAMS);
      setClaimModalOpen(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // F9 MarketDetail pattern: defer all sync setState into a setTimeout so
  // React 19's set-state-in-effect lint doesn't fire. The actual async work
  // sets state inside post-await branches which are exempt.
  useEffect(() => {
    if (!privyReady) return;
    let cancelled = false;
    if (!userAddress) {
      const t = setTimeout(() => {
        if (cancelled) return;
        setPositions([]);
        setLoading(false);
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    void (async () => {
      try {
        const result = await getPortfolio(userAddress);
        if (cancelled) return;
        setPositions(result.positions);
        setErrors(result.errors);
      } catch (err) {
        if (cancelled) return;
        setErrors([err instanceof Error ? err.message : String(err)]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [privyReady, userAddress, refreshNonce]);

  const openClaim = (position: PortfolioPosition): void => {
    setClaimParams({
      kind: "claim",
      marketId: BigInt(position.marketId),
      marketAddress: position.marketAddress,
      side: position.side,
    });
    setClaimModalOpen(true);
  };

  const openRefund = (position: PortfolioPosition): void => {
    setClaimParams({
      kind: "refund",
      marketId: BigInt(position.marketId),
      marketAddress: position.marketAddress,
      side: position.side,
    });
    setClaimModalOpen(true);
  };

  const onSettled = (): void => {
    setClaimParams(null);
    setClaimModalOpen(false);
    setRefreshNonce((n) => n + 1);
  };

  return (
    <>
      <header className="page-header">
        <h1 className="h">
          Your <em>positions.</em>
        </h1>
        <span className="meta">
          {positions.length} {positions.length === 1 ? "position" : "positions"}
        </span>
      </header>

      <section className="pf-body">
        {!privyReady && <div className="pf-gate">LOADING…</div>}

        {privyReady && !authenticated && <div className="pf-gate">CONNECT WALLET TO VIEW YOUR PORTFOLIO</div>}

        {privyReady && authenticated && loading && positions.length === 0 && (
          <div className="pf-gate">READING CHAIN STATE…</div>
        )}

        {privyReady && authenticated && !loading && positions.length === 0 && (
          <div className="pf-empty">
            <p>NO POSITIONS YET. Find a market to wager on.</p>
            <Link href="/markets">→ BROWSE MARKETS</Link>
          </div>
        )}

        {positions.length > 0 && (
          <div className="pf-list">
            {positions.map((p) => (
              <PositionRow
                key={`${p.marketId.toString()}-${p.side}`}
                position={p}
                refreshNonce={refreshNonce}
                onClaim={() => openClaim(p)}
                onRefund={() => openRefund(p)}
              />
            ))}
          </div>
        )}

        {errors.length > 0 && (
          <div className="pf-empty" style={{borderColor: "var(--redacted-red)"}} aria-label="Errors">
            <p style={{fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--redacted-red)"}}>
              {errors.length} read error{errors.length === 1 ? "" : "s"} — partial portfolio rendered.
            </p>
          </div>
        )}
      </section>

      <ClaimModal
        open={claimModalOpen}
        params={claimParams}
        onClose={() => setClaimModalOpen(false)}
        onSettled={onSettled}
        preview={previewClaimQueue}
      />
    </>
  );
}
