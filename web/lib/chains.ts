import {arbitrumSepolia} from "viem/chains";

/// Single source of truth for the chain DarkOdds runs on. We pin Arb Sepolia
/// across the whole stack — Privy's `supportedChains`, wagmi's `chains` /
/// `transports`, and any direct viem clients all read from here.
export const chain = arbitrumSepolia;
export const supportedChains = [arbitrumSepolia] as const;

export const ARB_SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_ARB_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";

export const ARBISCAN_BASE = "https://sepolia.arbiscan.io";
export const txLink = (hash: string): string => `${ARBISCAN_BASE}/tx/${hash}`;
export const addressLink = (address: string): string => `${ARBISCAN_BASE}/address/${address}`;
