"use client";

import {useEffect, useState} from "react";

import {ArrowRight, Cpu, Loader} from "lucide-react";
import {useRouter} from "next/navigation";
import {decodeEventLog} from "viem";
import {useAccount, useWaitForTransactionReceipt, useWriteContract} from "wagmi";

import "./create.css";

import {txLink} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {marketRegistryAbi} from "@/lib/contracts/generated";
import type {GenerateMarketParams} from "@/app/api/chaingpt/generate-market/route";

const ORACLE_LABELS: Record<number, string> = {
  0: "Admin-resolved (sports / events)",
  1: "Chainlink price feed (crypto prices)",
  2: "Pre-resolved (demo / historical)",
};

const EXAMPLE_PROMPT = "BTC closes above $150,000 by December 31 2026 UTC, resolved by Chainlink price feed.";

function tsToDatetimeLocal(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToTs(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000);
}

export default function CreatePage(): React.ReactElement {
  const router = useRouter();
  const {isConnected} = useAccount();

  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [params, setParams] = useState<GenerateMarketParams | null>(null);

  const [question, setQuestion] = useState("");
  const [criteria, setCriteria] = useState("");
  const [oracleType, setOracleType] = useState<0 | 1 | 2>(0);
  const [expiryDatetime, setExpiryDatetime] = useState("");
  const [feeBps, setFeeBps] = useState(200);

  const {
    writeContract,
    data: txHash,
    isPending: txPending,
    error: txError,
    reset: txReset,
  } = useWriteContract();
  const {
    isLoading: txConfirming,
    isSuccess: txSuccess,
    data: receipt,
  } = useWaitForTransactionReceipt({hash: txHash});

  useEffect(() => {
    if (!txSuccess || !receipt) return;
    const log = receipt.logs.find((l) => {
      try {
        const decoded = decodeEventLog({abi: marketRegistryAbi, ...l});
        return decoded.eventName === "MarketCreated";
      } catch {
        return false;
      }
    });
    if (log) {
      try {
        const decoded = decodeEventLog({abi: marketRegistryAbi, ...log});
        if (decoded.eventName === "MarketCreated") {
          const id = (decoded.args as {id: bigint}).id;
          router.push(`/markets/${id.toString()}`);
          return;
        }
      } catch {
        // fallback
      }
    }
    router.push("/markets");
  }, [txSuccess, receipt, router]);

  async function handleGenerate(): Promise<void> {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGenerateError(null);
    setParams(null);
    txReset();

    try {
      const res = await fetch("/api/chaingpt/generate-market", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({prompt}),
      });
      const json = (await res.json()) as {params?: GenerateMarketParams; error?: string};
      if (!res.ok || !json.params) {
        setGenerateError(json.error ?? "ChainGPT returned no params");
        return;
      }
      setParams(json.params);
      setQuestion(json.params.question);
      setCriteria(json.params.resolutionCriteria);
      setOracleType(json.params.oracleType);
      setExpiryDatetime(tsToDatetimeLocal(json.params.expiryTs));
      setFeeBps(json.params.protocolFeeBps);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Network error");
    } finally {
      setGenerating(false);
    }
  }

  function handleDeploy(): void {
    const expiryTs = datetimeLocalToTs(expiryDatetime);
    writeContract({
      address: addresses.MarketRegistry,
      abi: marketRegistryAbi,
      functionName: "createMarket",
      args: [question, criteria, oracleType, BigInt(expiryTs), BigInt(feeBps)],
    });
  }

  const canDeploy =
    params !== null &&
    question.trim().length > 0 &&
    criteria.trim().length > 0 &&
    expiryDatetime.length > 0 &&
    !txPending &&
    !txConfirming &&
    !txSuccess;

  return (
    <>
      <header className="page-header">
        <h1 className="h">
          Generate <em>market.</em>
        </h1>
        <span className="meta">Powered by ChainGPT</span>
      </header>

      <section className="create-body">
        <div className="create-prompt-panel">
          <h2>{"// Describe your market in natural language"}</h2>
          <textarea
            className="create-prompt-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={EXAMPLE_PROMPT}
            rows={4}
          />
          <div className="create-generate-row">
            <button
              type="button"
              className="create-cta"
              onClick={() => void handleGenerate()}
              disabled={!prompt.trim() || generating}
            >
              <Cpu size={12} />
              GENERATE WITH CHAINGPT
            </button>
            {generating && (
              <span className="create-generating">
                <Loader size={12} />
                Calling ChainGPT…
              </span>
            )}
          </div>
          {generateError && (
            <p className="create-error">
              {"// ERROR: "}
              {generateError}
            </p>
          )}
        </div>

        {params !== null && (
          <div className="create-params-panel">
            <h2>{"// Review + edit market parameters"}</h2>

            <div className="create-field">
              <label>Question</label>
              <input
                type="text"
                className="create-input"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Will BTC close above $150k by Dec 31?"
              />
            </div>

            <div className="create-field">
              <label>Resolution criteria</label>
              <textarea
                className="create-textarea"
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="How will this market be resolved YES or NO?"
              />
            </div>

            <div className="create-row-2">
              <div className="create-field">
                <label>Oracle type</label>
                <select
                  className="create-select"
                  value={oracleType}
                  onChange={(e) => setOracleType(Number(e.target.value) as 0 | 1 | 2)}
                >
                  {Object.entries(ORACLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {k} — {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="create-field">
                <label>Protocol fee (bps)</label>
                <input
                  type="number"
                  className="create-input"
                  value={feeBps}
                  min={50}
                  max={500}
                  onChange={(e) => setFeeBps(Math.min(500, Math.max(50, Number(e.target.value))))}
                />
              </div>
            </div>

            <div className="create-field">
              <label>Expiry (local time)</label>
              <input
                type="datetime-local"
                className="create-input"
                value={expiryDatetime}
                onChange={(e) => setExpiryDatetime(e.target.value)}
              />
            </div>

            <div className="create-deploy-section">
              <p className="create-deploy-note">
                <strong>Admin-only</strong> — connected wallet must be the MarketRegistry owner. Deploys to{" "}
                <strong>Arb Sepolia</strong>.
              </p>

              {!isConnected && (
                <p className="create-deploy-note" style={{color: "var(--fg-muted)"}}>
                  Connect wallet to deploy.
                </p>
              )}

              {isConnected && (
                <button
                  type="button"
                  className="create-cta"
                  onClick={handleDeploy}
                  disabled={!canDeploy}
                  style={{alignSelf: "flex-start"}}
                >
                  <ArrowRight size={12} />
                  DEPLOY MARKET
                </button>
              )}

              {(txPending || txConfirming) && (
                <div className="create-tx-status">
                  <Loader size={12} />
                  {txPending ? "Waiting for wallet signature…" : "Confirming on-chain…"}
                  {txHash && (
                    <a className="tx-hash" href={txLink(txHash)} target="_blank" rel="noopener noreferrer">
                      {txHash.slice(0, 14)}… ↗
                    </a>
                  )}
                </div>
              )}

              {txError && (
                <p className="create-error">
                  {"// TX ERROR: "}
                  {txError.message.slice(0, 200)}
                </p>
              )}

              {txSuccess && (
                <div className="create-tx-status" style={{color: "var(--fg)"}}>
                  Market deployed — redirecting…
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
