/**
 * DarkOdds market shape — server-side normalized type for `/markets`.
 *
 * Mirrors the `PolymarketMarket` shape where the columns visually align so
 * the parallel-feed UI can read uniformly. DarkOdds-specific fields
 * (encrypted pool, on-chain market state machine) live here in addition.
 */

import type {Address} from "viem";

export type DarkOddsMarketId = bigint & {readonly __brand: "DarkOddsMarketId"};

/** Mirrors `IMarket.State` enum exactly. */
export const DarkOddsState = {
  Created: 0,
  Open: 1,
  Closed: 2,
  Resolving: 3,
  Resolved: 4,
  ClaimWindow: 5,
  Invalid: 6,
} as const;
export type DarkOddsStateValue = (typeof DarkOddsState)[keyof typeof DarkOddsState];

export const DarkOddsOutcome = {
  NO: 0,
  YES: 1,
  INVALID: 2,
} as const;
export type DarkOddsOutcomeValue = (typeof DarkOddsOutcome)[keyof typeof DarkOddsOutcome];

/**
 * One outcome with optional probability. Probability is `null` when the
 * market hasn't published a batch yet (Open-state, frozen pools = 0).
 */
export interface DarkOddsCardOutcome {
  label: string;
  probability: number | null;
}

export interface DarkOddsMarket {
  id: DarkOddsMarketId;
  address: Address;
  question: string;
  state: DarkOddsStateValue;
  /** Final outcome once resolved. Meaningless before that. */
  outcome: DarkOddsOutcomeValue | null;
  /** Unix seconds. */
  expiryTs: bigint;
  /** YES + NO pool plaintext if frozen, else null (still encrypted). */
  yesPoolFrozen: bigint;
  noPoolFrozen: bigint;
  /** Outcomes — typically YES/NO, but the type is general-purpose. */
  outcomes: [DarkOddsCardOutcome, DarkOddsCardOutcome];
  /**
   * Whether the market is currently betable (Open + not expired).
   * Derived field — F9 will use this to gate the bet flow.
   */
  isOpen: boolean;
  /** Convenience: whether the market is in any post-resolution terminal state. */
  isResolved: boolean;
}

export interface DarkOddsResult<T> {
  data: T;
  errors: string[];
}
