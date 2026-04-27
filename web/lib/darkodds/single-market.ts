/**
 * DarkOdds single-market detail reader — extends the F8 list reader.
 *
 * Reads everything `/markets/[id]` needs about ONE market in a single
 * multicall: question, state, expiry, frozen pools, published pool handles
 * (for client-side publicDecrypt of Open-state odds), claim window, fee bps,
 * resolution oracle wiring.
 *
 * Optional `userAddress` arg piggy-backs the user's bet handles in the same
 * round-trip — `Market.yesBet(user)` ([Market.sol:196]) and
 * `Market.noBet(user)` ([Market.sol:200]) are both `external view` returning
 * `euint256` (bytes32 wire). Non-zero ⇒ user has a bet on that side.
 *
 * Pre-flight + cooldown reads for the bet flow live in `lib/bet/preflight.ts`
 * (HALT 3) — this file is read-only display data only.
 */

import {createPublicClient, http, type Address, type Hex} from "viem";
import {arbitrumSepolia} from "viem/chains";

import {ARB_SEPOLIA_RPC_URL} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {marketAbi, marketRegistryAbi} from "@/lib/contracts/generated";

import {
  type DarkOddsCardOutcome,
  type DarkOddsMarketId,
  type DarkOddsOutcomeValue,
  DarkOddsState,
  type DarkOddsStateValue,
} from "./types";

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(ARB_SEPOLIA_RPC_URL),
});

const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface DarkOddsMarketDetail {
  id: DarkOddsMarketId;
  address: Address;
  question: string;
  state: DarkOddsStateValue;
  outcome: DarkOddsOutcomeValue | null;
  expiryTs: bigint;
  protocolFeeBps: bigint;
  yesPoolFrozen: bigint;
  noPoolFrozen: bigint;
  /** Publicly-decryptable ebigint handle. Bytes32 zero if not yet initialized. */
  yesPoolPublishedHandle: Hex;
  noPoolPublishedHandle: Hex;
  claimWindowOpensAt: bigint;
  resolutionOracle: Address;
  oracleType: number;
  outcomes: [DarkOddsCardOutcome, DarkOddsCardOutcome];
  isOpen: boolean;
  isResolved: boolean;
  /** Per-user bet handles, only populated when `userAddress` is provided. */
  userBets: {
    yes: Hex; // ZERO_BYTES32 if no bet
    no: Hex;
  } | null;
}

function deriveOutcomes(
  yesPoolFrozen: bigint,
  noPoolFrozen: bigint,
): [DarkOddsCardOutcome, DarkOddsCardOutcome] {
  const total = yesPoolFrozen + noPoolFrozen;
  if (total === BigInt(0)) {
    return [
      {label: "YES", probability: null},
      {label: "NO", probability: null},
    ];
  }
  const ppmYes = Number((yesPoolFrozen * BigInt(1_000_000)) / total) / 1_000_000;
  return [
    {label: "YES", probability: ppmYes},
    {label: "NO", probability: 1 - ppmYes},
  ];
}

/**
 * Read full detail for a single market by id. Returns null if the market
 * doesn't exist (registry returns zero address) or any of the required
 * reads fail catastrophically.
 *
 * Performs ONE wagmi multicall: registry.markets(id) → marketAddress, then
 * a wave-2 multicall reading all market state (incl. user bet handles if
 * userAddress was supplied).
 */
export async function getDarkOddsMarketDetail(
  id: bigint,
  userAddress?: Address,
): Promise<DarkOddsMarketDetail | null> {
  // Wave 1 — resolve market address from registry.
  let marketAddress: Address;
  try {
    const addr = (await publicClient.readContract({
      address: addresses.MarketRegistry,
      abi: marketRegistryAbi,
      functionName: "markets",
      args: [id],
    })) as Address;
    if (!addr || addr === "0x0000000000000000000000000000000000000000") return null;
    marketAddress = addr;
  } catch {
    return null;
  }

  // Wave 2 — batched per-market reads. 13 calls in the worst case (11
  // market fields + 2 user bet handles).
  type Call = {
    address: Address;
    abi: typeof marketAbi;
    functionName:
      | "state"
      | "question"
      | "outcome"
      | "expiryTs"
      | "yesPoolFrozen"
      | "noPoolFrozen"
      | "yesPoolPublishedHandle"
      | "noPoolPublishedHandle"
      | "claimWindowOpensAt"
      | "protocolFeeBps"
      | "resolutionOracle"
      | "oracleType"
      | "yesBet"
      | "noBet";
    args?: readonly [Address];
  };

  const baseCalls: Call[] = [
    {address: marketAddress, abi: marketAbi, functionName: "state"},
    {address: marketAddress, abi: marketAbi, functionName: "question"},
    {address: marketAddress, abi: marketAbi, functionName: "outcome"},
    {address: marketAddress, abi: marketAbi, functionName: "expiryTs"},
    {address: marketAddress, abi: marketAbi, functionName: "yesPoolFrozen"},
    {address: marketAddress, abi: marketAbi, functionName: "noPoolFrozen"},
    {address: marketAddress, abi: marketAbi, functionName: "yesPoolPublishedHandle"},
    {address: marketAddress, abi: marketAbi, functionName: "noPoolPublishedHandle"},
    {address: marketAddress, abi: marketAbi, functionName: "claimWindowOpensAt"},
    {address: marketAddress, abi: marketAbi, functionName: "protocolFeeBps"},
    {address: marketAddress, abi: marketAbi, functionName: "resolutionOracle"},
    {address: marketAddress, abi: marketAbi, functionName: "oracleType"},
  ];
  if (userAddress) {
    baseCalls.push(
      {address: marketAddress, abi: marketAbi, functionName: "yesBet", args: [userAddress] as const},
      {address: marketAddress, abi: marketAbi, functionName: "noBet", args: [userAddress] as const},
    );
  }

  let results: ReadonlyArray<{status: "success"; result: unknown} | {status: "failure"; error: Error}>;
  try {
    results = await publicClient.multicall({
      contracts: baseCalls,
      allowFailure: true,
    });
  } catch {
    return null;
  }

  for (const r of results.slice(0, 12)) {
    if (r.status !== "success") return null;
  }

  const state = Number(results[0]!.status === "success" ? (results[0]!.result as number) : 0);
  const stateValue: DarkOddsStateValue =
    state >= 0 && state <= 6 ? (state as DarkOddsStateValue) : DarkOddsState.Created;
  const question = String(
    (results[1]!.status === "success" ? results[1]!.result : `Market ${id}`) || `Market ${id}`,
  );
  const outcome = Number(results[2]!.status === "success" ? results[2]!.result : 0) as DarkOddsOutcomeValue;
  const expiryTs = (results[3]!.status === "success" ? results[3]!.result : BigInt(0)) as bigint;
  const yesPoolFrozen = (results[4]!.status === "success" ? results[4]!.result : BigInt(0)) as bigint;
  const noPoolFrozen = (results[5]!.status === "success" ? results[5]!.result : BigInt(0)) as bigint;
  const yesPoolPublishedHandle = (
    results[6]!.status === "success" ? results[6]!.result : ZERO_BYTES32
  ) as Hex;
  const noPoolPublishedHandle = (results[7]!.status === "success" ? results[7]!.result : ZERO_BYTES32) as Hex;
  const claimWindowOpensAt = (results[8]!.status === "success" ? results[8]!.result : BigInt(0)) as bigint;
  const protocolFeeBps = (results[9]!.status === "success" ? results[9]!.result : BigInt(0)) as bigint;
  const resolutionOracle = (
    results[10]!.status === "success" ? results[10]!.result : addresses.ResolutionOracle
  ) as Address;
  const oracleType = Number(results[11]!.status === "success" ? results[11]!.result : 0);

  let userBets: DarkOddsMarketDetail["userBets"] = null;
  if (userAddress && results.length >= 14) {
    const yesBet = results[12];
    const noBet = results[13];
    userBets = {
      yes: (yesBet?.status === "success" ? (yesBet.result as Hex) : ZERO_BYTES32) as Hex,
      no: (noBet?.status === "success" ? (noBet.result as Hex) : ZERO_BYTES32) as Hex,
    };
  }

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const isOpen = stateValue === DarkOddsState.Open && nowSec < expiryTs;
  const isResolved =
    stateValue === DarkOddsState.Resolved ||
    stateValue === DarkOddsState.ClaimWindow ||
    stateValue === DarkOddsState.Invalid;

  return {
    id: id as DarkOddsMarketId,
    address: marketAddress,
    question,
    state: stateValue,
    outcome: isResolved ? outcome : null,
    expiryTs,
    protocolFeeBps,
    yesPoolFrozen,
    noPoolFrozen,
    yesPoolPublishedHandle,
    noPoolPublishedHandle,
    claimWindowOpensAt,
    resolutionOracle,
    oracleType,
    outcomes: deriveOutcomes(yesPoolFrozen, noPoolFrozen),
    isOpen,
    isResolved,
    userBets,
  };
}

export {ZERO_BYTES32};
