"use client";

import {useEffect, useState} from "react";

import {ExternalLink, X} from "lucide-react";
import {useReadContract} from "wagmi";

import {addressLink} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {marketRegistryAbi} from "@/lib/contracts/generated";

/**
 * GOVERNANCE STATE badge — F10b.
 *
 * Reads `MarketRegistry.owner()` live and renders one of:
 *
 *   DEMO MODE       (redacted-amber dot)  → owner is the deployer EOA.
 *                                            One-click /create flow is functional.
 *   PRODUCTION MODE (accent-yes dot)      → owner is the 2-of-3 Safe.
 *                                            /create needs Safe co-sign — script-side.
 *   PENDING…        (muted dot)           → owner read in flight.
 *   UNKNOWN OWNER   (redacted-red dot)    → owner is neither (state drift, manual investigation).
 *
 * Click opens a modal explaining the current state and the restoration plan.
 *
 * Surfacing this in the topbar (between FAUCET and theme toggle) means the
 * governance state is visible to anyone using the app — judges see it before
 * reading docs, not after.
 */

type GovernanceState = "demo" | "production" | "pending" | "unknown";

const SAFE_ADDR = addresses.Safe.toLowerCase();
// Deployer EOA — matches the owner() target after `--to-eoa --confirm` lands.
// Read from the `governance_history` entry's `toOwner`. Hardcoded here because
// arb-sepolia.json isn't bundled into the client bundle and the address is
// public on Arbiscan anyway.
const DEPLOYER_EOA = "0xF97933dF45EB549a51Ce4c4e76130c61d08F1ab5".toLowerCase();

export function GovernanceBadge(): React.ReactElement {
  const [open, setOpen] = useState(false);

  const {data: ownerRaw, isLoading} = useReadContract({
    address: addresses.MarketRegistry,
    abi: marketRegistryAbi,
    functionName: "owner",
  });

  const state: GovernanceState = (() => {
    if (isLoading || !ownerRaw) return "pending";
    const owner = String(ownerRaw).toLowerCase();
    if (owner === DEPLOYER_EOA) return "demo";
    if (owner === SAFE_ADDR) return "production";
    return "unknown";
  })();

  const owner = ownerRaw ? String(ownerRaw) : "";

  return (
    <>
      <button
        type="button"
        className="gov-badge"
        data-state={state}
        onClick={() => setOpen(true)}
        aria-label={`Governance state: ${state}`}
        title="Governance state — click for details"
      >
        <span className="gov-dot" aria-hidden />
        <span className="gov-lbl">
          {state === "demo" && "DEMO MODE"}
          {state === "production" && "PRODUCTION MODE"}
          {state === "pending" && "PENDING…"}
          {state === "unknown" && "UNKNOWN OWNER"}
        </span>
      </button>

      {open && <GovernanceModal state={state} owner={owner} onClose={() => setOpen(false)} />}
    </>
  );
}

interface GovernanceModalProps {
  state: GovernanceState;
  owner: string;
  onClose: () => void;
}

function GovernanceModal({state, owner, onClose}: GovernanceModalProps): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <div className="modal-head">
          <div className="modal-stamp">
            <span
              className="stamp"
              style={{
                transform: "rotate(-1deg)",
                color: stampColor(state),
              }}
            >
              {state === "demo" && "GOVERNANCE STATE / DEMO MODE"}
              {state === "production" && "GOVERNANCE STATE / PRODUCTION MODE"}
              {state === "pending" && "GOVERNANCE STATE / READING…"}
              {state === "unknown" && "GOVERNANCE STATE / UNKNOWN"}
            </span>
          </div>
          <h2 className="modal-title">
            {state === "demo" && (
              <>
                Operationally <em>delegated</em>.
              </>
            )}
            {state === "production" && (
              <>
                Multisig <em>guarded</em>.
              </>
            )}
            {state === "pending" && (
              <>
                Reading <em>chain state</em>.
              </>
            )}
            {state === "unknown" && (
              <>
                State <em>drift</em>.
              </>
            )}
          </h2>
        </div>

        <div className="gov-body">
          <div className="gov-kv">
            <span className="k">Contract</span>
            <a
              className="v"
              href={addressLink(addresses.MarketRegistry)}
              target="_blank"
              rel="noopener noreferrer"
            >
              MarketRegistry <ExternalLink size={10} />
            </a>
            <span className="k">Current owner()</span>
            <a
              className="v"
              href={owner ? addressLink(owner) : "#"}
              target="_blank"
              rel="noopener noreferrer"
            >
              {owner ? `${owner.slice(0, 10)}…${owner.slice(-6)}` : "—"} <ExternalLink size={10} />
            </a>
            <span className="k">Production owner</span>
            <a className="v" href={addressLink(addresses.Safe)} target="_blank" rel="noopener noreferrer">
              {addresses.Safe.slice(0, 10)}…{addresses.Safe.slice(-6)} (2-of-3 Safe){" "}
              <ExternalLink size={10} />
            </a>
          </div>

          {state === "demo" && (
            <>
              <p className="gov-lede">
                <strong>Live-judging window only.</strong> Registry ownership is operationally delegated to
                the deployer EOA so the {"/"}create UI can deploy ChainGPT-generated markets in a single
                click. The 2-of-3 Safe pattern (F4.5 hardening) is preserved in the audit trail — it is not
                the current owner during this window.
              </p>
              <p className="gov-lede">Restoration is one script run away:</p>
              <pre className="gov-pre">
                pnpm exec tsx tools/transfer-registry-ownership.ts --to-safe --confirm
              </pre>
              <p className="gov-foot">Open commitments are surfaceable via grep:</p>
              <pre className="gov-pre">
                grep -c &apos;&quot;restoration_pending&quot;: true&apos;
                contracts/deployments/arb-sepolia.json
              </pre>
              <p className="gov-foot">
                Full reasoning: <code>KNOWN_LIMITATIONS.md</code> §registry-ownership-temporary-delegation.
              </p>
            </>
          )}

          {state === "production" && (
            <>
              <p className="gov-lede">
                Registry ownership is held by the 2-of-3 Safe multisig. Admin calls including{" "}
                <code>createMarket(...)</code> require two signatures and a Safe SDK execution path — the{" "}
                {"/"}create UI&apos;s one-click button does not work in this state.
              </p>
              <p className="gov-lede">
                Tools that operate as the Safe: <code>tools/multisig-mint-faucet.ts</code>,{" "}
                <code>tools/create-demo-market.ts</code>, <code>tools/seed-claimable-market.ts</code>.
              </p>
              <p className="gov-foot">To enable the live demo flow, re-delegate:</p>
              <pre className="gov-pre">
                pnpm exec tsx tools/transfer-registry-ownership.ts --to-eoa --confirm
              </pre>
            </>
          )}

          {state === "pending" && (
            <p className="gov-lede">
              Reading <code>MarketRegistry.owner()</code> from Arb Sepolia…
            </p>
          )}

          {state === "unknown" && (
            <>
              <p className="gov-lede">
                <strong>State drift detected.</strong> The on-chain owner of MarketRegistry is neither the
                deployer EOA nor the Safe multisig. Manual investigation required — either ownership was
                transferred to a new address outside the recorded delegation workflow, or the deployer/safe
                addresses in the client bundle are stale relative to the deployment.
              </p>
              <p className="gov-foot">
                Cross-check <code>contracts/deployments/arb-sepolia.json</code> ownership history against the
                Arbiscan transactions page for the registry address.
              </p>
            </>
          )}
        </div>

        <div className="modal-foot">owner() is read live on every page load. Reload to refresh.</div>
      </div>
    </div>
  );
}

function stampColor(state: GovernanceState): string {
  if (state === "demo") return "var(--declassified-amber)";
  if (state === "production") return "var(--accent-yes, #1f5c3d)";
  if (state === "unknown") return "var(--redacted-red)";
  return "var(--fg-muted)";
}
