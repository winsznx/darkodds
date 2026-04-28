"use client";

import {Suspense, useEffect, useState} from "react";

import {ArrowRight, Cpu, ExternalLink, Loader, Shield} from "lucide-react";
import {useRouter, useSearchParams} from "next/navigation";
import {decodeEventLog, encodeFunctionData, type Hex} from "viem";
import {useAccount, useWaitForTransactionReceipt} from "wagmi";

import "./create.css";

import {txLink} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {marketRegistryAbi} from "@/lib/contracts/generated";
import {getArbSepoliaFeeOverrides} from "@/lib/contracts/fees";
import {useBetClients} from "@/lib/nox/client-hook";
import type {GenerateMarketParams} from "@/app/api/chaingpt/generate-market/route";

// Deployer EOA — the address that holds operationally-delegated ownership of
// MarketRegistry during the live-judging window. Connecting wallets that
// match this address use the direct on-chain path (their tx, their gas).
// Non-matching wallets route through `/api/admin/deploy-market` which signs
// server-side with DEPLOYER_PRIVATE_KEY ("sponsored deployment"). After
// `--to-safe` restoration this changes to the Safe address; the API
// surfaces a 503 with restoration guidance and the page falls back to a
// "deploys are gated" disclosure.
const DEPLOYER_EOA = "0xF97933dF45EB549a51Ce4c4e76130c61d08F1ab5".toLowerCase();

const ORACLE_LABELS: Record<number, string> = {
  0: "Admin-resolved (sports / events)",
  1: "Chainlink price feed (crypto prices)",
  2: "Pre-resolved (demo / historical)",
};

const EXAMPLE_PROMPT = "BTC closes above $150,000 by December 31 2026 UTC, resolved by Chainlink price feed.";

interface PolymarketMirrorSeed {
  id: string;
  question: string;
  endDate: string | null;
  url: string;
  category: string | null;
}

/**
 * Builds the natural-language prompt fed into ChainGPT when the user clicks
 * "MIRROR ON DARKODDS" on a Polymarket card. Polymarket's Gamma API doesn't
 * expose a structured `resolutionCriteria` field on every market, so we
 * fall back to "as defined by the source Polymarket market" — ChainGPT
 * fills the gap intelligently and the user can edit before deploying.
 */
function buildMirrorPrompt(seed: PolymarketMirrorSeed): string {
  const endDateLine = seed.endDate
    ? `End date: ${new Date(seed.endDate).toUTCString()}.`
    : "End date: not specified — choose a reasonable expiry.";
  return [
    `Create a DarkOdds prediction market mirroring this Polymarket question:`,
    ``,
    `"${seed.question}"`,
    ``,
    `Resolution criteria: as defined by the source Polymarket market${seed.url ? ` (${seed.url})` : ""}.`,
    endDateLine,
  ].join("\n");
}

function tsToDatetimeLocal(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToTs(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000);
}

type DeployPhase = "idle" | "submitting" | "confirming" | "success" | "error";
type DeployRoute = "self" | "sponsored";

interface DeployState {
  phase: DeployPhase;
  txHash: Hex | null;
  marketId: string | null;
  route: DeployRoute | null;
  errorMessage: string | null;
}

function CreateInner(): React.ReactElement {
  const router = useRouter();
  const search = useSearchParams();
  const {isConnected, address: connectedAddress} = useAccount();
  const {walletClient, publicClient, ready: clientsReady} = useBetClients();

  const polymarketSourceId = search.get("source") === "polymarket" ? search.get("id") : null;
  const [mirrorSeed, setMirrorSeed] = useState<PolymarketMirrorSeed | null>(null);
  const [mirrorError, setMirrorError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [params, setParams] = useState<GenerateMarketParams | null>(null);

  const [question, setQuestion] = useState("");
  const [criteria, setCriteria] = useState("");
  const [oracleType, setOracleType] = useState<0 | 1 | 2>(0);
  const [expiryDatetime, setExpiryDatetime] = useState("");
  const [feeBps, setFeeBps] = useState(200);

  const [deploy, setDeploy] = useState<DeployState>({
    phase: "idle",
    txHash: null,
    marketId: null,
    route: null,
    errorMessage: null,
  });

  // Whether the connected wallet is the operationally-delegated registry
  // owner. Drives the deploy-route decision: self-sign vs sponsored.
  const isDeployer = connectedAddress !== undefined && connectedAddress.toLowerCase() === DEPLOYER_EOA;

  // Receipt poller for self-sign deploys. Sponsored deploys get the
  // marketId back inline from the API response, no client-side polling.
  const {isSuccess: txSuccess, data: receipt} = useWaitForTransactionReceipt({
    hash: deploy.route === "self" && deploy.txHash ? deploy.txHash : undefined,
  });

  // ─── Polymarket → DarkOdds clone prefill (Model C wedge) ────────────
  // When the user lands here via "MIRROR ON DARKODDS" on /markets, we fetch
  // the source Polymarket market server-side via /api/polymarket/market/[id]
  // and seed the ChainGPT prompt textarea with a mirror template. The user
  // can edit before generating — ChainGPT then converts the natural-language
  // prompt into structured DarkOdds params (question / resolutionCriteria /
  // oracleType / expiryTs / feeBps).
  useEffect(() => {
    if (!polymarketSourceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/polymarket/market/${polymarketSourceId}`);
        const json = (await res.json()) as
          | {ok: true; data: PolymarketMirrorSeed}
          | {ok: false; error: string};
        if (cancelled) return;
        if (!json.ok) {
          setMirrorError(json.error);
          return;
        }
        setMirrorSeed(json.data);
        setPrompt(buildMirrorPrompt(json.data));
        setMirrorError(null);
      } catch (err) {
        if (cancelled) return;
        setMirrorError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [polymarketSourceId]);

  // Self-sign confirmation: wagmi confirms the receipt → parse MarketCreated
  // for the new market id and transition to success. Sponsored deploys get
  // the marketId back inline from the API and short-circuit this path.
  useEffect(() => {
    if (deploy.route !== "self" || !txSuccess || !receipt) return;
    let id: bigint | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({abi: marketRegistryAbi, ...log});
        if (decoded.eventName === "MarketCreated") {
          id = (decoded.args as {id: bigint}).id;
          break;
        }
      } catch {
        // not our event
      }
    }
    setDeploy((d) => ({
      ...d,
      phase: "success",
      marketId: id !== null ? id.toString() : null,
    }));
  }, [deploy.route, txSuccess, receipt]);

  // After we land in `success` with a marketId, navigate to the new detail
  // page. Brief delay so the success stamp is visible first.
  useEffect(() => {
    if (deploy.phase !== "success") return;
    const t = setTimeout(() => {
      router.push(deploy.marketId ? `/markets/${deploy.marketId}` : "/markets");
    }, 1500);
    return () => clearTimeout(t);
  }, [deploy.phase, deploy.marketId, router]);

  async function handleGenerate(): Promise<void> {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGenerateError(null);
    setParams(null);
    setDeploy({phase: "idle", txHash: null, marketId: null, route: null, errorMessage: null});

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

  async function handleDeploy(): Promise<void> {
    const expiryTs = datetimeLocalToTs(expiryDatetime);
    setDeploy({
      phase: "submitting",
      txHash: null,
      marketId: null,
      route: isDeployer ? "self" : "sponsored",
      errorMessage: null,
    });

    if (isDeployer) {
      // Self-sign path. Use the same walletClient.sendTransaction +
      // explicit fee-overrides pattern as lib/bet/place-bet.ts so
      // wallet-side estimators that respect dApp-supplied fees won't
      // hit the Arb Sepolia stale-basefee revert.
      if (!clientsReady || !walletClient?.account || !publicClient) {
        setDeploy((d) => ({...d, phase: "error", errorMessage: "wallet client not ready"}));
        return;
      }
      try {
        const data = encodeFunctionData({
          abi: marketRegistryAbi,
          functionName: "createMarket",
          args: [question, criteria, oracleType, BigInt(expiryTs), BigInt(feeBps)],
        });
        const fees = await getArbSepoliaFeeOverrides(publicClient);
        const txHash = (await walletClient.sendTransaction({
          account: walletClient.account.address,
          chain: walletClient.chain ?? null,
          to: addresses.MarketRegistry,
          data,
          ...fees,
        })) as Hex;
        setDeploy((d) => ({...d, phase: "confirming", txHash}));
      } catch (err) {
        setDeploy((d) => ({
          ...d,
          phase: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        }));
      }
      return;
    }

    // Sponsored path — server signs with the deployer EOA.
    try {
      const res = await fetch("/api/admin/deploy-market", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          question,
          resolutionCriteria: criteria,
          oracleType,
          expiryTs,
          protocolFeeBps: feeBps,
        }),
      });
      const json = (await res.json()) as
        | {ok: true; marketId: string; marketAddress: string; txHash: Hex; sponsored: true}
        | {ok: false; error: string; txHash?: Hex};
      if (!json.ok) {
        setDeploy((d) => ({
          ...d,
          phase: "error",
          txHash: "txHash" in json && json.txHash ? json.txHash : null,
          errorMessage: json.error,
        }));
        return;
      }
      setDeploy({
        phase: "success",
        txHash: json.txHash,
        marketId: json.marketId,
        route: "sponsored",
        errorMessage: null,
      });
    } catch (err) {
      setDeploy((d) => ({
        ...d,
        phase: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  const txError = deploy.phase === "error" ? new Error(deploy.errorMessage ?? "deploy failed") : null;
  const txHash = deploy.txHash;
  const txSuccessUI = deploy.phase === "success";

  const canDeploy =
    params !== null &&
    question.trim().length > 0 &&
    criteria.trim().length > 0 &&
    expiryDatetime.length > 0 &&
    deploy.phase !== "submitting" &&
    deploy.phase !== "confirming" &&
    deploy.phase !== "success";

  return (
    <>
      <header className="page-header">
        <h1 className="h">
          Generate <em>market.</em>
        </h1>
        <span className="meta">Powered by ChainGPT</span>
      </header>

      <section className="create-body">
        {polymarketSourceId && (
          <div className="create-mirror-banner">
            <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
              MIRRORED FROM POLYMARKET
            </span>
            {mirrorSeed && (
              <>
                <p className="mirror-question">
                  Source: <em>&ldquo;{mirrorSeed.question}&rdquo;</em>
                </p>
                <a className="mirror-link" href={mirrorSeed.url} target="_blank" rel="noopener noreferrer">
                  VIEW ON POLYMARKET <ExternalLink size={11} />
                </a>
              </>
            )}
            {!mirrorSeed && !mirrorError && (
              <p className="mirror-question">
                <Loader size={12} /> Fetching source market #{polymarketSourceId}…
              </p>
            )}
            {mirrorError && (
              <p className="create-error" style={{margin: 0}}>
                {"// MIRROR FETCH FAILED: "}
                {mirrorError}
              </p>
            )}
          </div>
        )}

        <div className="create-prompt-panel">
          <h2>{"// Describe your market in natural language"}</h2>
          <textarea
            className="create-prompt-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={EXAMPLE_PROMPT}
            rows={mirrorSeed ? 6 : 4}
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
              {!isConnected && (
                <p className="create-deploy-note" style={{color: "var(--fg-muted)"}}>
                  Connect wallet to deploy.
                </p>
              )}

              {isConnected && isDeployer && (
                <p className="create-deploy-note">
                  <strong>Connected as registry owner.</strong> Your wallet signs the deploy tx directly.
                  Lands on <strong>Arb Sepolia</strong>.
                </p>
              )}

              {isConnected && !isDeployer && (
                <div className="create-sponsored-banner" role="note">
                  <span className="label">
                    <Shield size={11} />
                    SPONSORED DEPLOYMENT — DEMO MODE
                  </span>
                  <p className="body">
                    Your wallet isn&apos;t the MarketRegistry owner, so the tx is signed server-side by the
                    DarkOdds deployer EOA (the operationally-delegated owner during the live-judging window).
                    You see a real on-chain market on Arb Sepolia; gas is on us. Limit: 1 sponsored deploy per
                    IP per minute.
                  </p>
                </div>
              )}

              {isConnected && (
                <button
                  type="button"
                  className="create-cta"
                  onClick={() => void handleDeploy()}
                  disabled={!canDeploy}
                  style={{alignSelf: "flex-start"}}
                >
                  <ArrowRight size={12} />
                  {isDeployer ? "DEPLOY MARKET" : "DEPLOY MARKET (SPONSORED)"}
                </button>
              )}

              {(deploy.phase === "submitting" || deploy.phase === "confirming") && (
                <div className="create-tx-status">
                  <Loader size={12} />
                  {deploy.phase === "submitting"
                    ? deploy.route === "sponsored"
                      ? "Server signing with deployer EOA…"
                      : "Waiting for wallet signature…"
                    : "Confirming on-chain…"}
                  {txHash && (
                    <a className="tx-hash" href={txLink(txHash)} target="_blank" rel="noopener noreferrer">
                      {txHash.slice(0, 14)}… ↗
                    </a>
                  )}
                </div>
              )}

              {txError && (
                <p className="create-error">
                  {"// DEPLOY ERROR: "}
                  {txError.message.slice(0, 240)}
                </p>
              )}

              {txSuccessUI && (
                <div className="create-tx-status" style={{color: "var(--fg)"}}>
                  Market{deploy.marketId ? ` #${deploy.marketId}` : ""} deployed — redirecting…
                  {txHash && (
                    <a className="tx-hash" href={txLink(txHash)} target="_blank" rel="noopener noreferrer">
                      {txHash.slice(0, 14)}… ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

export default function CreatePage(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <header className="page-header">
          <h1 className="h">
            Generate <em>market.</em>
          </h1>
        </header>
      }
    >
      <CreateInner />
    </Suspense>
  );
}
