import type {PolymarketMarket} from "@/lib/polymarket";

/**
 * Domain-tag whitelist. Polymarket exposes 100+ tags including editorial
 * meta-tags ("Trending", "Featured", "All", "Carousel" etc.) that don't
 * make sense as category pills. Pills should answer "what topic is this?",
 * not "did the editorial team highlight it?". Filter every market's tag
 * array through this set before picking a category.
 *
 * Order is intentional but not load-bearing — the picker walks the market's
 * tag list (Polymarket's natural ordering, most-relevant first) and returns
 * the first hit.
 */
export const DOMAIN_TAGS: ReadonlySet<string> = new Set([
  "Politics",
  "Sports",
  "Crypto",
  "Culture",
  "Climate",
  "Economics",
  "Tech",
  "Entertainment",
  "Geopolitics",
  "Business",
  "Science",
  "Elections",
]);

/**
 * Resolve a Polymarket market's category for the pill. Walks the tag array
 * looking for a domain-tag hit; falls back to the lib-derived `category`
 * field; falls back to "Other" if nothing matches.
 *
 * The lib-derived `category` is itself the first non-`forceHide` tag, which
 * is *usually* a domain tag but occasionally a sub-genre like "Bitcoin" or
 * "Iran". The two layers complement: the pill renders the broadest domain
 * we have evidence for, the underlying tag list still surfaces fine-grained
 * filters in the future if we want them.
 */
export function derivePolymarketCategory(market: PolymarketMarket): string {
  for (const tag of market.tags) {
    if (DOMAIN_TAGS.has(tag.label)) return tag.label;
  }
  if (market.category && DOMAIN_TAGS.has(market.category)) return market.category;
  return market.category ?? "Other";
}

/**
 * Build the union of category labels available across loaded markets, used
 * by the filter dropdown. DarkOdds-side gets a single literal "PRIVATE"
 * pill (its own column) and Polymarket-side gets the domain-filtered
 * categories present in the loaded data. Sorted alpha.
 */
export function buildCategoryUnion(polymarketMarkets: PolymarketMarket[]): string[] {
  const set = new Set<string>();
  for (const m of polymarketMarkets) {
    set.add(derivePolymarketCategory(m));
  }
  return [...set].sort();
}
