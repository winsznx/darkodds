/**
 * Error classification for the claim/refund flow — same shape as
 * `lib/bet/errors.ts` (F9) with additional revert taxonomy specific to
 * Market.claimWinnings + Market.refundIfInvalid.
 *
 * Maps wagmi/viem errors → `ClaimErrorKind` so the UI can render the right
 * next-action CTA.
 */

import {BaseError} from "viem";

import type {ClaimErrorKind} from "./state-machine";

export interface ClassifiedClaimError {
  kind: ClaimErrorKind;
  message: string;
}

export function classifyClaimError(err: unknown): ClassifiedClaimError {
  if (typeof window !== "undefined") {
    console.error("[claim] error:", err);
  }
  const baseMessage = err instanceof Error ? err.message : String(err);
  const viemErr = err instanceof BaseError ? err : null;
  const short = viemErr?.shortMessage ?? "";
  const fullStr = (short + " " + baseMessage).toLowerCase();

  if (
    fullStr.includes("user rejected") ||
    fullStr.includes("user denied") ||
    fullStr.includes("rejected the request") ||
    fullStr.includes("transaction rejected") ||
    fullStr.includes("rejected by user")
  ) {
    return {kind: "user_rejected", message: "Cancelled — wallet popup rejected."};
  }

  if (fullStr.includes("alreadyclaimed")) {
    return {kind: "already_claimed", message: "Already claimed for this market."};
  }
  if (fullStr.includes("nowinningposition")) {
    return {kind: "not_winner", message: "Your side did not win this market."};
  }
  if (fullStr.includes("claimwindownotopen")) {
    return {kind: "market_not_resolved", message: "Claim window is not open yet."};
  }
  if (fullStr.includes("notinvalid")) {
    return {kind: "market_not_invalid", message: "Market is not in invalid state."};
  }
  if (fullStr.includes("nobettorefund")) {
    return {kind: "no_bet_to_refund", message: "No bet found to refund (already refunded?)."};
  }

  if (
    fullStr.includes("max fee per gas less than block base fee") ||
    fullStr.includes("maxfeepergas") ||
    (fullStr.includes("fee cap") && fullStr.includes("base fee"))
  ) {
    return {
      kind: "network",
      message: "Wallet's fee estimate is stale — Arb Sepolia base fee ticked up. Retry to resubmit.",
    };
  }

  if (
    fullStr.includes("connection") ||
    fullStr.includes("network") ||
    fullStr.includes("timeout") ||
    fullStr.includes("aborted")
  ) {
    return {kind: "network", message: short || "Network error — retry once after a moment."};
  }

  if (viemErr) {
    return {kind: "tx_revert", message: short || viemErr.name || "Transaction reverted."};
  }
  return {kind: "unknown", message: baseMessage.slice(0, 200)};
}
