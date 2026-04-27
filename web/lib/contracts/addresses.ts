import deployment from "@root/contracts/deployments/arb-sepolia.json";

import type {Address} from "viem";

/// Type-safe re-export of the deployments JSON. Single source of truth — never
/// hardcode addresses in components. Adding a new contract = add to the JSON,
/// add a key here.
export const addresses = {
  TestUSDC: deployment.contracts.TestUSDC as Address,
  ConfidentialUSDC: deployment.contracts.ConfidentialUSDC as Address,
  MarketRegistry: deployment.contracts.MarketRegistry as Address,
  MarketImplementation: deployment.contracts.MarketImplementation as Address,
  ResolutionOracle: deployment.contracts.ResolutionOracle as Address,
  AdminOracle: deployment.contracts.AdminOracle as Address,
  PreResolvedOracle: deployment.contracts.PreResolvedOracle as Address,
  ChainlinkPriceOracle: deployment.contracts.ChainlinkPriceOracle as Address,
  ClaimVerifier: deployment.contracts.ClaimVerifier as Address,
  FeeVault: deployment.contracts.FeeVault as Address,
  Faucet: deployment.contracts.Faucet as Address,
  Safe: deployment.safe.address as Address,
} as const;

export const safeUiUrl = deployment.safe.safeUiUrl;
