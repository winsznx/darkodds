import type {Address} from "viem";

import {addressLink} from "@/lib/chains";

interface MarketMetaProps {
  marketAddress: Address;
  registryId: bigint;
  resolutionOracle: Address;
  oracleType: number;
  protocolFeeBps: bigint;
}

const ORACLE_TYPE_LABEL: Record<number, string> = {
  0: "ADMIN ORACLE",
  1: "CHAINLINK PRICE FEED",
  2: "PRE-RESOLVED",
};

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function MarketMeta({
  marketAddress,
  registryId,
  resolutionOracle,
  oracleType,
  protocolFeeBps,
}: MarketMetaProps): React.ReactElement {
  return (
    <div className="md-meta-block">
      <div className="row">
        <span className="k">Market id</span>
        <span className="v">#{registryId.toString()}</span>
      </div>
      <div className="row">
        <span className="k">Address</span>
        <span className="v">
          <a href={addressLink(marketAddress)} target="_blank" rel="noopener noreferrer">
            {shortAddr(marketAddress)}
          </a>
        </span>
      </div>
      <div className="row">
        <span className="k">Oracle</span>
        <span className="v">
          {ORACLE_TYPE_LABEL[oracleType] ?? "UNKNOWN"} ·{" "}
          <a href={addressLink(resolutionOracle)} target="_blank" rel="noopener noreferrer">
            {shortAddr(resolutionOracle)}
          </a>
        </span>
      </div>
      <div className="row">
        <span className="k">Protocol fee</span>
        <span className="v">{(Number(protocolFeeBps) / 100).toFixed(2)}%</span>
      </div>
    </div>
  );
}
