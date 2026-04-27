import {defineConfig} from "@wagmi/cli";
import {foundry} from "@wagmi/cli/plugins";

import deployment from "../contracts/deployments/arb-sepolia.json";

import type {Address} from "viem";

/// @wagmi/cli config — generates a single typed file at lib/contracts/generated.ts
/// containing every Foundry ABI we care about, plus typed `*_ADDRESS` constants
/// pulled directly from deployments/arb-sepolia.json.
///
/// Run with `pnpm generate:contracts` (also runs `forge build` first to refresh
/// artifacts).
export default defineConfig({
  out: "lib/contracts/generated.ts",
  plugins: [
    foundry({
      project: "../contracts",
      include: [
        "TestUSDC.sol/**",
        "ConfidentialUSDC.sol/**",
        "MarketRegistry.sol/**",
        "Market.sol/**",
        "Faucet.sol/**",
        "FeeVault.sol/**",
        "ResolutionOracle.sol/**",
        "ClaimVerifier.sol/**",
      ],
      deployments: {
        TestUSDC: deployment.contracts.TestUSDC as Address,
        ConfidentialUSDC: deployment.contracts.ConfidentialUSDC as Address,
        MarketRegistry: deployment.contracts.MarketRegistry as Address,
        Faucet: deployment.contracts.Faucet as Address,
        FeeVault: deployment.contracts.FeeVault as Address,
        ResolutionOracle: deployment.contracts.ResolutionOracle as Address,
        ClaimVerifier: deployment.contracts.ClaimVerifier as Address,
      },
    }),
  ],
});
