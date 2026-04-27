"use client";

import {useEffect, useState} from "react";

import {usePrivy} from "@privy-io/react-auth";
import {Check, Copy, ExternalLink, X} from "lucide-react";
import {formatEther, formatUnits, type Hex} from "viem";
import {useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract} from "wagmi";

import {chain, txLink} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {faucetAbi, testUsdcAbi} from "@/lib/contracts/generated";

interface FaucetModalProps {
  open: boolean;
  onClose: () => void;
}

const CHAINLINK_FAUCET_URL = "https://faucets.chain.link/arbitrum-sepolia";

export function FaucetModal({open, onClose}: FaucetModalProps): React.ReactElement | null {
  const {authenticated, login} = usePrivy();
  const {address} = useAccount();

  // Esc-to-close + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <div className="modal-head">
          <div className="modal-stamp">
            <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
              FAUCET // TESTNET ONLY
            </span>
          </div>
          <h2 className="modal-title">
            Get fuel for the <em>demo</em>.
          </h2>
        </div>

        {!authenticated && (
          <div className="modal-step">
            <p className="modal-step-desc">Connect a wallet to use the faucet.</p>
            <button type="button" className="modal-cta" onClick={login}>
              CONNECT WALLET
            </button>
          </div>
        )}

        {authenticated && address && (
          <>
            <FaucetEthStep address={address} />
            <FaucetUsdcStep address={address} />
          </>
        )}

        <div className="modal-foot">All txs are on Arb Sepolia ({chain.id}). Test funds only.</div>
      </div>
    </div>
  );
}

interface AddressedStepProps {
  address: `0x${string}`;
}

function FaucetEthStep({address}: AddressedStepProps): React.ReactElement {
  const ethBal = useBalance({address});
  const [copied, setCopied] = useState(false);

  const onCopy = (): void => {
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="modal-step">
      <div className="modal-step-num">STEP 01</div>
      <h3 className="modal-step-h">Get Arb Sepolia ETH.</h3>
      <p className="modal-step-desc">
        You need ETH for gas. Chainlink&apos;s public faucet is the canonical path — paste the address below
        into the form there.
      </p>

      <div className="modal-addr">
        <span>{address}</span>
        <button type="button" className="copy" onClick={onCopy}>
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "COPIED" : "COPY"}
        </button>
      </div>

      <a className="modal-cta" href={CHAINLINK_FAUCET_URL} target="_blank" rel="noopener noreferrer">
        OPEN CHAINLINK FAUCET <ExternalLink size={12} />
      </a>

      <div className="modal-balance-row">
        <span className="k">Current ETH</span>
        <span>{ethBal.data ? Number(formatEther(ethBal.data.value)).toFixed(4) : "—"}</span>
      </div>
    </div>
  );
}

function FaucetUsdcStep({address}: AddressedStepProps): React.ReactElement {
  const tusdcBal = useReadContract({
    address: addresses.TestUSDC,
    abi: testUsdcAbi,
    functionName: "balanceOf",
    args: [address],
  });
  const claimableAt = useReadContract({
    address: addresses.Faucet,
    abi: faucetAbi,
    functionName: "claimableAt",
    args: [address],
  });

  const {writeContract, data: claimTx, isPending: signPending, error: claimError} = useWriteContract();
  const claimReceipt = useWaitForTransactionReceipt({hash: claimTx});

  // Track which tx hash we last celebrated, so the 3s "✓ CLAIMED" badge fires
  // exactly once per successful claim. Both timers below are setTimeout-scheduled
  // — never synchronous setState in the effect body — to satisfy React 19's
  // set-state-in-effect lint rule.
  const [celebrated, setCelebrated] = useState<Hex | null>(null);
  const successHash = claimReceipt.isSuccess ? (claimTx ?? null) : null;
  const showSuccess = celebrated !== null && celebrated === successHash;

  useEffect(() => {
    if (!successHash || celebrated === successHash) return;
    const showT = setTimeout(() => setCelebrated(successHash), 0);
    const hideT = setTimeout(() => setCelebrated(null), 3000);
    void tusdcBal.refetch();
    void claimableAt.refetch();
    return () => {
      clearTimeout(showT);
      clearTimeout(hideT);
    };
  }, [successHash, celebrated, tusdcBal, claimableAt]);

  const cooldownTs = claimableAt.data !== undefined ? Number(claimableAt.data as bigint) : 0;
  const {label: cooldownLabel, active: onCooldown} = useCooldownCountdown(cooldownTs);

  const onClaim = (): void => {
    writeContract({
      address: addresses.Faucet,
      abi: faucetAbi,
      functionName: "claim",
    });
  };

  let buttonLabel = "CLAIM 1000 TESTUSDC";
  if (signPending) buttonLabel = "SIGNING…";
  else if (claimReceipt.isLoading) buttonLabel = "CONFIRMING…";
  else if (showSuccess) buttonLabel = "✓ CLAIMED — REFRESH IN 6H";
  else if (onCooldown) buttonLabel = `NEXT CLAIM IN ${cooldownLabel}`;

  const disabled = signPending || claimReceipt.isLoading || onCooldown || showSuccess;

  return (
    <div className="modal-step">
      <div className="modal-step-num">STEP 02</div>
      <h3 className="modal-step-h">Claim TestUSDC.</h3>
      <p className="modal-step-desc">
        1,000 tUSDC every 6 hours. Wrap into cUSDC inside any market to bet confidentially.
      </p>

      <button
        type="button"
        className={`modal-cta ${showSuccess ? "modal-cta--success" : ""}`}
        onClick={onClaim}
        disabled={disabled}
      >
        {buttonLabel}
      </button>

      {claimTx && !claimReceipt.isSuccess && (
        <div className="modal-balance-row">
          <span className="k">Tx</span>
          <a href={txLink(claimTx)} target="_blank" rel="noopener noreferrer">
            {claimTx.slice(0, 10)}…
          </a>
        </div>
      )}
      {claimError && (
        <div className="modal-balance-row" style={{color: "var(--redacted-red)"}}>
          <span className="k">Error</span>
          <span>{claimError.message.split("\n")[0].slice(0, 60)}</span>
        </div>
      )}

      <div className="modal-balance-row">
        <span className="k">Current TestUSDC</span>
        <span>
          {tusdcBal.data !== undefined ? Number(formatUnits(tusdcBal.data as bigint, 6)).toFixed(2) : "—"}
        </span>
      </div>
    </div>
  );
}

function useCooldownCountdown(targetTs: number): {label: string; active: boolean} {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (targetTs <= now) return;
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, [targetTs, now]);

  const active = targetTs > now;
  const remaining = Math.max(0, targetTs - now);
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  let label = `${s}s`;
  if (h > 0) label = `${h}h ${m}m`;
  else if (m > 0) label = `${m}m ${s}s`;
  return {label, active};
}
