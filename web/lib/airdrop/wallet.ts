/**
 * Airdrop wallet — server-only signer for the gas-airdrop endpoint.
 *
 * Loaded from `AIRDROP_PRIVATE_KEY` env var (separate from
 * `DEPLOYER_PRIVATE_KEY` so the airdrop budget is isolated from the
 * registry-owner key). Operator funds this wallet manually with ~0.5 ETH
 * Sepolia before deploy. At 0.005 ETH per airdrop that's ~100 grants
 * before refund.
 */

import "server-only";

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";

import {ARB_SEPOLIA_RPC_URL} from "@/lib/chains";

interface AirdropClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
  address: Address;
}

let cached: AirdropClients | null = null;

/**
 * Returns the airdrop wallet's clients, or null if AIRDROP_PRIVATE_KEY
 * is not configured. Callers must handle null and surface a clean
 * "airdrop unavailable" response — the route never throws.
 */
export function getAirdropClients(): AirdropClients | null {
  if (cached) return cached;
  const pk = process.env.AIRDROP_PRIVATE_KEY?.trim() as Hex | undefined;
  if (!pk || !pk.startsWith("0x") || pk.length !== 66) return null;

  const account = privateKeyToAccount(pk);
  cached = {
    publicClient: createPublicClient({chain: arbitrumSepolia, transport: http(ARB_SEPOLIA_RPC_URL)}),
    walletClient: createWalletClient({account, chain: arbitrumSepolia, transport: http(ARB_SEPOLIA_RPC_URL)}),
    address: account.address,
  };
  return cached;
}
