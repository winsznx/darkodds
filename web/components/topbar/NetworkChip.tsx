"use client";

import {AlertCircle} from "lucide-react";
import {useAccount, useSwitchChain} from "wagmi";

import {chain} from "@/lib/chains";

export function NetworkChip(): React.ReactElement {
  // useAccount().chainId is the wallet's current chain (typed as number | undefined),
  // distinct from useChainId() which is constrained to our config's chain set.
  const {chainId: onChain, isConnected} = useAccount();
  const {switchChain, isPending} = useSwitchChain();
  const mismatch = isConnected && onChain !== undefined && onChain !== chain.id;

  const handleClick = (): void => {
    if (!mismatch) return;
    switchChain({chainId: chain.id});
  };

  return (
    <button
      type="button"
      className="netchip"
      data-mismatch={mismatch}
      onClick={handleClick}
      title={mismatch ? `Switch to ${chain.name}` : chain.name}
    >
      {mismatch ? <AlertCircle size={12} /> : <span className="dot" aria-hidden />}
      <span>{mismatch ? "WRONG NETWORK" : "ARB SEPOLIA"}</span>
      {mismatch && <span style={{opacity: 0.7}}>{isPending ? "…" : "↺"}</span>}
    </button>
  );
}
