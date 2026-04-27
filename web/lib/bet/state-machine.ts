/**
 * Bet flow finite state machine — hand-rolled discriminated unions, no XState.
 *
 * The state space is small enough (~12 states) that XState is overkill and the
 * discriminated-union pattern is cleaner for code review. Each state carries
 * exactly the data it needs; the reducer is exhaustive against the action
 * union — TypeScript will flag any missing cases.
 *
 * Persistence: the reducer can serialize state to JSON for sessionStorage so
 * a mid-flow refresh recovers. Hash + key + step ids only — never the bet
 * handle proof itself (the proof is bound to the user's signature and is
 * regenerated if needed).
 *
 * Design notes
 * ────────────
 * - HALT 2 ships the FSM + the shell. HALT 3 wires the orchestrator
 *   (`lib/bet/place-bet.ts`) which dispatches actions on the FSM. The
 *   orchestrator is the only thing that knows about wagmi/Nox; the FSM
 *   itself is dependency-free.
 * - We model only the steps that have side effects. Pre-flight is a separate
 *   sub-state-machine (REVIEW screen reads the result and renders skip-flags
 *   inline).
 * - "skip flags" let the orchestrator mark steps complete from the start
 *   without running them. Steps the user already satisfied (allowance OK,
 *   already wrapped, already setOperator) get drawn as ✓ done from REVIEW.
 */

import type {Address, Hex} from "viem";

// ────────────────────────────────────────────────────────────────────────────
// Step ids — used by the progress UI to render labels in order
// ────────────────────────────────────────────────────────────────────────────

export const STEPS = ["APPROVE_TUSDC", "WRAP_CUSDC", "ENCRYPT_BET", "SETOPERATOR", "PLACE_BET"] as const;
export type StepId = (typeof STEPS)[number];

export const STEP_LABEL: Record<StepId, string> = {
  APPROVE_TUSDC: "APPROVE TESTUSDC",
  WRAP_CUSDC: "WRAP TO CONFIDENTIAL USDC",
  ENCRYPT_BET: "ENCRYPT BET AMOUNT",
  SETOPERATOR: "AUTHORIZE MARKET",
  PLACE_BET: "PLACE BET",
};

// ────────────────────────────────────────────────────────────────────────────
// Pre-flight result — populated by the orchestrator before REVIEW. Used to
// decide which steps to skip from the start.
// ────────────────────────────────────────────────────────────────────────────

export interface BetPreflight {
  /** User's TestUSDC plaintext balance — must be >= amount or we surface
   *  "Get from faucet" CTA before letting them confirm. */
  tusdcBalance: bigint;
  /** Skip APPROVE_TUSDC if true. */
  approveSkippable: boolean;
  /** Skip WRAP_CUSDC if user already has enough cUSDC for this bet. We
   *  cannot directly measure cUSDC plaintext balance (it's encrypted), but
   *  if the user has previously wrapped exactly amount or more in this
   *  session we can assume true. Default false → wrap step always runs.
   *  Future: track cumulative-wrapped-amount in storage. */
  wrapSkippable: boolean;
  /** Skip SETOPERATOR if `cUSDC.isOperator(user, market)` returned true. */
  setOperatorSkippable: boolean;
  /** Approve TestUSDC infinitely (uint256 max) so subsequent bets skip
   *  step 1 entirely. Default true; user can opt out via "USE EXACT AMOUNT"
   *  in REVIEW. */
  useInfiniteAllowance: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Step state — each step starts as IDLE, becomes ACTIVE when the orchestrator
// kicks it off, transitions to OK / FAILED. Skipped steps go straight to OK.
// ────────────────────────────────────────────────────────────────────────────

export type StepState =
  | {status: "idle"}
  | {status: "skipped"; reason: string}
  | {status: "active"; startedAt: number}
  | {status: "ok"; startedAt: number; endedAt: number; txHash?: Hex}
  | {status: "failed"; startedAt: number; endedAt: number; errorKind: ErrorKind; errorMessage: string};

export type ErrorKind =
  | "user_rejected"
  | "tx_revert"
  | "network"
  | "encrypt"
  | "insufficient_balance"
  | "insufficient_eth"
  | "market_closed"
  | "unknown";

// ────────────────────────────────────────────────────────────────────────────
// State — discriminated union by `phase`
// ────────────────────────────────────────────────────────────────────────────

export interface BetParams {
  marketAddress: Address;
  marketId: bigint;
  /** 0 = NO, 1 = YES */
  sideIndex: 0 | 1;
  /** 6-decimal base units. */
  amountUsdc: bigint;
}

export type BetState =
  | {phase: "idle"}
  | {phase: "preflight"; params: BetParams}
  | {phase: "review"; params: BetParams; preflight: BetPreflight}
  | {
      phase: "processing";
      params: BetParams;
      preflight: BetPreflight;
      steps: Record<StepId, StepState>;
      currentStep: StepId;
      betHandle: Hex | null;
      betProof: Hex | null;
    }
  | {
      phase: "success";
      params: BetParams;
      steps: Record<StepId, StepState>;
      placeBetTx: Hex;
    }
  | {
      phase: "error";
      params: BetParams;
      steps: Record<StepId, StepState>;
      currentStep: StepId;
      errorKind: ErrorKind;
      errorMessage: string;
    };

// ────────────────────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────────────────────

export type BetAction =
  | {type: "OPEN"; params: BetParams}
  | {type: "PREFLIGHT_OK"; preflight: BetPreflight}
  | {type: "PREFLIGHT_FAIL"; errorKind: ErrorKind; errorMessage: string}
  | {type: "TOGGLE_INFINITE_ALLOWANCE"}
  | {type: "CONFIRM"}
  | {type: "STEP_START"; step: StepId}
  | {type: "STEP_OK"; step: StepId; txHash?: Hex}
  | {type: "STEP_SKIP"; step: StepId; reason: string}
  | {type: "STEP_FAIL"; step: StepId; errorKind: ErrorKind; errorMessage: string}
  | {type: "ENCRYPT_RESULT"; betHandle: Hex; betProof: Hex}
  | {type: "PLACEBET_TX"; txHash: Hex}
  | {type: "RETRY"}
  | {type: "RESET"}
  | {type: "CLOSE"};

// ────────────────────────────────────────────────────────────────────────────
// Reducer — exhaustive against (state.phase × action.type). TypeScript will
// flag any missing transitions.
// ────────────────────────────────────────────────────────────────────────────

export const initialState: BetState = {phase: "idle"};

function emptySteps(skip: BetPreflight): Record<StepId, StepState> {
  const ts = Date.now();
  return {
    APPROVE_TUSDC: skip.approveSkippable
      ? {status: "skipped", reason: "Allowance ≥ amount"}
      : {status: "idle"},
    WRAP_CUSDC: skip.wrapSkippable ? {status: "skipped", reason: "cUSDC balance ≥ amount"} : {status: "idle"},
    ENCRYPT_BET: {status: "idle"},
    SETOPERATOR: skip.setOperatorSkippable
      ? {status: "skipped", reason: "Operator authorized"}
      : {status: "idle"},
    PLACE_BET: {status: "idle"},
  } satisfies Record<StepId, StepState> & {[k: string]: StepState | {ts?: number}};
  // `ts` retained as a closure value for tooling; not assigned above.
  void ts;
}

function firstUnskippedStep(steps: Record<StepId, StepState>): StepId {
  for (const s of STEPS) {
    if (steps[s].status !== "skipped") return s;
  }
  return "PLACE_BET"; // unreachable in practice — PLACE_BET is never skippable
}

export function reduce(state: BetState, action: BetAction): BetState {
  switch (action.type) {
    case "OPEN":
      return {phase: "preflight", params: action.params};

    case "PREFLIGHT_OK":
      if (state.phase !== "preflight") return state;
      return {phase: "review", params: state.params, preflight: action.preflight};

    case "PREFLIGHT_FAIL":
      if (state.phase !== "preflight") return state;
      return {
        phase: "error",
        params: state.params,
        steps: {} as Record<StepId, StepState>,
        currentStep: "APPROVE_TUSDC",
        errorKind: action.errorKind,
        errorMessage: action.errorMessage,
      };

    case "TOGGLE_INFINITE_ALLOWANCE":
      if (state.phase !== "review") return state;
      return {
        ...state,
        preflight: {...state.preflight, useInfiniteAllowance: !state.preflight.useInfiniteAllowance},
      };

    case "CONFIRM": {
      if (state.phase !== "review") return state;
      const steps = emptySteps(state.preflight);
      return {
        phase: "processing",
        params: state.params,
        preflight: state.preflight,
        steps,
        currentStep: firstUnskippedStep(steps),
        betHandle: null,
        betProof: null,
      };
    }

    case "STEP_START": {
      if (state.phase !== "processing") return state;
      return {
        ...state,
        currentStep: action.step,
        steps: {...state.steps, [action.step]: {status: "active", startedAt: Date.now()}},
      };
    }

    case "STEP_OK": {
      if (state.phase !== "processing") return state;
      const prev = state.steps[action.step];
      const startedAt = prev.status === "active" ? prev.startedAt : Date.now();
      return {
        ...state,
        steps: {
          ...state.steps,
          [action.step]: {status: "ok", startedAt, endedAt: Date.now(), txHash: action.txHash},
        },
      };
    }

    case "STEP_SKIP": {
      if (state.phase !== "processing") return state;
      return {
        ...state,
        steps: {...state.steps, [action.step]: {status: "skipped", reason: action.reason}},
      };
    }

    case "STEP_FAIL": {
      if (state.phase !== "processing") return state;
      const prev = state.steps[action.step];
      const startedAt = prev.status === "active" ? prev.startedAt : Date.now();
      return {
        phase: "error",
        params: state.params,
        steps: {
          ...state.steps,
          [action.step]: {
            status: "failed",
            startedAt,
            endedAt: Date.now(),
            errorKind: action.errorKind,
            errorMessage: action.errorMessage,
          },
        },
        currentStep: action.step,
        errorKind: action.errorKind,
        errorMessage: action.errorMessage,
      };
    }

    case "ENCRYPT_RESULT":
      if (state.phase !== "processing") return state;
      return {...state, betHandle: action.betHandle, betProof: action.betProof};

    case "PLACEBET_TX":
      if (state.phase !== "processing") return state;
      return {
        phase: "success",
        params: state.params,
        steps: state.steps,
        placeBetTx: action.txHash,
      };

    case "RETRY": {
      if (state.phase !== "error") return state;
      // Retry from the failed step. The orchestrator decides what's
      // re-runnable: APPROVE/WRAP/ENCRYPT/SETOPERATOR are idempotent; if
      // we failed mid-PLACE_BET with AlreadyBetThisSide, RETRY is bogus —
      // the UI should already have surfaced "view your position" in that
      // specific case via errorKind classification.
      const restoredSteps: Record<StepId, StepState> = {...state.steps};
      restoredSteps[state.currentStep] = {status: "idle"};
      return {
        phase: "processing",
        params: state.params,
        preflight: {
          tusdcBalance: BigInt(0),
          approveSkippable: false,
          wrapSkippable: false,
          setOperatorSkippable: false,
          useInfiniteAllowance: true,
        },
        steps: restoredSteps,
        currentStep: state.currentStep,
        betHandle: null,
        betProof: null,
      };
    }

    case "RESET":
    case "CLOSE":
      return {phase: "idle"};

    default: {
      // Exhaustiveness check.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Persistence — sessionStorage
// ────────────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "darkodds.bet-flow:";

interface PersistedState {
  marketIdStr: string;
  amountUsdcStr: string;
  sideIndex: 0 | 1;
  currentStep: StepId;
  /** Tx hashes from completed steps (so a refresh shows what's already on-chain). */
  txHashes: Partial<Record<StepId, Hex>>;
  startedAt: number;
}

export function persistKey(marketId: bigint): string {
  return STORAGE_PREFIX + marketId.toString();
}

export function persistState(state: BetState): void {
  if (typeof window === "undefined") return;
  if (state.phase !== "processing") return;
  const txHashes: Partial<Record<StepId, Hex>> = {};
  for (const s of STEPS) {
    const step = state.steps[s];
    if (step.status === "ok" && step.txHash) txHashes[s] = step.txHash;
  }
  const payload: PersistedState = {
    marketIdStr: state.params.marketId.toString(),
    amountUsdcStr: state.params.amountUsdc.toString(),
    sideIndex: state.params.sideIndex,
    currentStep: state.currentStep,
    txHashes,
    startedAt: Date.now(),
  };
  window.sessionStorage.setItem(persistKey(state.params.marketId), JSON.stringify(payload));
}

export function clearPersistedState(marketId: bigint): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(persistKey(marketId));
}

export function readPersistedState(marketId: bigint): PersistedState | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(persistKey(marketId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}
