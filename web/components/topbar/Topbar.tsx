"use client";

import Link from "next/link";

import {Menu} from "lucide-react";

import {ThemeToggle} from "@/app/_landing/ThemeToggle";

import {FaucetButton} from "./FaucetButton";
import {GovernanceBadge} from "./GovernanceBadge";
import {NetworkChip} from "./NetworkChip";
import {WalletButton} from "./WalletButton";

interface TopbarProps {
  onOpenSidebar: () => void;
  onOpenFaucet: () => void;
}

export function Topbar({onOpenSidebar, onOpenFaucet}: TopbarProps): React.ReactElement {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="topbar-burger" onClick={onOpenSidebar} aria-label="Open navigation">
          <Menu size={18} />
        </button>
        <Link href="/" className="topbar-brand">
          <span className="crest" aria-hidden>
            D◆
          </span>
          Dark<em>Odds</em>
        </Link>
      </div>
      <div className="topbar-right">
        <NetworkChip />
        <FaucetButton onOpen={onOpenFaucet} />
        <GovernanceBadge />
        <ThemeToggle />
        <WalletButton />
      </div>
    </header>
  );
}
