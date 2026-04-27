/**
 * Bet flow pre-flight reads.
 *
 * One viem multicall against TestUSDC + cUSDC to read everything we need
 * to decide which steps to skip:
 *
 *   - tusdcBalance          — must be ≥ amount, else surface "Get faucet"
 *   - testUsdcAllowance     — if ≥ amount, skip APPROVE_TUSDC
 *   - isOperator            — if true, skip SETOPERATOR
 *
 * Wrap is never skipped: we always wrap exactly the bet amount to keep
 * the per-bet flow self-contained. Future v2: track previously-wrapped
 * amount in storage and skip if user has unspent cUSDC.
 *
 * The pre-flight runs against the user's connected wallet — server-side
 * we don't know who's connected, so this lives in the browser, called by
 * BetModal during the `preflight` phase.
 */

import {createPublicClient, http, type Address} from "viem";
import {arbitrumSepolia} from "viem/chains";

import {ARB_SEPOLIA_RPC_URL} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {confidentialUsdcAbi, testUsdcAbi} from "@/lib/contracts/generated";

import type {BetPreflight} from "./state-machine";

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(ARB_SEPOLIA_RPC_URL),
});

export interface PreflightInput {
  userAddress: Address;
  marketAddress: Address;
  amountUsdc: bigint;
}

/**
 * Reads on-chain state to populate the BetPreflight skip-flags. The
 * `useInfiniteAllowance` field is left at the operator-approved default of
 * true — the BetModal review state lets the user toggle it before CONFIRM.
 *
 * Throws on multicall failure so the orchestrator can dispatch
 * `PREFLIGHT_FAIL`. UI surfaces the classified error.
 */
export async function runPreflight(input: PreflightInput): Promise<BetPreflight> {
  const {userAddress, marketAddress, amountUsdc} = input;

  const results = await publicClient.multicall({
    contracts: [
      {
        address: addresses.TestUSDC,
        abi: testUsdcAbi,
        functionName: "balanceOf",
        args: [userAddress],
      },
      {
        address: addresses.TestUSDC,
        abi: testUsdcAbi,
        functionName: "allowance",
        args: [userAddress, addresses.ConfidentialUSDC],
      },
      {
        address: addresses.ConfidentialUSDC,
        abi: confidentialUsdcAbi,
        functionName: "isOperator",
        args: [userAddress, marketAddress],
      },
    ],
    allowFailure: false,
  });

  const tusdcBalance = results[0] as bigint;
  const allowance = results[1] as bigint;
  const isOp = results[2] as boolean;

  return {
    tusdcBalance,
    approveSkippable: allowance >= amountUsdc,
    wrapSkippable: false,
    setOperatorSkippable: isOp,
    useInfiniteAllowance: true,
  };
}
