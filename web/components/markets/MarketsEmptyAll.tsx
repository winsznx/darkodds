import Link from "next/link";

/**
 * Cross-feed empty state — rendered when active filters reduce BOTH the
 * DarkOdds and Polymarket columns to zero. Distinct from per-column empties
 * (which render when only one side is empty) because it suggests "create
 * one yourself" as the action, not "wait for the other column to populate".
 */
export function MarketsEmptyAll({
  category,
  onClearAll,
}: {
  category: string;
  onClearAll: () => void;
}): React.ReactElement {
  return (
    <div className="markets-empty-all">
      <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)"}}>
        NO CASE FILES MATCH
      </span>
      <p className="lede">
        {category
          ? `No markets in ${category.toUpperCase()}. Be the first.`
          : "No markets matched the active filters. Adjust the bar above or be the first to create one."}
      </p>
      <div className="markets-empty-all-cta-row">
        <Link className="markets-empty-all-cta markets-empty-all-cta--primary" href="/create">
          CREATE MARKET →
        </Link>
        <button type="button" className="markets-empty-all-cta" onClick={onClearAll}>
          CLEAR FILTERS
        </button>
      </div>
    </div>
  );
}
