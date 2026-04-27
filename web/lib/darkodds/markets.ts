/**
 * DarkOdds market list reader — server-side via viem multicall.
 *
 * Two waves of multicall:
 *  1. MarketRegistry.markets(id) for id ∈ [1, nextMarketId-1] → addresses
 *  2. For each address: state, question, outcome, expiryTs, yesPoolFrozen,
 *     noPoolFrozen — all in a single batched call
 *
 * Multicall3 is deployed at 0xcA11bde05977b3631167028862bE2a173976CA11 on
 * Arb Sepolia (chain config in viem/chains has it). viem's `multicall`
 * helper handles batching automatically.
 *
 * NOT a `'use client'` module — server-only. Components hydrate from the
 * page's server-component fetch.
 */

import {createPublicClient, http, type Address} from "viem";
import {arbitrumSepolia} from "viem/chains";

import {marketAbi, marketRegistryAbi} from "@/lib/contracts/generated";
import {addresses} from "@/lib/contracts/addresses";

import {
  type DarkOddsCardOutcome,
  type DarkOddsMarket,
  type DarkOddsMarketId,
  type DarkOddsOutcomeValue,
  DarkOddsState,
  type DarkOddsStateValue,
} from "./types";

const RPC_URL = process.env.NEXT_PUBLIC_ARB_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(RPC_URL),
});

/** Cap how many markets we'll read per render — keeps multicall tractable. */
const MAX_MARKETS = 50;

function deriveOutcomes(
  yesPoolFrozen: bigint,
  noPoolFrozen: bigint,
): [DarkOddsCardOutcome, DarkOddsCardOutcome] {
  // Pools are post-freezePool plaintext. Both zero = market still in Open
  // state pre-batch-publish; we surface null probability so the UI can
  // render a "—" placeholder rather than a misleading 50/50.
  const total = yesPoolFrozen + noPoolFrozen;
  if (total === BigInt(0)) {
    return [
      {label: "YES", probability: null},
      {label: "NO", probability: null},
    ];
  }
  // Compute probability via fixed-point: (pool * 1e6) / total → integer ppm
  // (parts per million), then back to float. Avoids floating-point on bigint.
  // Using BigInt(1_000_000) instead of `1_000_000n` for tsconfig ES2017 compat.
  const ppmYes = Number((yesPoolFrozen * BigInt(1_000_000)) / total) / 1_000_000;
  return [
    {label: "YES", probability: ppmYes},
    {label: "NO", probability: 1 - ppmYes},
  ];
}

function deriveState(state: number): DarkOddsStateValue {
  if (state >= 0 && state <= 6) return state as DarkOddsStateValue;
  return DarkOddsState.Created;
}

/**
 * Read every DarkOdds market created against the production MarketRegistry,
 * up to `MAX_MARKETS`. Returns degraded-but-rendering — partial errors are
 * collected in `errors[]` so the UI can render whatever resolved.
 */
export async function getDarkOddsMarkets(): Promise<{
  markets: DarkOddsMarket[];
  errors: string[];
}> {
  const errors: string[] = [];

  // Wave 0: how many markets exist?
  let nextId: bigint;
  try {
    nextId = (await publicClient.readContract({
      address: addresses.MarketRegistry,
      abi: marketRegistryAbi,
      functionName: "nextMarketId",
    })) as bigint;
  } catch (err) {
    return {
      markets: [],
      errors: [`MarketRegistry.nextMarketId failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  // Market IDs start at 1; nextMarketId is the next one to be assigned.
  const totalMarkets = Number(nextId - BigInt(1));
  if (totalMarkets <= 0) return {markets: [], errors};

  const start = Math.max(1, totalMarkets - MAX_MARKETS + 1);
  const ids: bigint[] = [];
  for (let i = totalMarkets; i >= start; i--) ids.push(BigInt(i));

  // Wave 1: market addresses by id
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
    errors.push(`Wave 1 multicall failed: ${err instanceof Error ? err.message : String(err)}`);
    return {markets: [], errors};
  }

  const resolvedAddresses: {id: bigint; address: Address}[] = [];
  addressResults.forEach((r, i) => {
    if (r.status === "success" && r.result && r.result !== "0x0000000000000000000000000000000000000000") {
      resolvedAddresses.push({id: ids[i], address: r.result});
    } else if (r.status === "failure") {
      errors.push(`market[${ids[i]}] address read failed: ${r.error?.message ?? "unknown"}`);
    }
  });

  if (resolvedAddresses.length === 0) return {markets: [], errors};

  // Wave 2: per-market batched reads. 6 calls per market: state, question,
  // outcome, expiryTs, yesPoolFrozen, noPoolFrozen.
  const calls = resolvedAddresses.flatMap(({address}) => [
    {address, abi: marketAbi, functionName: "state" as const},
    {address, abi: marketAbi, functionName: "question" as const},
    {address, abi: marketAbi, functionName: "outcome" as const},
    {address, abi: marketAbi, functionName: "expiryTs" as const},
    {address, abi: marketAbi, functionName: "yesPoolFrozen" as const},
    {address, abi: marketAbi, functionName: "noPoolFrozen" as const},
  ]);

  let stateResults: Array<{status: "success"; result: unknown} | {status: "failure"; error: Error}>;
  try {
    stateResults = await publicClient.multicall({
      contracts: calls,
      allowFailure: true,
    });
  } catch (err) {
    errors.push(`Wave 2 multicall failed: ${err instanceof Error ? err.message : String(err)}`);
    return {markets: [], errors};
  }

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const markets: DarkOddsMarket[] = [];
  resolvedAddresses.forEach(({id, address}, i) => {
    const base = i * 6;
    const stateRes = stateResults[base];
    const questionRes = stateResults[base + 1];
    const outcomeRes = stateResults[base + 2];
    const expiryRes = stateResults[base + 3];
    const yesPoolRes = stateResults[base + 4];
    const noPoolRes = stateResults[base + 5];

    if (
      stateRes.status !== "success" ||
      questionRes.status !== "success" ||
      outcomeRes.status !== "success" ||
      expiryRes.status !== "success" ||
      yesPoolRes.status !== "success" ||
      noPoolRes.status !== "success"
    ) {
      errors.push(`market[${id}] state read partial — skipping`);
      return;
    }

    const state = deriveState(Number(stateRes.result));
    const question = String(questionRes.result || `Market ${id}`);
    const outcome = Number(outcomeRes.result) as DarkOddsOutcomeValue;
    const expiryTs = expiryRes.result as bigint;
    const yesPoolFrozen = yesPoolRes.result as bigint;
    const noPoolFrozen = noPoolRes.result as bigint;

    const isOpen = state === DarkOddsState.Open && nowSec < expiryTs;
    const isResolved =
      state === DarkOddsState.Resolved ||
      state === DarkOddsState.ClaimWindow ||
      state === DarkOddsState.Invalid;

    markets.push({
      id: id as DarkOddsMarketId,
      address,
      question,
      state,
      outcome: isResolved ? outcome : null,
      expiryTs,
      yesPoolFrozen,
      noPoolFrozen,
      outcomes: deriveOutcomes(yesPoolFrozen, noPoolFrozen),
      isOpen,
      isResolved,
    });
  });

  return {markets, errors};
}
