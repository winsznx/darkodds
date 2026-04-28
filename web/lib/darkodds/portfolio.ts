/**
 * DarkOdds portfolio reader — finds every market where the connected user
 * has a non-zero bet handle, in a single batched multicall.
 *
 * Pattern mirrors `getDarkOddsMarkets` (F8): wave-1 reads market addresses
 * from the registry, wave-2 batches all per-market reads we need to render
 * a portfolio row (state, question, outcome, frozen pools, fee bps, the
 * user's two bet handles, claimWindowOpensAt, hasClaimed flag).
 *
 * Filters to ONLY markets where the user has a bet (yesBet OR noBet
 * non-zero). Empty returns an empty list — the page renders the empty
 * state.
 *
 * Bet sizes stay encrypted (handles only) — the page-side `<PositionRow>`
 * decrypts via `useNoxClient()` after hydration, mirroring `UserPositions`
 * from the F9 detail page.
 */

import {createPublicClient, http, type Address, type Hex} from "viem";
import {arbitrumSepolia} from "viem/chains";

import {ARB_SEPOLIA_RPC_URL} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {marketAbi, marketRegistryAbi} from "@/lib/contracts/generated";

import {
  type DarkOddsMarketId,
  type DarkOddsOutcomeValue,
  DarkOddsState,
  type DarkOddsStateValue,
} from "./types";

const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(ARB_SEPOLIA_RPC_URL),
});

const MAX_MARKETS = 50;

/** A single position the connected user holds in a DarkOdds market. */
export interface PortfolioPosition {
  marketId: DarkOddsMarketId;
  marketAddress: Address;
  question: string;
  state: DarkOddsStateValue;
  /** Resolved outcome (YES=1 / NO=0) when state ∈ {Resolved, ClaimWindow}; null otherwise. */
  outcome: DarkOddsOutcomeValue | null;
  /** Side the user bet on. If both are non-zero we render two rows. */
  side: "YES" | "NO";
  /** Encrypted bet handle (decrypted client-side). */
  betHandle: Hex;
  /** Frozen-pool data needed to compute estimated payout once decrypted. */
  yesPoolFrozen: bigint;
  noPoolFrozen: bigint;
  protocolFeeBps: bigint;
  expiryTs: bigint;
  claimWindowOpensAt: bigint;
  hasClaimed: boolean;
  /** Convenience flags for the UI. */
  isWinner: boolean;
  /** True ⇔ state == ClaimWindow AND user's side == winning outcome AND !hasClaimed. */
  canClaim: boolean;
  /** True ⇔ state == Invalid AND !hasClaimed (each call refunds one side). */
  canRefund: boolean;
}

export interface PortfolioResult {
  positions: PortfolioPosition[];
  errors: string[];
}

function deriveState(state: number): DarkOddsStateValue {
  if (state >= 0 && state <= 6) return state as DarkOddsStateValue;
  return DarkOddsState.Created;
}

/**
 * Read every position the connected user holds. Server-callable (used in a
 * server component or via fetch from a client component).
 */
export async function getPortfolio(userAddress: Address): Promise<PortfolioResult> {
  const errors: string[] = [];

  // Wave 0: registry market count.
  let nextId: bigint;
  try {
    nextId = (await publicClient.readContract({
      address: addresses.MarketRegistry,
      abi: marketRegistryAbi,
      functionName: "nextMarketId",
    })) as bigint;
  } catch (err) {
    return {
      positions: [],
      errors: [`MarketRegistry.nextMarketId failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const totalMarkets = Number(nextId - BigInt(1));
  if (totalMarkets <= 0) return {positions: [], errors};

  const start = Math.max(1, totalMarkets - MAX_MARKETS + 1);
  const ids: bigint[] = [];
  for (let i = totalMarkets; i >= start; i--) ids.push(BigInt(i));

  // Wave 1: market addresses.
  let addressResults: Array<{status: "success"; result: Address} | {status: "failure"; error: Error}>;
  try {
    addressResults = await publicClient.multicall({
      contracts: ids.map((id) => ({
        address: addresses.MarketRegistry,
        abi: marketRegistryAbi,
        functionName: "markets" as const,
        args: [id] as const,
      })),
      allowFailure: true,
    });
  } catch (err) {
    return {
      positions: [],
      errors: [`Wave 1 multicall failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const resolved: {id: bigint; address: Address}[] = [];
  addressResults.forEach((r, i) => {
    if (r.status === "success" && r.result && r.result !== "0x0000000000000000000000000000000000000000") {
      resolved.push({id: ids[i], address: r.result});
    }
  });

  if (resolved.length === 0) return {positions: [], errors};

  // Wave 2: per-market batched reads. 11 calls per market.
  const STRIDE = 11;
  const calls = resolved.flatMap(({address}) => [
    {address, abi: marketAbi, functionName: "state" as const},
    {address, abi: marketAbi, functionName: "question" as const},
    {address, abi: marketAbi, functionName: "outcome" as const},
    {address, abi: marketAbi, functionName: "expiryTs" as const},
    {address, abi: marketAbi, functionName: "yesPoolFrozen" as const},
    {address, abi: marketAbi, functionName: "noPoolFrozen" as const},
    {address, abi: marketAbi, functionName: "protocolFeeBps" as const},
    {address, abi: marketAbi, functionName: "claimWindowOpensAt" as const},
    {
      address,
      abi: marketAbi,
      functionName: "yesBet" as const,
      args: [userAddress] as const,
    },
    {
      address,
      abi: marketAbi,
      functionName: "noBet" as const,
      args: [userAddress] as const,
    },
    {
      address,
      abi: marketAbi,
      functionName: "hasClaimed" as const,
      args: [userAddress] as const,
    },
  ]);

  let stateResults: Array<{status: "success"; result: unknown} | {status: "failure"; error: Error}>;
  try {
    stateResults = await publicClient.multicall({contracts: calls, allowFailure: true});
  } catch (err) {
    return {
      positions: [],
      errors: [`Wave 2 multicall failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const positions: PortfolioPosition[] = [];

  resolved.forEach(({id, address}, i) => {
    const base = i * STRIDE;
    const stateRes = stateResults[base];
    const questionRes = stateResults[base + 1];
    const outcomeRes = stateResults[base + 2];
    const expiryRes = stateResults[base + 3];
    const yesPoolRes = stateResults[base + 4];
    const noPoolRes = stateResults[base + 5];
    const feeRes = stateResults[base + 6];
    const claimWindowRes = stateResults[base + 7];
    const yesBetRes = stateResults[base + 8];
    const noBetRes = stateResults[base + 9];
    const hasClaimedRes = stateResults[base + 10];

    const required = [stateRes, questionRes, outcomeRes, expiryRes, yesBetRes, noBetRes];
    if (required.some((r) => r.status !== "success")) {
      errors.push(`market[${id}] read partial — skipping`);
      return;
    }

    const state = deriveState(Number(stateRes.status === "success" ? stateRes.result : 0));
    const question = String(
      (questionRes.status === "success" ? questionRes.result : `Market ${id}`) || `Market ${id}`,
    );
    const outcomeRaw = Number(outcomeRes.status === "success" ? outcomeRes.result : 0);
    const expiryTs = (expiryRes.status === "success" ? expiryRes.result : BigInt(0)) as bigint;
    const yesPoolFrozen = (yesPoolRes.status === "success" ? yesPoolRes.result : BigInt(0)) as bigint;
    const noPoolFrozen = (noPoolRes.status === "success" ? noPoolRes.result : BigInt(0)) as bigint;
    const protocolFeeBps = (feeRes.status === "success" ? feeRes.result : BigInt(0)) as bigint;
    const claimWindowOpensAt = (
      claimWindowRes.status === "success" ? claimWindowRes.result : BigInt(0)
    ) as bigint;
    const yesBet = (yesBetRes.status === "success" ? yesBetRes.result : ZERO_BYTES32) as Hex;
    const noBet = (noBetRes.status === "success" ? noBetRes.result : ZERO_BYTES32) as Hex;
    const hasClaimed = Boolean(hasClaimedRes.status === "success" ? hasClaimedRes.result : false);

    const isResolved =
      state === DarkOddsState.Resolved ||
      state === DarkOddsState.ClaimWindow ||
      state === DarkOddsState.Invalid;
    const outcome: DarkOddsOutcomeValue | null = isResolved ? (outcomeRaw as DarkOddsOutcomeValue) : null;

    const sides: ("YES" | "NO")[] = [];
    if (yesBet !== ZERO_BYTES32) sides.push("YES");
    if (noBet !== ZERO_BYTES32) sides.push("NO");

    for (const side of sides) {
      const handle = side === "YES" ? yesBet : noBet;
      const sideOutcomeMatch = side === "YES" ? outcomeRaw === 1 : outcomeRaw === 0;
      const isWinner = state === DarkOddsState.ClaimWindow && sideOutcomeMatch;
      const canClaim = isWinner && !hasClaimed;
      // refundIfInvalid clears the side handle on success, so canRefund is
      // simply "user has a non-zero handle on a side AND market is Invalid".
      const canRefund = state === DarkOddsState.Invalid;

      positions.push({
        marketId: id as DarkOddsMarketId,
        marketAddress: address,
        question,
        state,
        outcome,
        side,
        betHandle: handle,
        yesPoolFrozen,
        noPoolFrozen,
        protocolFeeBps,
        expiryTs,
        claimWindowOpensAt,
        hasClaimed,
        isWinner,
        canClaim,
        canRefund,
      });
    }
  });

  return {positions, errors};
}
