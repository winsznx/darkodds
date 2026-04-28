/**
 * Claim/refund flow finite state machine — hand-rolled discriminated unions.
 *
 * Same pattern as `lib/bet/state-machine.ts` (F9), but simpler: a single tx
 * (claimWinnings or refundIfInvalid) followed by a Nox decrypt of the
 * settled amount handle. No multi-step orchestration, no preflight.
 *
 * Flow phases:
 *   idle → submitting → confirming → decrypting → success | error
 *
 *   submitting   wallet popup awaiting signature
 *   confirming   tx broadcast, awaiting receipt
 *   decrypting   receipt OK, calling Nox.decrypt(settledHandle)
 *   success      decrypted plaintext amount in hand
 *   error        any of the above failed (with errorKind taxonomy)
 */

import type {Address, Hex} from "viem";

export type ClaimKind = "claim" | "refund";

export type ClaimErrorKind =
  | "user_rejected"
  | "tx_revert"
  | "network"
  | "decrypt"
  | "already_claimed"
  | "not_winner"
  | "market_not_resolved"
  | "market_not_invalid"
  | "no_bet_to_refund"
  | "unknown";

export interface ClaimParams {
  kind: ClaimKind;
  marketId: bigint;
  marketAddress: Address;
  /** Side the user is claiming/refunding — used purely for UI labelling. */
  side: "YES" | "NO";
}

export type ClaimState =
  | {phase: "idle"}
  | {phase: "submitting"; params: ClaimParams}
  | {phase: "confirming"; params: ClaimParams; txHash: Hex}
  | {phase: "decrypting"; params: ClaimParams; txHash: Hex; settledHandle: Hex}
  | {
      phase: "success";
      params: ClaimParams;
      txHash: Hex;
      settledHandle: Hex;
      /** Plaintext amount, base-6 cUSDC. Null when decrypt soft-failed. */
      amount: bigint | null;
    }
  | {
      phase: "error";
      params: ClaimParams;
      txHash: Hex | null;
      errorKind: ClaimErrorKind;
      errorMessage: string;
    };

export type ClaimAction =
  | {type: "OPEN"; params: ClaimParams}
  | {type: "TX_SENT"; txHash: Hex}
  | {type: "TX_OK"; settledHandle: Hex}
  | {type: "DECRYPT_OK"; amount: bigint}
  | {type: "DECRYPT_FAIL"; message: string}
  | {type: "FAIL"; errorKind: ClaimErrorKind; errorMessage: string; txHash?: Hex}
  | {type: "RESET"}
  | {type: "CLOSE"};

export const initialClaimState: ClaimState = {phase: "idle"};

export function reduceClaim(state: ClaimState, action: ClaimAction): ClaimState {
  switch (action.type) {
    case "OPEN":
      return {phase: "submitting", params: action.params};

    case "TX_SENT":
      if (state.phase !== "submitting") return state;
      return {phase: "confirming", params: state.params, txHash: action.txHash};

    case "TX_OK":
      if (state.phase !== "confirming") return state;
      return {
        phase: "decrypting",
        params: state.params,
        txHash: state.txHash,
        settledHandle: action.settledHandle,
      };

    case "DECRYPT_OK":
      if (state.phase !== "decrypting") return state;
      return {
        phase: "success",
        params: state.params,
        txHash: state.txHash,
        settledHandle: state.settledHandle,
        amount: action.amount,
      };

    case "DECRYPT_FAIL":
      if (state.phase !== "decrypting") return state;
      // Soft failure — the on-chain settlement succeeded; only the off-chain
      // decrypt round-trip failed. Surface as success with amount=null so
      // the UI can show "claimed — amount sealed".
      return {
        phase: "success",
        params: state.params,
        txHash: state.txHash,
        settledHandle: state.settledHandle,
        amount: null,
      };

    case "FAIL": {
      if (state.phase === "idle" || state.phase === "success") return state;
      const txHash = action.txHash ?? ("txHash" in state ? state.txHash : null);
      const params = "params" in state ? state.params : null;
      if (!params) return state;
      return {
        phase: "error",
        params,
        txHash,
        errorKind: action.errorKind,
        errorMessage: action.errorMessage,
      };
    }

    case "RESET":
    case "CLOSE":
      return {phase: "idle"};

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
