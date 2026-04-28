/**
 * Place-bet orchestrator — drives the FSM through 5 real on-chain steps.
 *
 * Mirrors the canonical sequence verified in `tools/verify-backend.ts` so
 * the UI flow matches the F5 backend exactly:
 *
 *   1. APPROVE_TUSDC  — TestUSDC.approve(cUSDC, amount | uint256.max)
 *   2. WRAP_CUSDC     — encryptInput(amount, "uint256", cUSDC) → cUSDC.wrap(...)
 *   3. ENCRYPT_BET    — encryptInput(amount, "uint256", marketAddress) — off-chain
 *   4. SETOPERATOR    — cUSDC.setOperator(market, until)
 *   5. PLACE_BET      — Market.placeBet(side, betHandle, betProof)
 *
 * Stops on first failure. The FSM moves to `error` phase; the UI surfaces
 * RETRY (re-runs the failed step from current state) or START OVER.
 */

import {
  encodeFunctionData,
  maxUint256,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import type {HandleClient} from "@iexec-nox/handle";

import {addresses} from "@/lib/contracts/addresses";
import {confidentialUsdcAbi, marketAbi, testUsdcAbi} from "@/lib/contracts/generated";
import {getArbSepoliaFeeOverrides} from "@/lib/contracts/fees";

import {classifyError} from "./errors";
import {persistState, STEPS, type BetAction, type BetState, type StepId} from "./state-machine";

export interface PlaceBetClients {
  walletClient: WalletClient;
  publicClient: PublicClient;
  noxClient: HandleClient;
  account: Address;
}

interface RunOptions {
  onAction: (action: BetAction) => void;
  /** Snapshot of the current state when the orchestrator starts. The reducer
   *  is the source of truth; this snapshot lets us read step skip-flags and
   *  `betHandle` without round-tripping through React state. */
  initialState: Extract<BetState, {phase: "processing"}>;
  clients: PlaceBetClients;
}

/**
 * One-shot orchestrator. Walks STEPS in order, dispatching STEP_START /
 * STEP_OK / STEP_FAIL as it goes. Returns when the FSM lands in either
 * `success` or `error`.
 *
 * Caller is responsible for constructing the initial `processing` state via
 * dispatch({type: "CONFIRM"}) before invoking. This function does NOT call
 * dispatch({type: "OPEN" | "CONFIRM"}) — it expects to take over from
 * processing onwards.
 */
export async function runPlaceBet({onAction, initialState, clients}: RunOptions): Promise<void> {
  const {walletClient, publicClient, noxClient, account} = clients;
  const {params, preflight, steps: initialSteps} = initialState;

  // Track the running state ourselves — we only read step skip-flags
  // and our own betHandle/betProof; the reducer-side state is updated via
  // dispatched actions.
  let betHandle: Hex | null = null;
  let betProof: Hex | null = null;
  let lastPlaceBetTx: Hex | null = null;

  // Helper: wait for tx receipt + assert success.
  const waitOk = async (hash: Hex, label: string): Promise<void> => {
    const rc = await publicClient.waitForTransactionReceipt({hash});
    if (rc.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  };

  for (const step of STEPS) {
    if (initialSteps[step].status === "skipped") continue;
    onAction({type: "STEP_START", step});

    try {
      const txHash = await runStep(step, {
        params,
        preflight,
        clients,
        betHandle,
        betProof,
        setBetHandleProof: (h, p) => {
          betHandle = h;
          betProof = p;
          onAction({type: "ENCRYPT_RESULT", betHandle: h, betProof: p});
        },
        setLastPlaceBetTx: (h) => {
          lastPlaceBetTx = h;
        },
        waitOk,
        account,
        walletClient,
        noxClient,
      });
      onAction({type: "STEP_OK", step, txHash: txHash ?? undefined});
    } catch (err) {
      const {kind, message} = classifyError(err);
      onAction({type: "STEP_FAIL", step, errorKind: kind, errorMessage: message});
      return;
    }
  }

  // All steps OK → emit final PLACEBET_TX which transitions FSM to success.
  if (lastPlaceBetTx) {
    onAction({type: "PLACEBET_TX", txHash: lastPlaceBetTx});
  } else {
    onAction({
      type: "STEP_FAIL",
      step: "PLACE_BET",
      errorKind: "unknown",
      errorMessage: "Bet placed but no tx hash captured",
    });
  }
}

interface StepCtx {
  params: Extract<BetState, {phase: "processing"}>["params"];
  preflight: Extract<BetState, {phase: "processing"}>["preflight"];
  clients: PlaceBetClients;
  betHandle: Hex | null;
  betProof: Hex | null;
  setBetHandleProof: (h: Hex, p: Hex) => void;
  setLastPlaceBetTx: (h: Hex) => void;
  waitOk: (hash: Hex, label: string) => Promise<void>;
  account: Address;
  walletClient: WalletClient;
  noxClient: HandleClient;
}

async function runStep(step: StepId, ctx: StepCtx): Promise<Hex | null> {
  switch (step) {
    case "APPROVE_TUSDC":
      return runApprove(ctx);
    case "WRAP_CUSDC":
      return runWrap(ctx);
    case "ENCRYPT_BET":
      return runEncryptBet(ctx);
    case "SETOPERATOR":
      return runSetOperator(ctx);
    case "PLACE_BET":
      return runPlaceBetTx(ctx);
    default: {
      const _exhaustive: never = step;
      void _exhaustive;
      throw new Error(`Unknown step: ${String(step)}`);
    }
  }
}

// Fee overrides moved to lib/contracts/fees.ts (getArbSepoliaFeeOverrides).
// Same 5× basefee buffer + 0.01 gwei priority as before. Imported above.

// ────────────────────────────────────────────────────────────────────────────
// Step implementations
// ────────────────────────────────────────────────────────────────────────────

async function runApprove(ctx: StepCtx): Promise<Hex> {
  const {params, preflight, walletClient, clients, account, waitOk} = ctx;
  const amount = preflight.useInfiniteAllowance ? maxUint256 : params.amountUsdc;
  const data = encodeFunctionData({
    abi: testUsdcAbi,
    functionName: "approve",
    args: [addresses.ConfidentialUSDC, amount],
  });
  const fees = await getArbSepoliaFeeOverrides(clients.publicClient);
  const hash = await walletClient.sendTransaction({
    account,
    chain: walletClient.chain ?? null,
    to: addresses.TestUSDC,
    data,
    ...fees,
  });
  await waitOk(hash, "approve");
  return hash;
}

async function runWrap(ctx: StepCtx): Promise<Hex> {
  const {params, walletClient, clients, noxClient, account, waitOk} = ctx;
  // wrap requires its own encrypted handle; applicationContract = cUSDC
  const {handle, handleProof} = await noxClient.encryptInput(
    params.amountUsdc,
    "uint256",
    addresses.ConfidentialUSDC,
  );
  const data = encodeFunctionData({
    abi: confidentialUsdcAbi,
    functionName: "wrap",
    args: [params.amountUsdc, handle as Hex, handleProof as Hex],
  });
  const fees = await getArbSepoliaFeeOverrides(clients.publicClient);
  const hash = await walletClient.sendTransaction({
    account,
    chain: walletClient.chain ?? null,
    to: addresses.ConfidentialUSDC,
    data,
    ...fees,
  });
  await waitOk(hash, "wrap");
  return hash;
}

async function runEncryptBet(ctx: StepCtx): Promise<null> {
  const {params, noxClient, setBetHandleProof} = ctx;
  // applicationContract = the market (so Market can use the handle)
  const {handle, handleProof} = await noxClient.encryptInput(
    params.amountUsdc,
    "uint256",
    params.marketAddress,
  );
  setBetHandleProof(handle as Hex, handleProof as Hex);
  return null; // off-chain step, no tx hash
}

async function runSetOperator(ctx: StepCtx): Promise<Hex> {
  const {params, walletClient, clients, account, waitOk} = ctx;
  // until = current expiry + 1 day (gives the operator a lifetime past the
  // market's resolution so they can still interact post-expiry if needed)
  const nowSec = Math.floor(Date.now() / 1000);
  const oneYearOut = BigInt(nowSec + 365 * 24 * 60 * 60);
  const data = encodeFunctionData({
    abi: confidentialUsdcAbi,
    functionName: "setOperator",
    args: [params.marketAddress, Number(oneYearOut)],
  });
  const fees = await getArbSepoliaFeeOverrides(clients.publicClient);
  const hash = await walletClient.sendTransaction({
    account,
    chain: walletClient.chain ?? null,
    to: addresses.ConfidentialUSDC,
    data,
    ...fees,
  });
  await waitOk(hash, "setOperator");
  return hash;
}

async function runPlaceBetTx(ctx: StepCtx): Promise<Hex> {
  const {params, walletClient, clients, account, betHandle, betProof, waitOk, setLastPlaceBetTx} = ctx;
  if (!betHandle || !betProof) throw new Error("encrypt step did not produce handle/proof");

  const data = encodeFunctionData({
    abi: marketAbi,
    functionName: "placeBet",
    args: [params.sideIndex, betHandle, betProof],
  });
  const fees = await getArbSepoliaFeeOverrides(clients.publicClient);
  const hash = await walletClient.sendTransaction({
    account,
    chain: walletClient.chain ?? null,
    to: params.marketAddress,
    data,
    ...fees,
  });
  await waitOk(hash, "placeBet");
  setLastPlaceBetTx(hash);
  return hash;
}

// ────────────────────────────────────────────────────────────────────────────
// Convenience: persist FSM state to sessionStorage on every step transition
// so a mid-flow refresh can resume. Caller wires this up via dispatch
// middleware or a useEffect on state changes.
// ────────────────────────────────────────────────────────────────────────────

export function persistOnStateChange(state: BetState): void {
  persistState(state);
}
