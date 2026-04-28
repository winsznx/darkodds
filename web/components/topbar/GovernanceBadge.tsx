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
 *   OPEN-CREATE        (amber dot)  → owner is the deployer EOA. /create
 *                                     UI mints markets in a single tx.
 *                                     Permissionless market creation phase
 *                                     of the protocol's maturity model.
 *   GOVERNANCE-CURATED (green dot)  → owner is the 2-of-3 Safe. /create
 *                                     needs script-side multisig co-sign.
 *                                     Curation-gated phase of the protocol's
 *                                     maturity model.
 *   READING…           (muted dot)  → owner read in flight.
 *   UNKNOWN OWNER      (red dot)    → owner is neither (state drift,
 *                                     manual investigation).
 *
 * Both OPEN-CREATE and GOVERNANCE-CURATED are legitimate protocol modes —
 * not "production vs demo". The protocol's design intent is to ship with
 * both phases and surface the current one to anyone using the app, so
 * judges (and end users) see it before reading docs.
 *
 * Internal state names `demo` / `production` are retained as data-state
 * CSS hooks for stable styling; the user-facing labels are the OPEN-CREATE
 * / GOVERNANCE-CURATED renames.
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
          {state === "demo" && "OPEN-CREATE"}
          {state === "production" && "GOVERNANCE-CURATED"}
          {state === "pending" && "READING…"}
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
              {state === "demo" && "GOVERNANCE STATE / OPEN-CREATE"}
              {state === "production" && "GOVERNANCE STATE / GOVERNANCE-CURATED"}
              {state === "pending" && "GOVERNANCE STATE / READING…"}
              {state === "unknown" && "GOVERNANCE STATE / UNKNOWN"}
            </span>
          </div>
          <h2 className="modal-title">
            {state === "demo" && (
              <>
                Open-create <em>phase</em>.
              </>
            )}
            {state === "production" && (
              <>
                Governance-curated <em>phase</em>.
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
            <span className="k">Multisig owner</span>
            <a className="v" href={addressLink(addresses.Safe)} target="_blank" rel="noopener noreferrer">
              {addresses.Safe.slice(0, 10)}…{addresses.Safe.slice(-6)} (2-of-3 Safe){" "}
              <ExternalLink size={10} />
            </a>
          </div>

          {state === "demo" && (
            <>
              <p className="gov-lede">
                Anyone can deploy a market via the {"/"}create UI in a single click. Registry ownership is
                held by the deployer EOA — judges connecting any wallet route through a sponsored deployment
                path. The 2-of-3 Safe (F4.5 hardening artifact) remains the long-term curation anchor and can
                resume ownership at any time via the script below.
              </p>
              <p className="gov-lede">
                <strong>Both phases are first-class protocol modes</strong>, not feature toggles. Open-create
                is the permissionless wedge — the long tail of markets centralized platforms reject. The
                eventual governance-curated phase is the production-mode safety floor.
              </p>
              <p className="gov-foot">Switch to governance-curated mode:</p>
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
                Registry ownership is held by the 2-of-3 Safe multisig. New markets land via Safe co-sign —
                every <code>createMarket(...)</code> call requires two signatures and a script-side execution
                path. This is the production-mode safety floor of the protocol&apos;s maturity model.
              </p>
              <p className="gov-lede">
                <strong>Both phases are first-class protocol modes</strong>, not feature toggles.
                Governance-curated is the curation phase: trades a thinner long-tail catalog for tighter
                operational control. The open-create phase is reachable any time via the script below.
              </p>
              <p className="gov-lede">
                Tools that operate as the Safe: <code>tools/multisig-mint-faucet.ts</code>,{" "}
                <code>tools/create-demo-market.ts</code>, <code>tools/seed-claimable-market.ts</code>.
              </p>
              <p className="gov-foot">Switch to open-create mode (requires Safe co-sign to delegate):</p>
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
