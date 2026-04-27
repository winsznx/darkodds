/**
 * Error classification — turns wagmi/viem/Nox errors into the
 * `ErrorKind` taxonomy the FSM consumes.
 *
 * Used by the place-bet orchestrator to dispatch STEP_FAIL with the right
 * `errorKind` so the UI can render the appropriate next-action CTA per the
 * F9 prompt's error taxonomy:
 *
 *   user_rejected         → "Bet canceled" + reset to idle
 *   insufficient_balance  → prompt FaucetModal
 *   insufficient_eth      → prompt Chainlink faucet
 *   market_closed         → refresh + redirect link
 *   encrypt               → retry CTA + console log
 *   tx_revert / network   → surface viem error.shortMessage
 */

import {BaseError} from "viem";

import type {ErrorKind} from "./state-machine";

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
}

/**
 * Best-effort classification. Falls back to `unknown` for surprises so the
 * UI still has a message to render. Console-logs the full error for triage.
 */
export function classifyError(err: unknown): ClassifiedError {
  if (typeof window !== "undefined") {
    console.error("[bet] error:", err);
  }
  const baseMessage = err instanceof Error ? err.message : String(err);

  // viem BaseError exposes `.shortMessage` and `.name` which are the
  // cleanest signals.
  const viemErr = err instanceof BaseError ? err : null;
  const short = viemErr?.shortMessage ?? "";
  const fullStr = (short + " " + baseMessage).toLowerCase();

  // User-rejected — every wallet flavors the message slightly differently.
  if (
    fullStr.includes("user rejected") ||
    fullStr.includes("user denied") ||
    fullStr.includes("rejected the request") ||
    fullStr.includes("transaction rejected") ||
    fullStr.includes("rejected by user")
  ) {
    return {kind: "user_rejected", message: "Bet canceled — wallet popup rejected."};
  }

  // Insufficient ETH for gas — typically surfaces as "insufficient funds".
  if (fullStr.includes("insufficient funds") || fullStr.includes("insufficient gas")) {
    return {kind: "insufficient_eth", message: "Not enough Arb Sepolia ETH for gas."};
  }

  // Stale fee estimate from the wallet — Arb Sepolia base fee ticked up
  // between wallet popup and submission. Retry usually fixes it.
  if (
    fullStr.includes("max fee per gas less than block base fee") ||
    fullStr.includes("maxfeepergas") ||
    (fullStr.includes("fee cap") && fullStr.includes("base fee"))
  ) {
    return {
      kind: "network",
      message:
        "Wallet's fee estimate is stale — Arb Sepolia base fee ticked up. Click RETRY STEP to resubmit.",
    };
  }

  // Market state revert — the contract throws ClaimWindowNotOpen,
  // MarketExpired, AlreadyBetThisSide, etc. on closed/double-bet states.
  const closedSignals = [
    "marketexpired",
    "wrongstate",
    "alreadybetthisside",
    "claimwindownotopen",
    "notopen",
  ];
  if (closedSignals.some((s) => fullStr.includes(s))) {
    return {kind: "market_closed", message: short || "Market state changed; refresh to retry."};
  }

  // Nox encrypt path — catch the gateway-side timeouts/parse errors that
  // bubble up from the SDK.
  if (
    fullStr.includes("gateway") ||
    fullStr.includes("encrypt") ||
    fullStr.includes("publish") ||
    fullStr.includes("nox") ||
    fullStr.includes("handle")
  ) {
    return {kind: "encrypt", message: short || baseMessage || "Encryption gateway failed."};
  }

  // TestUSDC balance underflow during transferFrom — typically "ERC20:
  // transfer amount exceeds balance" but covered by viem's error.shortMessage.
  if (
    fullStr.includes("transfer amount exceeds") ||
    fullStr.includes("erc20") ||
    fullStr.includes("balanceof")
  ) {
    return {kind: "insufficient_balance", message: "Not enough TestUSDC. Get more from the faucet."};
  }

  // viem network errors — RPC down, chain ID mismatch, etc.
  if (
    fullStr.includes("connection") ||
    fullStr.includes("network") ||
    fullStr.includes("timeout") ||
    fullStr.includes("aborted")
  ) {
    return {kind: "network", message: short || "Network error — retry once after a moment."};
  }

  // Default: surface short message if available.
  if (viemErr) {
    return {kind: "tx_revert", message: short || viemErr.name || "Transaction reverted."};
  }
  return {kind: "unknown", message: baseMessage.slice(0, 200)};
}
