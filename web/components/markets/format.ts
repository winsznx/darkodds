/**
 * Shared formatters for /markets cards. Same logic on both DarkOdds and
 * Polymarket sides so number rendering is uniform.
 */

/**
 * Render probability with edge-case handling per F8 constraint #3:
 *  - <0.001 → "<0.1%" (avoids the "0.0%" reads-as-resolved illusion)
 *  - >0.999 → ">99.9%"
 *  - else → "X.X%"
 *
 * `null` input means probability is unknown (DarkOdds Open market with no
 * frozen pool yet) — render as "—".
 */
export function formatProbability(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  if (p < 0.001) return "<0.1%";
  if (p > 0.999) return ">99.9%";
  return `${(p * 100).toFixed(1)}%`;
}

/** Compact USD: $1.5M / $48.5K / $123. */
export function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Compact tUSDC for DarkOdds pool sizes (6-decimal bigint base units). */
export function formatTUsdc(amount: bigint): string {
  const asNumber = Number(amount) / 1_000_000;
  return formatUsdCompact(asNumber);
}

/**
 * Time-until-end string. Used on both card types.
 *  - null → "EVERGREEN"
 *  - past → "ENDED"
 *  - future → "5D LEFT" / "12H LEFT" / "<1H"
 */
export function formatEndDate(end: Date | null): string {
  if (!end) return "EVERGREEN";
  const diff = end.getTime() - Date.now();
  if (diff <= 0) return "ENDED";
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `${days}D LEFT`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `${hours}H LEFT`;
  return "<1H";
}
