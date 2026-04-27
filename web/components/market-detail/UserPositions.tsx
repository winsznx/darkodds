"use client";

import {forwardRef, useCallback, useEffect, useImperativeHandle, useState} from "react";

import {usePrivy} from "@privy-io/react-auth";
import {formatUnits, type Hex} from "viem";

import {useNoxClient} from "@/lib/nox/client-hook";

import {ZERO_BYTES32} from "@/lib/darkodds/single-market";

interface UserPositionsProps {
  marketAddress: Hex;
  /** Bet handles snapshot from the page server-render. May be ZERO_BYTES32 for
   *  unbet sides; non-zero handles get decrypted client-side. */
  initialUserBets: {yes: Hex; no: Hex} | null;
  /** Bumped by the parent after a successful bet to force a re-fetch + decrypt. */
  refreshNonce?: number;
}

interface DecryptedPosition {
  side: "YES" | "NO";
  status: "loading" | "ok" | "error";
  amount: bigint | null;
  errorMessage: string | null;
}

export interface UserPositionsHandle {
  scrollIntoViewAndRefresh: () => void;
}

/**
 * Reads `Market.yesBet(user)` and `Market.noBet(user)` snapshots passed in
 * from the server render, then client-side decrypts each non-zero handle
 * via `useNoxClient()`. Decryption is best-effort — failures show a
 * redaction bar with inline "RETRY DECRYPT".
 *
 * Exposes a ref handle so the bet flow's success state can scroll this
 * section into view + force a refresh of the just-placed bet.
 */
export const UserPositions = forwardRef<UserPositionsHandle, UserPositionsProps>(function UserPositions(
  {initialUserBets, refreshNonce = 0},
  ref,
) {
  const {authenticated} = usePrivy();
  const {client: nox, ready: noxReady} = useNoxClient();

  const [positions, setPositions] = useState<DecryptedPosition[]>([]);
  const [internalNonce, setInternalNonce] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      scrollIntoViewAndRefresh: () => {
        const el = document.getElementById("user-positions");
        if (el) el.scrollIntoView({behavior: "smooth", block: "start"});
        setInternalNonce((n) => n + 1);
      },
    }),
    [],
  );

  const decryptHandles = useCallback(async () => {
    if (!authenticated || !noxReady || !nox || !initialUserBets) {
      setPositions([]);
      return;
    }
    const sides: {side: "YES" | "NO"; handle: Hex}[] = [];
    if (initialUserBets.yes !== ZERO_BYTES32) sides.push({side: "YES", handle: initialUserBets.yes});
    if (initialUserBets.no !== ZERO_BYTES32) sides.push({side: "NO", handle: initialUserBets.no});

    if (sides.length === 0) {
      setPositions([]);
      return;
    }

    setPositions(sides.map(({side}) => ({side, status: "loading", amount: null, errorMessage: null})));

    const results = await Promise.all(
      sides.map(async ({side, handle}) => {
        try {
          const out = await nox.decrypt(handle);
          if (typeof out.value !== "bigint") {
            return {side, status: "error" as const, amount: null, errorMessage: "non-bigint result"};
          }
          return {side, status: "ok" as const, amount: out.value, errorMessage: null};
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {side, status: "error" as const, amount: null, errorMessage: message};
        }
      }),
    );
    setPositions(results);
  }, [authenticated, noxReady, nox, initialUserBets]);

  useEffect(() => {
    void decryptHandles();
  }, [decryptHandles, refreshNonce, internalNonce]);

  const retryOne = (side: "YES" | "NO"): void => {
    setPositions((curr) =>
      curr.map((p) => (p.side === side ? {...p, status: "loading", errorMessage: null} : p)),
    );
    setInternalNonce((n) => n + 1);
  };

  return (
    <section id="user-positions" className="md-positions" aria-label="Your positions">
      <h2 className="md-section-h">
        <span>Your positions</span>
        {authenticated && positions.length > 0 && (
          <button
            type="button"
            className="md-position-row"
            style={{
              padding: "4px 8px",
              fontSize: 10,
              border: "1px solid var(--hairline-strong)",
              background: "transparent",
              cursor: "pointer",
            }}
            onClick={() => setInternalNonce((n) => n + 1)}
            aria-label="Refresh positions"
          >
            REFRESH ↻
          </button>
        )}
      </h2>

      {!authenticated && (
        <div className="md-empty">
          <p>CONNECT WALLET TO VIEW POSITIONS</p>
        </div>
      )}

      {authenticated && positions.length === 0 && (
        <div className="md-empty">
          <p>NO POSITIONS — PLACE A BET TO START</p>
        </div>
      )}

      {authenticated && positions.length > 0 && (
        <div className="md-position-list">
          {positions.map((p) => (
            <div key={p.side} className="md-position-row">
              <span className="lbl">{p.side}</span>
              {p.status === "loading" && (
                <span className="rbar" aria-label="Decrypting">
                  <span className="pulse" />
                </span>
              )}
              {p.status === "ok" && p.amount !== null && (
                <span className="v">{Number(formatUnits(p.amount, 6)).toLocaleString()} cUSDC</span>
              )}
              {p.status === "error" && (
                <span className="rbar" title={p.errorMessage ?? "decrypt failed"}>
                  <span className="bar" />
                  <button type="button" className="retry" onClick={() => retryOne(p.side)}>
                    RETRY DECRYPT
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
});
