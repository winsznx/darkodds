"use client";

import {useMemo, useState} from "react";

import type {DarkOddsMarket} from "@/lib/darkodds/types";
import {DarkOddsState} from "@/lib/darkodds/types";
import type {PolymarketMarket, PolymarketError} from "@/lib/polymarket";

import "./markets.css";

import {DarkOddsMarketCard} from "./DarkOddsMarketCard";
import {MarketsFilter, type SortKey, type StatusKey} from "./MarketsFilter";
import {PolymarketMarketCard} from "./PolymarketMarketCard";

interface MarketsLayoutProps {
  darkOddsMarkets: DarkOddsMarket[];
  darkOddsErrors: string[];
  polymarketMarkets: PolymarketMarket[];
  polymarketError: PolymarketError | null;
}

/**
 * Parallel-feed layout. Both columns use the same filter bar at the top —
 * search, category, status, sort apply to both feeds. Empty + error states
 * are per-column so a Polymarket outage doesn't blank the DarkOdds side.
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

  // Categories available across both feeds (Polymarket has them, DarkOdds
  // doesn't ship a category field yet — F11 will when ChainGPT seeds them).
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const m of polymarketMarkets) {
      if (m.category) set.add(m.category);
    }
    return [...set].sort();
  }, [polymarketMarkets]);

  // Apply filters to each feed separately.
  const visibleDarkOdds = useMemo(() => {
    let arr = darkOddsMarkets.filter((m) => {
      if (search.trim() && !m.question.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (status === "active" && !(m.state === DarkOddsState.Open || m.state === DarkOddsState.Closed))
        return false;
      if (status === "resolved" && !m.isResolved) return false;
      // Category filtering doesn't exclude DarkOdds when no category is selected;
      // when one IS selected, DarkOdds markets (which don't have categories yet)
      // are excluded — this is honest about which side has the metadata.
      if (category) return false;
      return true;
    });
    if (sort === "newest") {
      arr = [...arr].sort((a, b) => Number(b.id - a.id));
    } else if (sort === "endingSoon") {
      arr = [...arr].sort((a, b) => Number(a.expiryTs - b.expiryTs));
    }
    // For sort=volume on DarkOdds we don't have a meaningful comparable value
    // (volume requires public-decrypted pool totals — F12). Default to id desc.
    return arr;
  }, [darkOddsMarkets, search, status, category, sort]);

  const visiblePolymarket = useMemo(() => {
    let arr = polymarketMarkets.filter((m) => {
      if (search.trim() && !m.question.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (status === "active" && !(m.active && !m.closed)) return false;
      if (status === "resolved" && !m.closed) return false;
      if (category && (m.category ?? "").toLowerCase() !== category.toLowerCase()) return false;
      return true;
    });
    if (sort === "endingSoon") {
      arr = [...arr].sort((a, b) => {
        const aT = a.endDate?.getTime() ?? Number.POSITIVE_INFINITY;
        const bT = b.endDate?.getTime() ?? Number.POSITIVE_INFINITY;
        return aT - bT;
      });
    } else if (sort === "newest") {
      // Polymarket numeric IDs are roughly creation-ordered.
      arr = [...arr].sort((a, b) => Number(b.id) - Number(a.id));
    } else {
      arr = [...arr].sort((a, b) => b.volume24hrUsd - a.volume24hrUsd);
    }
    return arr;
  }, [polymarketMarkets, search, status, category, sort]);

  return (
    <div>
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
      />

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
                PARTIAL CHAIN READ — {darkOddsErrors.length} ERROR{darkOddsErrors.length === 1 ? "" : "S"}
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
                <DarkOddsMarketCard key={m.id.toString()} market={m} />
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
    </div>
  );
}
