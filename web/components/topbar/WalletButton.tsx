"use client";

import {useEffect, useRef, useState} from "react";

import {usePrivy, useWallets} from "@privy-io/react-auth";
import {Wallet} from "lucide-react";
import {formatEther, formatUnits} from "viem";
import {useAccount, useBalance, useReadContract} from "wagmi";

import {addressLink} from "@/lib/chains";
import {confidentialUsdcAbi, testUsdcAbi} from "@/lib/contracts/generated";
import {addresses} from "@/lib/contracts/addresses";

function shortAddr(addr: string | undefined): string {
  if (!addr || addr.length < 10) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletButton(): React.ReactElement {
  const {ready, authenticated, login, logout} = usePrivy();
  const {wallets} = useWallets();
  const {address} = useAccount();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-outside to close the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Pre-login skeleton — keep button width stable so the topbar doesn't reflow
  // on first mount.
  if (!ready) {
    return (
      <button type="button" className="wallet-btn" disabled>
        <Wallet size={12} />
        <span className="redact" style={{minWidth: 80, height: 12}} aria-hidden />
      </button>
    );
  }

  if (!authenticated) {
    return (
      <button type="button" className="wallet-btn wallet-btn--primary" onClick={login}>
        <Wallet size={12} />
        CONNECT
      </button>
    );
  }

  return (
    <div className="wallet-wrap" ref={wrapRef}>
      <button type="button" className="wallet-btn" onClick={() => setOpen((v) => !v)}>
        <Wallet size={12} />
        {shortAddr(address)}
      </button>
      {open && address && (
        <WalletMenu
          address={address}
          onClose={() => setOpen(false)}
          onLogout={logout}
          embeddedWallet={wallets[0]?.walletClientType === "privy"}
        />
      )}
    </div>
  );
}

interface WalletMenuProps {
  address: `0x${string}`;
  onClose: () => void;
  onLogout: () => Promise<void>;
  embeddedWallet: boolean;
}

function WalletMenu({address, onClose, onLogout, embeddedWallet}: WalletMenuProps): React.ReactElement {
  const ethBal = useBalance({address});
  const tusdcBal = useReadContract({
    address: addresses.TestUSDC,
    abi: testUsdcAbi,
    functionName: "balanceOf",
    args: [address],
  });
  // cUSDC balance is fetched but we render the redaction-bar placeholder rather
  // than the encrypted handle directly; full decrypt-on-demand UX comes in F8/F9
  // when the per-market `<Redacted>` primitive ships. Mark intentionally unused.
  void useReadContract({
    address: addresses.ConfidentialUSDC,
    abi: confidentialUsdcAbi,
    functionName: "confidentialBalanceOf",
    args: [address],
  });

  const onCopy = (): void => {
    void navigator.clipboard.writeText(address);
  };

  const handleLogout = async (): Promise<void> => {
    await onLogout();
    onClose();
  };

  return (
    <div className="wallet-menu" role="menu">
      <div className="row">
        <span className="k">Account</span>
        <span className="v">{embeddedWallet ? "EMBEDDED" : "EXTERNAL"}</span>
      </div>
      <div className="row">
        <span className="k">Address</span>
        <a className="v addr" href={addressLink(address)} target="_blank" rel="noopener noreferrer">
          {shortAddr(address)}
        </a>
      </div>
      <div className="row">
        <span className="k">ETH</span>
        <span className="v">{ethBal.data ? Number(formatEther(ethBal.data.value)).toFixed(4) : "—"}</span>
      </div>
      <div className="row">
        <span className="k">TestUSDC</span>
        <span className="v">
          {tusdcBal.data !== undefined ? Number(formatUnits(tusdcBal.data as bigint, 6)).toFixed(2) : "—"}
        </span>
      </div>
      <div className="row">
        <span className="k">cUSDC</span>
        <span className="v" style={{display: "inline-flex", alignItems: "center", gap: 8}}>
          <span style={{display: "inline-block", height: 12, width: 56, background: "#000"}} aria-hidden />
          <span style={{fontSize: 10, color: "var(--fg-muted)"}}>encrypted</span>
        </span>
      </div>
      <div className="wallet-menu-actions">
        <button type="button" onClick={onCopy}>
          COPY
        </button>
        <button type="button" onClick={handleLogout}>
          DISCONNECT
        </button>
      </div>
    </div>
  );
}
