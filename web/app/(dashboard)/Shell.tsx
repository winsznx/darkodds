"use client";

import {useEffect, useState} from "react";

import {useAccount} from "wagmi";

import {chain} from "@/lib/chains";
import {FaucetModal} from "@/components/faucet/FaucetModal";
import {Sidebar} from "@/components/sidebar/Sidebar";
import {Topbar} from "@/components/topbar/Topbar";

export function Shell({children}: {children: React.ReactNode}): React.ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [faucetOpen, setFaucetOpen] = useState(false);

  useEffect(() => {
    const handler = (): void => setFaucetOpen(true);
    window.addEventListener("darkodds:open-faucet", handler);
    return () => window.removeEventListener("darkodds:open-faucet", handler);
  }, []);
  const {chainId: onChain, isConnected} = useAccount();
  const wrongNet = isConnected && onChain !== undefined && onChain !== chain.id;

  return (
    <div className="dash-shell">
      <Topbar onOpenSidebar={() => setDrawerOpen(true)} onOpenFaucet={() => setFaucetOpen(true)} />

      {wrongNet && (
        <div className="net-mismatch">
          <span>WRONG NETWORK — DARKODDS RUNS ON {chain.name.toUpperCase()}</span>
          <button type="button" onClick={() => undefined}>
            SWITCH (use chip in topbar)
          </button>
        </div>
      )}

      <div className="dash-body">
        <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <main className="dash-main">{children}</main>
      </div>

      <FaucetModal open={faucetOpen} onClose={() => setFaucetOpen(false)} />
    </div>
  );
}
