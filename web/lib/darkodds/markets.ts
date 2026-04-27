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

import {createPublicClient, http, type Address, type Hex} from "viem";
import {arbitrumSepolia} from "viem/chains";

import {marketAbi, marketRegistryAbi} from "@/lib/contracts/generated";
import {addresses} from "@/lib/contracts/addresses";
import {tryPublicDecryptUint256} from "@/lib/nox/client";

import {
  type DarkOddsCardOutcome,
  type DarkOddsMarket,
  type DarkOddsMarketId,
  type DarkOddsOutcomeValue,
  DarkOddsState,
  type DarkOddsStateValue,
} from "./types";

const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

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

  // Wave 2: per-market batched reads. 8 calls per market: state, question,
  // outcome, expiryTs, yesPoolFrozen, noPoolFrozen, plus the two
  // publicly-decryptable pool handles for live odds on Open-state markets
  // (F12-HOOK resolved by F9 — Nox SDK now in web/, publicDecrypt available).
  const calls = resolvedAddresses.flatMap(({address}) => [
    {address, abi: marketAbi, functionName: "state" as const},
    {address, abi: marketAbi, functionName: "question" as const},
    {address, abi: marketAbi, functionName: "outcome" as const},
    {address, abi: marketAbi, functionName: "expiryTs" as const},
    {address, abi: marketAbi, functionName: "yesPoolFrozen" as const},
    {address, abi: marketAbi, functionName: "noPoolFrozen" as const},
    {address, abi: marketAbi, functionName: "yesPoolPublishedHandle" as const},
    {address, abi: marketAbi, functionName: "noPoolPublishedHandle" as const},
  ]);
  const STRIDE = 8;

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

  // Pre-computed market metadata, with `pendingOddsHandles` for any market
  // whose frozen pools are 0 but published handles are non-zero — those
  // need a publicDecrypt round-trip before we surface plaintext odds.
  type MarketDraft = {
    id: bigint;
    address: Address;
    question: string;
    state: DarkOddsStateValue;
    outcome: DarkOddsOutcomeValue;
    expiryTs: bigint;
    yesPoolFrozen: bigint;
    noPoolFrozen: bigint;
    yesPoolHandle: Hex;
    noPoolHandle: Hex;
    isOpen: boolean;
    isResolved: boolean;
  };
  const drafts: MarketDraft[] = [];
  resolvedAddresses.forEach(({id, address}, i) => {
    const base = i * STRIDE;
    const stateRes = stateResults[base];
    const questionRes = stateResults[base + 1];
    const outcomeRes = stateResults[base + 2];
    const expiryRes = stateResults[base + 3];
    const yesPoolRes = stateResults[base + 4];
    const noPoolRes = stateResults[base + 5];
    const yesHandleRes = stateResults[base + 6];
    const noHandleRes = stateResults[base + 7];

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
    const yesPoolHandle = (
      yesHandleRes?.status === "success" ? (yesHandleRes.result as Hex) : ZERO_BYTES32
    ) as Hex;
    const noPoolHandle = (
      noHandleRes?.status === "success" ? (noHandleRes.result as Hex) : ZERO_BYTES32
    ) as Hex;

    const isOpen = state === DarkOddsState.Open && nowSec < expiryTs;
    const isResolved =
      state === DarkOddsState.Resolved ||
      state === DarkOddsState.ClaimWindow ||
      state === DarkOddsState.Invalid;

    drafts.push({
      id,
      address,
      question,
      state,
      outcome,
      expiryTs,
      yesPoolFrozen,
      noPoolFrozen,
      yesPoolHandle,
      noPoolHandle,
      isOpen,
      isResolved,
    });
  });

  // F12-HOOK resolved: for Open-state markets where frozen pools are zero
  // but the published pool handles are initialized, fetch plaintext via
  // Nox `publicDecrypt`. Best-effort — null on any failure (gateway 5xx,
  // timeout, malformed handle) → outcome.probability stays null →
  // card renders "—".
  const publicDecryptJobs = drafts.map(async (d) => {
    if (d.yesPoolFrozen + d.noPoolFrozen > BigInt(0)) {
      return deriveOutcomes(d.yesPoolFrozen, d.noPoolFrozen);
    }
    if (d.yesPoolHandle === ZERO_BYTES32 || d.noPoolHandle === ZERO_BYTES32) {
      return deriveOutcomes(BigInt(0), BigInt(0));
    }
    const [yesPlain, noPlain] = await Promise.all([
      tryPublicDecryptUint256(d.yesPoolHandle),
      tryPublicDecryptUint256(d.noPoolHandle),
    ]);
    if (yesPlain === null || noPlain === null) {
      return deriveOutcomes(BigInt(0), BigInt(0));
    }
    return deriveOutcomes(yesPlain, noPlain);
  });
  const outcomesByDraft = await Promise.all(publicDecryptJobs);

  const markets: DarkOddsMarket[] = drafts.map((d, i) => ({
    id: d.id as DarkOddsMarketId,
    address: d.address,
    question: d.question,
    state: d.state,
    outcome: d.isResolved ? d.outcome : null,
    expiryTs: d.expiryTs,
    yesPoolFrozen: d.yesPoolFrozen,
    noPoolFrozen: d.noPoolFrozen,
    outcomes: outcomesByDraft[i]!,
    isOpen: d.isOpen,
    isResolved: d.isResolved,
  }));

  return {markets, errors};
}
