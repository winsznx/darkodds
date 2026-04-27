"use client";

import {Search} from "lucide-react";

export type SortKey = "volume" | "endingSoon" | "newest";
export type StatusKey = "all" | "active" | "resolved";

interface MarketsFilterProps {
  search: string;
  onSearch: (s: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  status: StatusKey;
  onStatus: (s: StatusKey) => void;
  category: string;
  onCategory: (c: string) => void;
  /** Categories pulled from loaded Polymarket data + DarkOdds data. */
  availableCategories: string[];
}

export function MarketsFilter(props: MarketsFilterProps): React.ReactElement {
  const {search, onSearch, sort, onSort, status, onStatus, category, onCategory, availableCategories} = props;

  return (
    <div className="markets-filter" role="region" aria-label="Filters">
      <div className="filter-group" style={{flex: "1 1 240px", minWidth: 0}}>
        <Search size={14} aria-hidden style={{color: "var(--fg-muted)", flexShrink: 0}} />
        <input
          className="filter-search"
          type="search"
          placeholder="SEARCH MARKETS"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor="markets-status">
          Status
        </label>
        <select
          id="markets-status"
          className="filter-select"
          value={status}
          onChange={(e) => onStatus(e.target.value as StatusKey)}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor="markets-category">
          Category
        </label>
        <select
          id="markets-category"
          className="filter-select"
          value={category}
          onChange={(e) => onCategory(e.target.value)}
        >
          <option value="">All</option>
          {availableCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor="markets-sort">
          Sort
        </label>
        <select
          id="markets-sort"
          className="filter-select"
          value={sort}
          onChange={(e) => onSort(e.target.value as SortKey)}
        >
          <option value="volume">Volume</option>
          <option value="endingSoon">Ending soon</option>
          <option value="newest">Recently created</option>
        </select>
      </div>
    </div>
  );
}
