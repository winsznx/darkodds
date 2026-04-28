/**
 * Claim/refund orchestrator — drives the FSM through one tx + one decrypt.
 *
 * Single tx (claimWinnings or refundIfInvalid) followed by parsing the
 * settlement event (ClaimSettled or Refunded) for the encrypted output
 * handle, which we Nox-decrypt for the user.
 *
 * Mirrors `lib/bet/place-bet.ts` (F9) for fee-override, error handling, and
 * tx-receipt patterns.
 */

import {
  decodeEventLog,
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import type {HandleClient} from "@iexec-nox/handle";

import {marketAbi} from "@/lib/contracts/generated";
import {getArbSepoliaFeeOverrides} from "@/lib/contracts/fees";
import {safeDecrypt} from "@/lib/nox/client-hook";

import {classifyClaimError} from "./errors";
import type {ClaimAction, ClaimKind} from "./state-machine";

export interface RunClaimClients {
  walletClient: WalletClient;
  publicClient: PublicClient;
  noxClient: HandleClient;
  account: Address;
}

interface RunClaimOptions {
  kind: ClaimKind;
  marketAddress: Address;
  clients: RunClaimClients;
  onAction: (action: ClaimAction) => void;
}

/**
 * Walks a single claim or refund flow. Dispatches actions on every state
 * transition. Caller is responsible for providing initial OPEN action via
 * `dispatch({type: "OPEN", params})` BEFORE invoking — this function takes
 * over from `submitting` onwards.
 */
export async function runClaim(opts: RunClaimOptions): Promise<void> {
  const {kind, marketAddress, clients, onAction} = opts;
  const {walletClient, publicClient, noxClient, account} = clients;

  let txHash: Hex | null = null;

  try {
    const data = encodeFunctionData({
      abi: marketAbi,
      functionName: kind === "claim" ? "claimWinnings" : "refundIfInvalid",
      args: [],
    });
    const fees = await getArbSepoliaFeeOverrides(publicClient);
    txHash = await walletClient.sendTransaction({
      account,
      chain: walletClient.chain ?? null,
      to: marketAddress,
      data,
      ...fees,
    });
    onAction({type: "TX_SENT", txHash});
  } catch (err) {
    const {kind: errorKind, message} = classifyClaimError(err);
    onAction({type: "FAIL", errorKind, errorMessage: message});
    return;
  }

  // Wait for receipt + assert success.
  let settledHandle: Hex;
  try {
    const rc = await publicClient.waitForTransactionReceipt({hash: txHash});
    if (rc.status !== "success") {
      onAction({
        type: "FAIL",
        errorKind: "tx_revert",
        errorMessage: `${kind === "claim" ? "claimWinnings" : "refundIfInvalid"} reverted`,
        txHash,
      });
      return;
    }

    // Parse the settlement event for the encrypted output handle.
    const targetEvent = kind === "claim" ? "ClaimSettled" : "Refunded";
    let found: Hex | null = null;
    for (const log of rc.logs) {
      try {
        const decoded = decodeEventLog({abi: marketAbi, ...log});
        if (decoded.eventName === targetEvent) {
          if (kind === "claim" && decoded.eventName === "ClaimSettled") {
            found = (decoded.args as {payoutHandle: Hex}).payoutHandle;
          } else if (kind === "refund" && decoded.eventName === "Refunded") {
            found = (decoded.args as {refundHandle: Hex}).refundHandle;
          }
          if (found) break;
        }
      } catch {
        // not our event — skip
      }
    }

    if (!found) {
      onAction({
        type: "FAIL",
        errorKind: "tx_revert",
        errorMessage: `${targetEvent} event not found in receipt`,
        txHash,
      });
      return;
    }
    settledHandle = found;
    onAction({type: "TX_OK", settledHandle});
  } catch (err) {
    const {kind: errorKind, message} = classifyClaimError(err);
    onAction({type: "FAIL", errorKind, errorMessage: message, txHash: txHash ?? undefined});
    return;
  }

  // Decrypt the settlement handle. Soft failure: settlement on-chain is
  // already canonical, so we degrade to "amount sealed" UI.
  // Goes through `safeDecrypt` which serializes the first decrypt per
  // wallet — if portfolio rows have already populated the auth cache, this
  // call needs no extra signature.
  try {
    const out = await safeDecrypt(noxClient, settledHandle, account);
    if (typeof out.value !== "bigint") {
      onAction({type: "DECRYPT_FAIL", message: "non-bigint decrypt result"});
      return;
    }
    onAction({type: "DECRYPT_OK", amount: out.value});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onAction({type: "DECRYPT_FAIL", message});
  }
}
