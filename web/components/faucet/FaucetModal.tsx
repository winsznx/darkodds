"use client";

import {useEffect, useState} from "react";

import {usePrivy, useWallets} from "@privy-io/react-auth";
import {Check, Copy, ExternalLink, Plus, X} from "lucide-react";
import {BaseError, ContractFunctionRevertedError, formatEther, formatUnits, type Hex} from "viem";
import {useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract} from "wagmi";

import {chain, txLink} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {faucetAbi, testUsdcAbi} from "@/lib/contracts/generated";

interface FaucetModalProps {
  open: boolean;
  onClose: () => void;
}

// Three onramp options for Arb Sepolia ETH. Order roughly: easiest first.
const CHAINLINK_FAUCET_URL = "https://faucets.chain.link/arbitrum-sepolia";
const GOOGLE_SEPOLIA_FAUCET_URL = "https://cloud.google.com/application/web3/faucet/ethereum/sepolia";
const ARBITRUM_BRIDGE_URL =
  "https://portal.arbitrum.io/bridge?destinationChain=arbitrum-sepolia&sanitized=true&sourceChain=sepolia";
const ADD_NETWORK_GUIDE_URL = "https://revoke.cash/learn/wallets/add-network/arbitrum-sepolia";

/**
 * Translates a viem write error into a human-readable label. Tries hard to
 * surface the contract's custom-error name (e.g. "CooldownActive") instead
 * of viem's verbose "The contract function 'claim' reverted with the
 * following reason:" wrapper. Falls back to viem's `shortMessage` if the
 * cause chain doesn't expose a structured revert reason.
 */
function describeClaimError(err: Error): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name === "CooldownActive") {
        const args = reverted.data?.args as readonly bigint[] | undefined;
        if (args && args.length > 0) {
          const nextAt = Number(args[0]);
          const remaining = Math.max(0, nextAt - Math.floor(Date.now() / 1000));
          const h = Math.floor(remaining / 3600);
          const m = Math.floor((remaining % 3600) / 60);
          return `Cooldown active — next claim in ${h > 0 ? `${h}h ${m}m` : `${Math.max(m, 1)}m`}.`;
        }
        return "Cooldown active — wait 6h between claims.";
      }
      if (name === "InsufficientFaucetBalance") {
        return "Faucet is empty. Ping @winsznx to refill it.";
      }
      if (name === "EnforcedPause") {
        return "Faucet is paused.";
      }
      if (name) return `Reverted: ${name}.`;
    }
    return err.shortMessage || err.message;
  }
  return err.message;
}

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
            <FaucetNetworkStep />
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

/**
 * STEP 01 — Add Arb Sepolia to the connected wallet via EIP-3085
 * `wallet_addEthereumChain`. If the wallet exposes the method (MetaMask /
 * Rabby / Zerion / most injected wallets do), the user gets a single
 * popup. Privy embedded wallets are pre-configured for Arb Sepolia, so
 * the call is effectively a no-op for them. Falls back to a revoke.cash
 * link if the request fails or the provider doesn't expose the method.
 */
function FaucetNetworkStep(): React.ReactElement {
  const {wallets} = useWallets();
  const wallet = wallets[0];
  const [status, setStatus] = useState<"idle" | "adding" | "added" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function handleAddNetwork(): Promise<void> {
    if (!wallet) return;
    setStatus("adding");
    setErrMsg(null);
    try {
      const provider = await wallet.getEthereumProvider();
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${chain.id.toString(16)}`,
            chainName: "Arbitrum Sepolia",
            nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
            rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
            blockExplorerUrls: ["https://sepolia.arbiscan.io"],
          },
        ],
      });
      setStatus("added");
    } catch (err) {
      // user rejected, provider doesn't support, or chain already exists —
      // any of these means the user can keep going without the button.
      setStatus("error");
      setErrMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="modal-step">
      <div className="modal-step-num">STEP 01</div>
      <h3 className="modal-step-h">Add Arb Sepolia to your wallet.</h3>
      <p className="modal-step-desc">
        Required once per wallet. Privy embedded wallets are pre-configured — for MetaMask / Rabby / Zerion /
        Phantom this adds the network in a single popup.
      </p>

      <button
        type="button"
        className={`modal-cta ${status === "added" ? "modal-cta--success" : ""}`}
        onClick={() => void handleAddNetwork()}
        disabled={!wallet || status === "adding" || status === "added"}
      >
        {status === "idle" && (
          <>
            <Plus size={12} /> ADD NETWORK
          </>
        )}
        {status === "adding" && "WAITING FOR WALLET…"}
        {status === "added" && (
          <>
            <Check size={12} /> NETWORK ADDED
          </>
        )}
        {status === "error" && (
          <>
            <Plus size={12} /> RETRY ADD NETWORK
          </>
        )}
      </button>

      {status === "error" && errMsg && (
        <div className="modal-balance-row" style={{color: "var(--fg-muted)"}}>
          <span className="k">Note</span>
          <span style={{fontSize: 11}}>
            Wallet rejected or doesn&apos;t expose this method. Add manually via{" "}
            <a href={ADD_NETWORK_GUIDE_URL} target="_blank" rel="noopener noreferrer">
              revoke.cash guide ↗
            </a>
            .
          </span>
        </div>
      )}

      <div className="modal-balance-row" style={{color: "var(--fg-muted)"}}>
        <span className="k">Manual guide</span>
        <a href={ADD_NETWORK_GUIDE_URL} target="_blank" rel="noopener noreferrer">
          revoke.cash <ExternalLink size={10} style={{marginLeft: 2, verticalAlign: "middle"}} />
        </a>
      </div>
    </div>
  );
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
      <div className="modal-step-num">STEP 02</div>
      <h3 className="modal-step-h">Get Arb Sepolia ETH.</h3>
      <p className="modal-step-desc">
        You need ETH for gas. Two paths — try Chainlink&apos;s direct Arb Sepolia faucet first; if it&apos;s
        rate-limited, the Sepolia → Arb bridge is the fallback.
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

      <details className="modal-step-alt">
        <summary>Or: bridge from Ethereum Sepolia →</summary>
        <p className="modal-step-desc" style={{marginTop: 8}}>
          Two-step path when Chainlink&apos;s Arb Sepolia faucet is dry. Get Sepolia ETH first, then bridge to
          Arb Sepolia.
        </p>
        <div className="modal-step-alt-actions">
          <a
            className="modal-cta modal-cta--secondary"
            href={GOOGLE_SEPOLIA_FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            GOOGLE CLOUD SEPOLIA FAUCET <ExternalLink size={12} />
          </a>
          <a
            className="modal-cta modal-cta--secondary"
            href={ARBITRUM_BRIDGE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            ARBITRUM BRIDGE <ExternalLink size={12} />
          </a>
        </div>
      </details>

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
      <div className="modal-step-num">STEP 03</div>
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
        <div className="modal-faucet-error" role="alert">
          <span className="k">Error</span>
          <span className="v">{describeClaimError(claimError)}</span>
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
