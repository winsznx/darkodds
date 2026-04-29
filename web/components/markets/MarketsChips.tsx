"use client";

import {X} from "lucide-react";

import {SORT_LABELS, type SortKey, type StatusKey} from "./MarketsFilter";

/**
 * Active-filter chip strip. Renders one × pill per non-default filter
 * applied. Click × to reset that filter only. Hidden when no filters
 * are active.
 *
 * "Default" means: search empty, status=all, category empty, sort=volume.
 */
interface MarketsChipsProps {
  search: string;
  onClearSearch: () => void;
  status: StatusKey;
  onClearStatus: () => void;
  category: string;
  onClearCategory: () => void;
  sort: SortKey;
  onClearSort: () => void;
}

export function MarketsChips({
  search,
  onClearSearch,
  status,
  onClearStatus,
  category,
  onClearCategory,
  sort,
  onClearSort,
}: MarketsChipsProps): React.ReactElement | null {
  const chips: Array<{label: string; onClear: () => void; key: string}> = [];

  if (search.trim()) {
    chips.push({
      key: "search",
      label: `“${search.trim().slice(0, 24)}${search.trim().length > 24 ? "…" : ""}”`,
      onClear: onClearSearch,
    });
  }
  if (status !== "all") {
    chips.push({key: "status", label: status.toUpperCase(), onClear: onClearStatus});
  }
  if (category) {
    chips.push({key: "category", label: category.toUpperCase(), onClear: onClearCategory});
  }
  if (sort !== "volume") {
    chips.push({key: "sort", label: `BY ${SORT_LABELS[sort].toUpperCase()}`, onClear: onClearSort});
  }

  if (chips.length === 0) return null;

  return (
    <div className="markets-chips" role="region" aria-label="Active filters">
      {chips.map((c) => (
        <button
          type="button"
          key={c.key}
          className="markets-chip"
          onClick={c.onClear}
          aria-label={`Clear ${c.key} filter`}
        >
          <span>{c.label}</span>
          <X size={11} aria-hidden />
        </button>
      ))}
    </div>
  );
}
