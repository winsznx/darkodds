"use client";

import {Fragment, Suspense, useEffect, useMemo, useState} from "react";

import {usePrivy} from "@privy-io/react-auth";
import {AlertTriangle, Check, Download, Eye, Upload, X as XIcon} from "lucide-react";
import {useSearchParams} from "next/navigation";
import {createPublicClient, http, isAddress, type Address, type Hex} from "viem";
import {arbitrumSepolia} from "viem/chains";

import "./audit.css";

import {ARB_SEPOLIA_RPC_URL, addressLink, txLink} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {claimVerifierAbi} from "@/lib/contracts/generated";
import type {AttestationEnvelope} from "@/lib/attestation/types";

type Tab = "generate" | "verify";
type GenerateState =
  | {phase: "idle"}
  | {phase: "loading"}
  | {phase: "ok"; envelope: AttestationEnvelope}
  | {phase: "error"; message: string};

interface VerifyDecoded {
  user: Address;
  marketId: bigint;
  outcome: number;
  payoutCommitment: Hex;
  timestamp: bigint;
  recipient: Address;
  nonce: bigint;
}

type VerifyState =
  | {phase: "idle"}
  | {phase: "loading"}
  | {
      phase: "valid";
      decoded: VerifyDecoded;
      bearer: boolean;
      /** Fields where the JSON `payload` disagrees with the on-chain decode of
       *  `encodedData`. Empty when the envelope is internally consistent. */
      mismatches: PayloadMismatch[];
    }
  | {phase: "invalid"; message: string};

interface PayloadMismatch {
  field: string;
  pasted: string;
  decoded: string;
}

/**
 * Compares the human-readable `payload` JSON to the on-chain decode of
 * `encodedData`. The contract treats `payload` as decorative — only
 * `encodedData` and `signature` are cryptographically validated. A diff
 * here means someone edited the JSON to misrepresent what's in the signed
 * payload; the on-chain values are still authoritative.
 */
function diffPayloadVsDecoded(envelope: AttestationEnvelope, decoded: VerifyDecoded): PayloadMismatch[] {
  const out: PayloadMismatch[] = [];
  const p = envelope.payload;
  const checks: Array<[string, string, string]> = [
    ["user", p.user.toLowerCase(), decoded.user.toLowerCase()],
    ["marketId", p.marketId, decoded.marketId.toString()],
    ["outcome", String(p.outcome), String(decoded.outcome)],
    ["payoutCommitment", p.payoutCommitment.toLowerCase(), decoded.payoutCommitment.toLowerCase()],
    ["timestamp", p.timestamp, decoded.timestamp.toString()],
    ["recipient", p.recipient.toLowerCase(), decoded.recipient.toLowerCase()],
    ["nonce", p.nonce, decoded.nonce.toString()],
  ];
  for (const [field, pasted, dec] of checks) {
    if (pasted !== dec) out.push({field, pasted, decoded: dec});
  }
  return out;
}

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

const publicClient = createPublicClient({chain: arbitrumSepolia, transport: http(ARB_SEPOLIA_RPC_URL)});

function outcomeLabel(o: number): string {
  if (o === 0) return "NO";
  if (o === 1) return "YES";
  if (o === 2) return "INVALID";
  return `UNKNOWN(${o})`;
}

function fmtTime(unix: bigint): string {
  return new Date(Number(unix) * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/**
 * /audit — selective-disclosure attestation generator + verifier.
 *
 *  - Generate: signs an attestation server-side (`/api/attestation/generate`)
 *    keyed off a settled claim tx hash. Recipient-bound by default; bearer
 *    mode is opt-in with explicit warning per PRD §9.5.
 *  - Verify: pastes an attestation JSON, calls `ClaimVerifier.verifyAttestation`
 *    via eth_call, surfaces VALID + decoded fields or INVALID + reason.
 *
 *  URL params (when arriving from ClaimModal success state):
 *    ?marketId=<id>&tx=<hash>  → opens GENERATE tab pre-filled
 *  Otherwise defaults to VERIFY tab.
 */
function AuditInner(): React.ReactElement {
  const search = useSearchParams();
  const {user} = usePrivy();
  const userAddress = user?.wallet?.address as Address | undefined;

  const incomingMarketId = search.get("marketId");
  const incomingTx = search.get("tx") as Hex | null;
  const cameFromClaim = Boolean(incomingMarketId && incomingTx);

  const [tab, setTab] = useState<Tab>(cameFromClaim ? "generate" : "verify");

  // ── GENERATE state ────────────────────────────────────────
  const [marketId, setMarketId] = useState(incomingMarketId ?? "");
  const [claimTx, setClaimTx] = useState<string>(incomingTx ?? "");
  const [bearer, setBearer] = useState(false);
  const [recipient, setRecipient] = useState<string>("");
  const [genState, setGenState] = useState<GenerateState>({phase: "idle"});

  useEffect(() => {
    if (!userAddress || recipient) return;
    const t = setTimeout(() => setRecipient(userAddress), 0);
    return () => clearTimeout(t);
  }, [userAddress, recipient]);

  async function handleGenerate(): Promise<void> {
    if (!marketId.trim() || !claimTx.trim()) {
      setGenState({phase: "error", message: "marketId and claimTx are both required"});
      return;
    }
    if (!bearer && !isAddress(recipient)) {
      setGenState({phase: "error", message: "Recipient address is invalid (or toggle BEARER MODE)"});
      return;
    }
    setGenState({phase: "loading"});
    try {
      const res = await fetch("/api/attestation/generate", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          marketId: marketId.trim(),
          claimTx: claimTx.trim(),
          bearer,
          recipient: bearer ? undefined : recipient,
        }),
      });
      const data = (await res.json()) as Partial<AttestationEnvelope> & {error?: string};
      if (!res.ok || !("payload" in data) || !data.payload) {
        setGenState({phase: "error", message: data.error ?? "Server returned no envelope"});
        return;
      }
      setGenState({phase: "ok", envelope: data as AttestationEnvelope});
    } catch (err) {
      setGenState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleDownload(envelope: AttestationEnvelope): void {
    const json = JSON.stringify(envelope, null, 2);
    const blob = new Blob([json], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const truncatedAddr = envelope.payload.user.slice(0, 6) + envelope.payload.user.slice(-4);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attestation-${envelope.payload.marketId}-${truncatedAddr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── VERIFY state ──────────────────────────────────────────
  const [pasted, setPasted] = useState<string>("");
  const [verifyState, setVerifyState] = useState<VerifyState>({phase: "idle"});

  async function handleVerify(): Promise<void> {
    let envelope: AttestationEnvelope;
    try {
      envelope = JSON.parse(pasted) as AttestationEnvelope;
    } catch {
      setVerifyState({phase: "invalid", message: "Pasted text is not valid JSON"});
      return;
    }
    if (!envelope.encodedData || !envelope.signature) {
      setVerifyState({
        phase: "invalid",
        message: "Envelope missing required fields (encodedData, signature)",
      });
      return;
    }
    setVerifyState({phase: "loading"});
    try {
      const result = (await publicClient.readContract({
        address: addresses.ClaimVerifier,
        abi: claimVerifierAbi,
        functionName: "verifyAttestation",
        args: [envelope.encodedData as Hex, envelope.signature as Hex],
      })) as readonly [Address, bigint, number, Hex, bigint, Address, bigint];
      const [u, mid, oc, pc, ts, rec, nonce] = result;
      const decoded: VerifyDecoded = {
        user: u,
        marketId: mid,
        outcome: oc,
        payoutCommitment: pc,
        timestamp: ts,
        recipient: rec,
        nonce,
      };
      setVerifyState({
        phase: "valid",
        decoded,
        bearer: rec === ZERO_ADDRESS,
        mismatches: diffPayloadVsDecoded(envelope, decoded),
      });
    } catch (err) {
      const baseMsg = err instanceof Error ? err.message : String(err);
      // viem `ContractFunctionRevertedError` exposes the custom error name in
      // .data — surface it cleanly when present.
      const short =
        (err as {shortMessage?: string} | null)?.shortMessage ??
        baseMsg.split("\n")[0]?.slice(0, 200) ??
        "verification reverted";
      setVerifyState({phase: "invalid", message: short});
    }
  }

  function handlePasteFromFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setPasted(text);
    };
    reader.readAsText(file);
  }

  // ── Auto-pre-fill verify if user pasted just-generated envelope ──
  const generatedJson = useMemo(() => {
    if (genState.phase !== "ok") return null;
    return JSON.stringify(genState.envelope, null, 2);
  }, [genState]);

  return (
    <>
      <header className="page-header">
        <h1 className="h">
          Audit <em>trail.</em>
        </h1>
        <span className="meta">Selective disclosure</span>
      </header>

      <section className="au-body">
        <div className="au-tabs" role="tablist">
          <button
            type="button"
            className="au-tab"
            data-active={tab === "generate"}
            onClick={() => setTab("generate")}
            role="tab"
          >
            {"// GENERATE"}
          </button>
          <button
            type="button"
            className="au-tab"
            data-active={tab === "verify"}
            onClick={() => setTab("verify")}
            role="tab"
          >
            {"// VERIFY"}
          </button>
        </div>

        {/* ─── GENERATE TAB ─── */}
        {tab === "generate" && (
          <div className="au-panel">
            <div>
              <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
                ATTESTATION // SELECTIVE-DISCLOSURE
              </span>
            </div>
            <p className="lede">
              Generate a portable JSON attestation for a settled claim. Signed server-side by the pinned{" "}
              <code style={{fontFamily: "var(--font-mono)"}}>attestationSigner</code> (TEE in production,
              deployer EOA on testnet). Anyone holding the file can verify it on-chain via{" "}
              <code style={{fontFamily: "var(--font-mono)"}}>ClaimVerifier.verifyAttestation</code>.
            </p>

            <div className="au-row-2">
              <div className="au-field">
                <label>Market ID</label>
                <input
                  type="text"
                  className="au-input"
                  value={marketId}
                  onChange={(e) => setMarketId(e.target.value)}
                  placeholder="14"
                />
              </div>
              <div className="au-field">
                <label>Claim transaction hash</label>
                <input
                  type="text"
                  className="au-input"
                  value={claimTx}
                  onChange={(e) => setClaimTx(e.target.value)}
                  placeholder="0x..."
                />
              </div>
            </div>

            <div className="au-field">
              <label>Recipient (recipient-bound mode)</label>
              <input
                type="text"
                className="au-input"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x..."
                disabled={bearer}
              />
            </div>

            <div className="au-bearer-toggle">
              <label>
                <input type="checkbox" checked={bearer} onChange={(e) => setBearer(e.target.checked)} />
                BEARER MODE — anyone holding this JSON can verify
              </label>
              <p className="au-bearer-warning">
                {
                  '// Bearer mode produces an attestation with recipient = 0x000…000. The intended-audience field is wiped, so anyone who receives the file passes verification. Use ONLY for public proofs ("I won, here\'s evidence").'
                }
              </p>
            </div>

            <div className="au-cta-row">
              <button
                type="button"
                className="au-cta"
                onClick={() => void handleGenerate()}
                disabled={genState.phase === "loading"}
              >
                <Eye size={12} />
                {genState.phase === "loading" ? "GENERATING..." : "GENERATE ATTESTATION"}
              </button>
            </div>

            {genState.phase === "error" && (
              <p className="au-error">
                {"// ERROR: "}
                {genState.message}
              </p>
            )}

            {genState.phase === "ok" && (
              <div className="au-result-valid">
                <h2>{"// SIGNED ATTESTATION"}</h2>
                <div className="au-kv" style={{marginTop: 8}}>
                  <span className="k">User</span>
                  <span className="v">
                    <a
                      href={addressLink(genState.envelope.payload.user)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {genState.envelope.payload.user}
                    </a>
                  </span>
                  <span className="k">Market</span>
                  <span className="v">#{genState.envelope.payload.marketId}</span>
                  <span className="k">Outcome</span>
                  <span className="v">{outcomeLabel(genState.envelope.payload.outcome)}</span>
                  <span className="k">Recipient</span>
                  <span className="v">
                    {genState.envelope.mode === "bearer"
                      ? "BEARER (0x000…000)"
                      : genState.envelope.payload.recipient}
                  </span>
                  <span className="k">Timestamp</span>
                  <span className="v">{fmtTime(BigInt(genState.envelope.payload.timestamp))}</span>
                  <span className="k">Signer</span>
                  <span className="v">{genState.envelope.signer}</span>
                  <span className="k">Source tx</span>
                  <span className="v">
                    <a
                      href={txLink(genState.envelope.sourceClaimTx)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {genState.envelope.sourceClaimTx.slice(0, 18)}… ↗
                    </a>
                  </span>
                </div>

                <div className="au-cta-row" style={{marginTop: 12}}>
                  <button type="button" className="au-cta" onClick={() => handleDownload(genState.envelope)}>
                    <Download size={12} />
                    DOWNLOAD JSON
                  </button>
                  <button
                    type="button"
                    className="au-cta au-cta--secondary"
                    onClick={() => {
                      setPasted(generatedJson ?? "");
                      setTab("verify");
                    }}
                  >
                    VERIFY THIS ATTESTATION →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── VERIFY TAB ─── */}
        {tab === "verify" && (
          <div className="au-panel">
            <div>
              <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)"}}>
                {"VERIFY / ON-CHAIN"}
              </span>
            </div>
            <p className="lede">
              Paste an attestation JSON below. The page calls{" "}
              <code style={{fontFamily: "var(--font-mono)"}}>ClaimVerifier.verifyAttestation</code> via{" "}
              <code style={{fontFamily: "var(--font-mono)"}}>eth_call</code> (no gas, view-only) and surfaces
              the recovered fields if the signature recovers to the pinned signer AND the TDX measurement
              matches.
            </p>

            <div className="au-field">
              <label>Attestation JSON</label>
              <textarea
                className="au-textarea"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={'{"payload": {...}, "encodedData": "0x...", "signature": "0x...", ...}'}
                spellCheck={false}
              />
            </div>

            <div className="au-cta-row">
              <button
                type="button"
                className="au-cta"
                onClick={() => void handleVerify()}
                disabled={!pasted.trim() || verifyState.phase === "loading"}
              >
                <Check size={12} />
                {verifyState.phase === "loading" ? "VERIFYING..." : "VERIFY ON-CHAIN"}
              </button>
              <label className="au-cta au-cta--secondary" htmlFor="au-file" style={{cursor: "pointer"}}>
                <Upload size={12} /> LOAD .JSON FILE
                <input
                  id="au-file"
                  type="file"
                  accept="application/json,.json"
                  style={{display: "none"}}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePasteFromFile(f);
                  }}
                />
              </label>
              <button
                type="button"
                className="au-cta au-cta--secondary"
                onClick={() => {
                  setPasted("");
                  setVerifyState({phase: "idle"});
                }}
                disabled={!pasted.trim() && verifyState.phase === "idle"}
              >
                CLEAR
              </button>
            </div>

            {verifyState.phase === "invalid" && (
              <div className="au-result-invalid">
                <div className="au-result-stamp">
                  <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
                    INVALID
                  </span>
                  <XIcon size={14} style={{color: "var(--redacted-red)"}} />
                </div>
                <p className="au-error" style={{marginTop: 8}}>
                  {"// "}
                  {verifyState.message}
                </p>
              </div>
            )}

            {verifyState.phase === "valid" && (
              <div className="au-result-valid">
                <div className="au-result-stamp">
                  <span
                    className="stamp"
                    style={{transform: "rotate(-1deg)", color: "var(--accent-yes, #1f5c3d)"}}
                  >
                    {"VALID / PINNED SIGNER + MEASUREMENT"}
                  </span>
                  <Check size={14} style={{color: "var(--accent-yes, #1f5c3d)"}} />
                </div>

                {verifyState.mismatches.length > 0 && (
                  <div className="au-bearer-toggle" style={{marginTop: 12}}>
                    <label style={{cursor: "default"}}>
                      <AlertTriangle size={12} />
                      PAYLOAD MISMATCH — JSON EDITED, ON-CHAIN TRUTH SHOWN BELOW
                    </label>
                    <p className="au-bearer-warning">
                      {`// The signature is valid against \`encodedData\`, but the human-readable \`payload\` JSON disagrees in ${verifyState.mismatches.length} field${verifyState.mismatches.length === 1 ? "" : "s"}. The contract only validates \`encodedData\` + \`signature\` — \`payload\` is decorative. The decoded fields below are the AUTHORITATIVE values from the signed envelope.`}
                    </p>
                    <div
                      className="au-kv"
                      style={{
                        marginTop: 4,
                        gridTemplateColumns: "minmax(140px, max-content) 1fr 1fr",
                        borderColor: "var(--declassified-amber)",
                      }}
                    >
                      <span className="k">FIELD</span>
                      <span className="k">PASTED (LIE)</span>
                      <span className="k">DECODED (TRUTH)</span>
                      {verifyState.mismatches.map((m) => (
                        <Fragment key={m.field}>
                          <span className="v" style={{color: "var(--declassified-amber)"}}>
                            {m.field}
                          </span>
                          <span
                            className="v"
                            style={{textDecoration: "line-through", color: "var(--fg-muted)"}}
                          >
                            {m.pasted}
                          </span>
                          <span className="v">{m.decoded}</span>
                        </Fragment>
                      ))}
                    </div>
                  </div>
                )}

                <div className="au-kv" style={{marginTop: 12}}>
                  <span className="k">User</span>
                  <span className="v">
                    <a href={addressLink(verifyState.decoded.user)} target="_blank" rel="noopener noreferrer">
                      {verifyState.decoded.user}
                    </a>
                  </span>
                  <span className="k">Market</span>
                  <span className="v">#{verifyState.decoded.marketId.toString()}</span>
                  <span className="k">Outcome</span>
                  <span className="v">{outcomeLabel(verifyState.decoded.outcome)}</span>
                  <span className="k">Payout commitment</span>
                  <span className="v">{verifyState.decoded.payoutCommitment}</span>
                  <span className="k">Timestamp</span>
                  <span className="v">{fmtTime(verifyState.decoded.timestamp)}</span>
                  <span className="k">Recipient</span>
                  <span className="v">
                    {verifyState.bearer ? "BEARER (0x000…000)" : verifyState.decoded.recipient}
                  </span>
                  <span className="k">Nonce</span>
                  <span className="v">{verifyState.decoded.nonce.toString()}</span>
                  <span className="k">Verifier</span>
                  <span className="v">
                    <a href={addressLink(addresses.ClaimVerifier)} target="_blank" rel="noopener noreferrer">
                      {addresses.ClaimVerifier}
                    </a>
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}

export default function AuditPage(): React.ReactElement {
  return (
    <Suspense fallback={<div className="au-status">LOADING…</div>}>
      <AuditInner />
    </Suspense>
  );
}
