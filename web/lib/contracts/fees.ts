/**
 * Arb Sepolia fee-override helper — shared between every tx path that
 * submits writes from the browser (place-bet, claim, refund, /create
 * deploy, attestation).
 *
 * Why it exists: viem's default fee estimator reads the previous block's
 * baseFee and adds a 1.2× multiplier. On Arb Sepolia the network minimum
 * basefee floats around 0.02 gwei and frequently ticks up a few thousand
 * wei between blocks — viem's estimate often lands BELOW the next block's
 * actual basefee, producing the
 *
 *   "max fee per gas less than block base fee"
 *
 * revert. Documented in F9 BUG_LOG and KNOWN_LIMITATIONS.
 *
 * Fix: read the latest block's basefee and apply a generous 5× buffer +
 * 0.01 gwei priority. Cost is negligible on Arb Sepolia (5× of 0.02 gwei
 * = 0.1 gwei → ~$0.001 per tx). Wallet-side estimators that respect dApp-
 * supplied fees will use these values; wallets that overwrite them
 * (Zerion / Phantom — see KNOWN_LIMITATIONS) will still hit the floor
 * race occasionally, but Privy embedded + MetaMask + Rabby honor them.
 */

import {parseGwei, type PublicClient} from "viem";

export interface FeeOverrides {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export async function getArbSepoliaFeeOverrides(publicClient: PublicClient): Promise<FeeOverrides> {
  const block = await publicClient.getBlock({blockTag: "latest"});
  const basefee = block.baseFeePerGas ?? parseGwei("0.02");
  const maxPriorityFeePerGas = parseGwei("0.01");
  const maxFeePerGas = basefee * BigInt(5) + maxPriorityFeePerGas;
  return {maxFeePerGas, maxPriorityFeePerGas};
}
