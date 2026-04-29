"use client";

import {useCallback, useEffect, useMemo, useState} from "react";

import type {DarkOddsMarket} from "@/lib/darkodds/types";
import {DarkOddsState} from "@/lib/darkodds/types";
import {buildCategoryUnion, derivePolymarketCategory} from "@/lib/markets/categories";
import {localCreatedIdSet} from "@/lib/markets/created-markets";
import type {PolymarketMarket, PolymarketError} from "@/lib/polymarket";
import {useConnectedAddress} from "@/lib/wallet/use-connected-address";

import "./markets.css";

import {DarkOddsMarketCard} from "./DarkOddsMarketCard";
import {MarketsChips} from "./MarketsChips";
import {MarketsEmptyAll} from "./MarketsEmptyAll";
import {MarketsFeatured} from "./MarketsFeatured";
import {MarketsFilter, type SortKey, type StatusKey} from "./MarketsFilter";
import {PolymarketMarketCard} from "./PolymarketMarketCard";

interface MarketsLayoutProps {
  darkOddsMarkets: DarkOddsMarket[];
  darkOddsErrors: string[];
  polymarketMarkets: PolymarketMarket[];
  polymarketError: PolymarketError | null;
}

/**
 * Parallel-feed layout. Above the fold: the featured strip (top 3 by 24h
 * volume across both feeds). Below: a sticky filter bar + active filter
 * chips + the two-column DarkOdds // Private + Polymarket // Public layout.
 *
 * All filters apply to both columns. Empty + error states are per-column
 * so a Polymarket outage doesn't blank the DarkOdds side; the cross-feed
 * empty state appears only when filters reduce both sides to zero.
 *
 * Sort keys (3):
 *   volume       — Polymarket: volume24hrUsd desc; DarkOdds: id desc (stand-in
 *                  until subgraph aggregation lands per the F11 work)
 *   newest       — both sides: id desc
 *   endingSoon   — both sides: endDate ascending, ENDED filtered out
 *
 * "Most bettors" was removed before ship — its DarkOdds and Polymarket
 * implementations both fell back to id-desc/volume, producing output
 * indistinguishable from the other two sorts. Three honest sorts beat
 * four with one mislabeled.
 */
export function MarketsLayout({
  darkOddsMarkets,
  darkOddsErrors,
  polymarketMarkets,
  polymarketError,
}: MarketsLayoutProps): React.ReactElement {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");
  const [status, setStatus] = useState<StatusKey>("all");
  const [category, setCategory] = useState("");
  const [mine, setMine] = useState(false);
  // "Now" is captured at mount and never updated — the ENDING SOON sort
  // uses time-of-mount as its cutoff, which is good enough for a
  // page-session and keeps the useMemo bodies pure (react-hooks/purity).
  const [nowMs] = useState(() => Date.now());
  const nowSec = useMemo(() => BigInt(Math.floor(nowMs / 1000)), [nowMs]);

  // Created-market merge: localStorage is the fast path (instant, no network),
  // /api/markets/created-by/[address] is the authoritative path that survives
  // browser-storage clears + device switches. Both fold into one Set.
  const connectedAddress = useConnectedAddress();
  const [localCreatedIds, setLocalCreatedIds] = useState<Set<string>>(() => new Set());
  const [serverCreatedIds, setServerCreatedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const next = localCreatedIdSet();
    const t = setTimeout(() => setLocalCreatedIds(next), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!connectedAddress) {
      const t = setTimeout(() => setServerCreatedIds(new Set()), 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/markets/created-by/${connectedAddress}`, {cache: "no-store"});
        const json = (await res.json()) as {ok: boolean; marketIds?: string[]};
        if (cancelled) return;
        if (json.ok && Array.isArray(json.marketIds)) {
          setServerCreatedIds(new Set(json.marketIds));
        }
      } catch {
        // Server ledger fetch failed — localStorage stays as the only source.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectedAddress]);

  const myCreatedIds = useMemo(() => {
    const merged = new Set<string>(localCreatedIds);
    for (const id of serverCreatedIds) merged.add(id);
    return merged;
  }, [localCreatedIds, serverCreatedIds]);

  const mineAvailable = connectedAddress !== undefined && myCreatedIds.size > 0;
  const mineActive = mine && mineAvailable;

  const availableCategories = useMemo(() => {
    const union = buildCategoryUnion(polymarketMarkets);
    if (darkOddsMarkets.length > 0 && !union.includes("Private")) {
      union.push("Private");
    }
    return union.sort();
  }, [polymarketMarkets, darkOddsMarkets]);

  const visibleDarkOdds = useMemo(() => {
    let arr = darkOddsMarkets.filter((m) => {
      if (search.trim() && !m.question.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (status === "active" && !(m.state === DarkOddsState.Open || m.state === DarkOddsState.Closed))
        return false;
      if (status === "resolved" && !m.isResolved) return false;
      // DarkOdds-native markets all live under the "Private" category — show
      // them when filter is unset OR when filter is "Private". Hide them
      // when any other domain category is selected.
      if (category && category.toLowerCase() !== "private") return false;
      if (mineActive && !myCreatedIds.has(m.id.toString())) return false;
      return true;
    });
    if (sort === "newest" || sort === "volume") {
      arr = [...arr].sort((a, b) => Number(b.id - a.id));
    } else if (sort === "endingSoon") {
      arr = [...arr].filter((m) => m.expiryTs > nowSec).sort((a, b) => Number(a.expiryTs - b.expiryTs));
    }
    return arr;
  }, [darkOddsMarkets, search, status, category, sort, nowSec, mineActive, myCreatedIds]);

  const visiblePolymarket = useMemo(() => {
    if (mineActive) return [];
    let arr = polymarketMarkets.filter((m) => {
      if (search.trim() && !m.question.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (status === "active" && !(m.active && !m.closed)) return false;
      if (status === "resolved" && !m.closed) return false;
      if (category) {
        if (category.toLowerCase() === "private") return false;
        const cat = derivePolymarketCategory(m).toLowerCase();
        if (cat !== category.toLowerCase()) return false;
      }
      return true;
    });
    if (sort === "endingSoon") {
      arr = [...arr]
        .filter((m) => m.endDate && m.endDate.getTime() > nowMs)
        .sort((a, b) => (a.endDate?.getTime() ?? 0) - (b.endDate?.getTime() ?? 0));
    } else if (sort === "newest") {
      // Polymarket numeric ids are roughly creation-ordered.
      arr = [...arr].sort((a, b) => Number(b.id) - Number(a.id));
    } else {
      arr = [...arr].sort((a, b) => b.volume24hrUsd - a.volume24hrUsd);
    }
    return arr;
  }, [polymarketMarkets, search, status, category, sort, nowMs, mineActive]);

  const clearAll = useCallback(() => {
    setSearch("");
    setStatus("all");
    setCategory("");
    setSort("volume");
    setMine(false);
  }, []);

  const bothEmpty = visibleDarkOdds.length === 0 && visiblePolymarket.length === 0;
  const hasAnyFilter =
    search.trim() !== "" || status !== "all" || category !== "" || sort !== "volume" || mineActive;

  return (
    <div className="markets-shell">
      <MarketsFeatured darkOddsMarkets={darkOddsMarkets} polymarketMarkets={polymarketMarkets} />

      <div className="markets-filter-wrap">
        <MarketsFilter
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={setSort}
          status={status}
          onStatus={setStatus}
          category={category}
          onCategory={setCategory}
          availableCategories={availableCategories}
          mine={mine}
          onMine={setMine}
          mineAvailable={mineAvailable}
        />
        <MarketsChips
          search={search}
          onClearSearch={() => setSearch("")}
          status={status}
          onClearStatus={() => setStatus("all")}
          category={category}
          onClearCategory={() => setCategory("")}
          sort={sort}
          onClearSort={() => setSort("volume")}
          mine={mineActive}
          onClearMine={() => setMine(false)}
        />
      </div>

      {bothEmpty && hasAnyFilter ? (
        <MarketsEmptyAll category={category} onClearAll={clearAll} />
      ) : (
        <div className="markets-feed">
          <section className="markets-column" aria-label="DarkOdds markets">
            <div className="markets-column-head">
              <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
                DARKODDS // PRIVATE
              </span>
              <span className="count">
                {visibleDarkOdds.length} OF {darkOddsMarkets.length}
              </span>
            </div>

            {darkOddsErrors.length > 0 && (
              <div className="markets-error-banner" role="alert">
                <span>
                  PARTIAL CHAIN READ — {darkOddsErrors.length} ERROR
                  {darkOddsErrors.length === 1 ? "" : "S"}
                </span>
                <span style={{fontSize: 9, color: "var(--fg-muted)"}}>see verify-f8 / verify-backend</span>
              </div>
            )}

            {visibleDarkOdds.length === 0 ? (
              <div className="markets-empty">
                <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)"}}>
                  {darkOddsMarkets.length === 0 ? "NO MARKETS YET" : "NO MATCHES"}
                </span>
                <p className="lede">
                  {darkOddsMarkets.length === 0
                    ? "First market lands when /create ships in Phase F11. Until then this column is intentionally empty."
                    : "Adjust the filter bar above to widen results."}
                </p>
                {darkOddsMarkets.length === 0 && (
                  <a className="empty-cta" href="/create">
                    GO TO /CREATE →
                  </a>
                )}
              </div>
            ) : (
              <div className="markets-cardlist">
                {visibleDarkOdds.map((m) => (
                  <DarkOddsMarketCard
                    key={m.id.toString()}
                    market={m}
                    createdByMe={myCreatedIds.has(m.id.toString())}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="markets-column" aria-label="Polymarket markets">
            <div className="markets-column-head">
              <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)"}}>
                POLYMARKET // PUBLIC
              </span>
              <span className="count">
                {visiblePolymarket.length} OF {polymarketMarkets.length}
              </span>
            </div>

            {polymarketError && (
              <div className="markets-empty">
                <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
                  POLYMARKET DATA UNAVAILABLE
                </span>
                <p className="lede">
                  Gamma API returned <code>{polymarketError.kind}</code>
                  {polymarketError.status ? ` (${polymarketError.status})` : ""}. The DarkOdds column is
                  unaffected. Reload to retry.
                </p>
                <button type="button" className="empty-cta" onClick={() => window.location.reload()}>
                  RETRY ↻
                </button>
              </div>
            )}

            {!polymarketError && visiblePolymarket.length === 0 && (
              <div className="markets-empty">
                <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)"}}>
                  NO MATCHES
                </span>
                <p className="lede">No Polymarket markets matched the active filter.</p>
              </div>
            )}

            {!polymarketError && visiblePolymarket.length > 0 && (
              <div className="markets-cardlist">
                {visiblePolymarket.map((m) => (
                  <PolymarketMarketCard key={m.id} market={m} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
