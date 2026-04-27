"use client";

import {formatUnits} from "viem";
import {useReadContract} from "wagmi";

import {faucetAbi, marketRegistryAbi, testUsdcAbi} from "@/lib/contracts/generated";
import {addresses} from "@/lib/contracts/addresses";

/// Sidebar footer block. Reads MarketRegistry.nextMarketId() and the Faucet's
/// TestUSDC balance live from chain. The "BETS PLACED" stat stays as the
/// dossier redaction-bar placeholder per design intent — actual bet counts
/// come from the F12 subgraph integration.
export function ProtocolStats(): React.ReactElement {
  const nextMarketId = useReadContract({
    address: addresses.MarketRegistry,
    abi: marketRegistryAbi,
    functionName: "nextMarketId",
  });

  const faucetBal = useReadContract({
    address: addresses.TestUSDC,
    abi: testUsdcAbi,
    functionName: "balanceOf",
    args: [addresses.Faucet],
  });

  const claimAmount = useReadContract({
    address: addresses.Faucet,
    abi: faucetAbi,
    functionName: "CLAIM_AMOUNT",
  });

  const marketsLive = nextMarketId.data !== undefined ? Number(nextMarketId.data as bigint) - 1 : null;
  const faucetTusdc =
    faucetBal.data !== undefined ? Number(formatUnits(faucetBal.data as bigint, 6)).toLocaleString() : null;
  const claimsLeft =
    faucetBal.data !== undefined && claimAmount.data !== undefined
      ? Number((faucetBal.data as bigint) / (claimAmount.data as bigint)).toLocaleString()
      : null;

  return (
    <div className="proto-stats">
      <div className="stat-row">
        <span className="k">Markets live</span>
        <span className="v">{marketsLive ?? "—"}</span>
      </div>
      <div className="stat-row">
        <span className="k">Faucet tUSDC</span>
        <span className="v">{faucetTusdc ?? "—"}</span>
      </div>
      <div className="stat-row">
        <span className="k">Claims left</span>
        <span className="v">{claimsLeft ?? "—"}</span>
      </div>
      <div className="stat-row">
        <span className="k">Bets placed</span>
        <span className="v">
          <span className="rbar" aria-label="redacted" />
        </span>
      </div>
    </div>
  );
}
