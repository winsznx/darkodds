/**
 * Pre-flight bet quote — pari-mutuel payout estimate.
 *
 * HALT 2 (this file) ships a fast client-side estimate using the same math
 * the contract uses, applied to the current frozen pools (or publicly-decrypted
 * Open-state pools) plus the user's incoming bet contribution:
 *
 *   newWinningSide = oldWinningSide + amount
 *   newTotalPool   = oldTotalPool   + amount
 *   gross          = (amount * newTotalPool) / newWinningSide
 *   fee            = (gross * protocolFeeBps) / 10_000
 *   net            = gross - fee
 *
 * HALT 3 will optionally replace this with a `simulateContract` round-trip
 * for an exact on-chain quote — the function shape stays the same so callers
 * (BetPanel, BetModal review state) don't change.
 */

export interface BetQuoteInput {
  amountUsdc: bigint;
  /** 0 = NO, 1 = YES */
  sideIndex: 0 | 1;
  yesPoolFrozen: bigint;
  noPoolFrozen: bigint;
  protocolFeeBps: bigint;
}

export interface BetQuote {
  /** Estimated net payout if user wins, in 6-decimal base units. */
  netPayoutUsdc: bigint;
  /** Estimated gross payout (before fee). */
  grossPayoutUsdc: bigint;
  /** Estimated fee deducted. */
  feeUsdc: bigint;
  /** Multiplier on stake (net / amount). null if amount = 0. */
  multiplier: number | null;
}

export function computeBetQuote(input: BetQuoteInput): BetQuote {
  const {amountUsdc, sideIndex, yesPoolFrozen, noPoolFrozen, protocolFeeBps} = input;

  if (amountUsdc <= BigInt(0)) {
    return {netPayoutUsdc: BigInt(0), grossPayoutUsdc: BigInt(0), feeUsdc: BigInt(0), multiplier: null};
  }

  const oldWinning = sideIndex === 1 ? yesPoolFrozen : noPoolFrozen;
  const oldOther = sideIndex === 1 ? noPoolFrozen : yesPoolFrozen;

  const newWinning = oldWinning + amountUsdc;
  const newTotal = newWinning + oldOther;

  // gross = userBet * totalPool / winningSide. Same math as Market.sol's
  // claimWinnings (Nox arithmetic, simplified to plaintext here).
  const grossPayoutUsdc = (amountUsdc * newTotal) / newWinning;
  const feeUsdc = (grossPayoutUsdc * protocolFeeBps) / BigInt(10_000);
  const netPayoutUsdc = grossPayoutUsdc - feeUsdc;

  const multiplier = Number(netPayoutUsdc) / Number(amountUsdc);
  return {
    netPayoutUsdc,
    grossPayoutUsdc,
    feeUsdc,
    multiplier: Number.isFinite(multiplier) ? multiplier : null,
  };
}
