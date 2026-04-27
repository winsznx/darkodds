"use client";

import {useReadContract} from "wagmi";

import {addresses} from "@/lib/contracts/addresses";
import {marketRegistryAbi} from "@/lib/contracts/generated";

interface PagePlaceholderProps {
  num: string;
  title: string;
  emphasis: string;
  meta: string;
  comingIn: string;
  description: string;
}

/// Shared placeholder for /markets, /portfolio, /audit, /create. Each renders
/// a live MarketRegistry.nextMarketId() readout to prove the wagmi chain wiring
/// is working end-to-end at the route level.
export function PagePlaceholder({
  num,
  title,
  emphasis,
  meta,
  comingIn,
  description,
}: PagePlaceholderProps): React.ReactElement {
  const nextMarketId = useReadContract({
    address: addresses.MarketRegistry,
    abi: marketRegistryAbi,
    functionName: "nextMarketId",
  });

  const liveCount = nextMarketId.data !== undefined ? Number(nextMarketId.data as bigint) - 1 : null;

  return (
    <>
      <header className="page-header">
        <h1 className="h">
          {title} <em>{emphasis}</em>
        </h1>
        <span className="meta">{meta}</span>
      </header>

      <section className="page-body">
        <div className="page-placeholder">
          <div className="stamp-row">
            <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)"}}>
              §{num} · COMING IN {comingIn}
            </span>
          </div>
          <p className="lede">{description}</p>
          <div className="chain-readout">
            <span className="k">Chain readout</span>
            <span className="v">
              MarketRegistry.nextMarketId ={" "}
              {nextMarketId.isLoading ? "…" : nextMarketId.isError ? "ERR" : String(nextMarketId.data ?? "—")}
            </span>
            <span className="k">Markets created</span>
            <span className="v">{liveCount ?? "—"}</span>
          </div>
        </div>
      </section>
    </>
  );
}
