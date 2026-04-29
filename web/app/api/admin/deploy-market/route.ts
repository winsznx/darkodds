/**
 * POST /api/admin/deploy-market
 *
 * Sponsored deployment route for the live-judging window. Lets a judge with
 * any connected wallet click DEPLOY MARKET on /create — server-side signs
 * with `DEPLOYER_PRIVATE_KEY` (the operationally-delegated registry owner)
 * and submits the createMarket tx with the same `getArbSepoliaFeeOverrides`
 * fee discipline used by the bet/claim flows.
 *
 * After createMarket, the route ALSO performs a Safe-cosigned
 * `ResolutionOracle.setAdapter(marketId, adapterFor(oracleType))` so the
 * new market is wired to the correct adapter before its expiry — closing
 * the gap surfaced by docs/RESOLUTION_AUDIT_2026-04-29.md (markets #16-21
 * were deployed without setAdapter and got stuck in Open). Safe cosign
 * requires both DEPLOYER_PRIVATE_KEY and MULTISIG_SIGNER_2_PK on the
 * server. Trade-off documented in KNOWN_LIMITATIONS.
 *
 * Why this exists:
 *   `MarketRegistry.createMarket(...)` is `onlyOwner`. After F10b's
 *   operational delegation, the owner is the deployer EOA — not the
 *   judge's connected wallet. Without server-side sponsorship, every
 *   non-deployer wallet's tx would revert with `OwnableUnauthorizedAccount`,
 *   which kills the judge-clickable demo. With sponsorship, the UI
 *   signature step happens server-side, the judge sees a real Arbiscan
 *   tx land, and the operational delegation actually pays off.
 *
 * Sponsorship trade-offs:
 *   - Cost on us (deployer EOA pays gas + Safe cosign for setAdapter,
 *     ~0.0003 ETH per market on Arb Sepolia, negligible for the judging
 *     window)
 *   - Anyone can spam markets via this route. Mitigated by 60s rate limit
 *     per origin IP and by validation: question ≤ 200 chars, criteria ≤
 *     500 chars, expiry must be > now.
 *
 * Restored to multisig path post-judging via
 *   tools/transfer-registry-ownership.ts --to-safe --confirm
 * — at which point this route returns 503 (Service Unavailable) because
 * the deployer key no longer holds ownership.
 *
 * Request:  { question, resolutionCriteria, oracleType, expiryTs, protocolFeeBps }
 * Response: { ok: true, marketId, marketAddress, txHash, setAdapterTxHash } | { ok: false, error }
 */

import {NextResponse} from "next/server";

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";

import {ARB_SEPOLIA_RPC_URL} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {getArbSepoliaFeeOverrides} from "@/lib/contracts/fees";
import {marketRegistryAbi} from "@/lib/contracts/generated";
import {recordCreator} from "@/lib/markets/created-ledger";

/// Vercel default for Node API routes is 10s on Hobby, 60s on Pro.
/// Safe-cosigned setAdapter takes 4-8s on top of the createMarket round-trip,
/// so the combined flow can run 12-20s. Pin to 60 to ride either tier.
export const maxDuration = 60;

const RES_ORACLE_ABI = parseAbi(["function setAdapter(uint256 marketId, address adapter) external"]);

function adapterForOracleType(oracleType: 0 | 1 | 2): Address {
  switch (oracleType) {
    case 0:
      return addresses.AdminOracle;
    case 1:
      return addresses.ChainlinkPriceOracle;
    case 2:
      return addresses.PreResolvedOracle;
  }
}

interface DeployRequest {
  question?: unknown;
  resolutionCriteria?: unknown;
  oracleType?: unknown;
  expiryTs?: unknown;
  protocolFeeBps?: unknown;
  /** Optional connected-wallet address of the user clicking DEPLOY MARKET.
   *  Recorded in the created-by ledger so the MINE filter on /markets can
   *  surface this market for that user across browsers / devices. */
  creator?: unknown;
}

interface ParsedRequest {
  question: string;
  resolutionCriteria: string;
  oracleType: 0 | 1 | 2;
  expiryTs: bigint;
  protocolFeeBps: bigint;
  creator: Address | null;
}

const QUESTION_MAX = 200;
const CRITERIA_MAX = 500;
const FEE_MIN = BigInt(50);
const FEE_MAX = BigInt(500);

// Module-level rate limiter — 1 deploy per 60s per IP. Acceptable for
// hackathon-scale traffic; survives a Vercel cold start because each
// instance gets its own map (fairness across regions is a non-goal here).
const RATE: Map<string, number> = new Map();
const COOLDOWN_MS = 60_000;

function ipFrom(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function parseBody(body: DeployRequest): ParsedRequest | string {
  if (typeof body.question !== "string" || !body.question.trim()) return "question is required";
  if (body.question.length > QUESTION_MAX) return `question exceeds ${QUESTION_MAX} chars`;
  if (typeof body.resolutionCriteria !== "string" || !body.resolutionCriteria.trim()) {
    return "resolutionCriteria is required";
  }
  if (body.resolutionCriteria.length > CRITERIA_MAX)
    return `resolutionCriteria exceeds ${CRITERIA_MAX} chars`;
  if (typeof body.oracleType !== "number" || !Number.isInteger(body.oracleType)) {
    return "oracleType must be 0|1|2";
  }
  if (body.oracleType < 0 || body.oracleType > 2) return "oracleType must be 0|1|2";
  if (typeof body.expiryTs !== "number" || !Number.isFinite(body.expiryTs)) {
    return "expiryTs must be a unix timestamp number";
  }
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const expiryTs = BigInt(Math.round(body.expiryTs));
  if (expiryTs <= nowSec) return "expiryTs must be in the future";
  if (typeof body.protocolFeeBps !== "number" || !Number.isInteger(body.protocolFeeBps)) {
    return "protocolFeeBps must be an integer";
  }
  const feeBps = BigInt(body.protocolFeeBps);
  if (feeBps < FEE_MIN || feeBps > FEE_MAX) return `protocolFeeBps must be in [${FEE_MIN}, ${FEE_MAX}]`;
  // creator is optional — drop silently if malformed rather than rejecting the
  // whole deploy request. Only well-formed addresses make it into the ledger.
  let creator: Address | null = null;
  if (typeof body.creator === "string" && /^0x[0-9a-fA-F]{40}$/.test(body.creator)) {
    creator = body.creator as Address;
  }
  return {
    question: body.question.trim(),
    resolutionCriteria: body.resolutionCriteria.trim(),
    oracleType: body.oracleType as 0 | 1 | 2,
    expiryTs,
    protocolFeeBps: feeBps,
    creator,
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  const signerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim() as Hex | undefined;
  if (!signerKey || !signerKey.startsWith("0x")) {
    return NextResponse.json(
      {ok: false, error: "DEPLOYER_PRIVATE_KEY not configured on server"},
      {status: 500},
    );
  }

  const ip = ipFrom(req);
  const last = RATE.get(ip);
  if (last && Date.now() - last < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
    return NextResponse.json(
      {ok: false, error: `Rate limit: please wait ${wait}s before another sponsored deploy from this IP.`},
      {status: 429},
    );
  }

  let body: DeployRequest;
  try {
    body = (await req.json()) as DeployRequest;
  } catch {
    return NextResponse.json({ok: false, error: "invalid JSON body"}, {status: 400});
  }

  const parsed = parseBody(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ok: false, error: parsed}, {status: 400});
  }

  const account = privateKeyToAccount(signerKey);
  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(ARB_SEPOLIA_RPC_URL)});
  const wallet = createWalletClient({account, chain: arbitrumSepolia, transport: http(ARB_SEPOLIA_RPC_URL)});

  // Check that the server-side signer actually holds ownership. If the
  // registry is in the GOVERNANCE-CURATED phase (Safe-owned), this
  // sponsored route can't help — return 503 with a pointer to the
  // delegation script.
  let owner: Address;
  try {
    owner = (await pub.readContract({
      address: addresses.MarketRegistry,
      abi: marketRegistryAbi,
      functionName: "owner",
    })) as Address;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `failed to read MarketRegistry.owner: ${err instanceof Error ? err.message : String(err)}`,
      },
      {status: 502},
    );
  }
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `Sponsored deployment unavailable: MarketRegistry.owner() is ${owner}, ` +
          `not the deployer EOA. The registry is in the GOVERNANCE-CURATED phase (multisig-owned) — ` +
          `re-run tools/transfer-registry-ownership.ts --to-eoa --confirm to enable demo deploys.`,
      },
      {status: 503},
    );
  }

  // Stamp the rate-limit BEFORE submitting so a slow tx doesn't widen the
  // window for spammers retrying.
  RATE.set(ip, Date.now());

  const fees = await getArbSepoliaFeeOverrides(pub);
  let txHash: Hex;
  try {
    txHash = await wallet.writeContract({
      address: addresses.MarketRegistry,
      abi: marketRegistryAbi,
      functionName: "createMarket",
      args: [
        parsed.question,
        parsed.resolutionCriteria,
        parsed.oracleType,
        parsed.expiryTs,
        parsed.protocolFeeBps,
      ],
      ...fees,
    });
  } catch (err) {
    return NextResponse.json(
      {ok: false, error: `submit failed: ${err instanceof Error ? err.message : String(err)}`},
      {status: 502},
    );
  }

  // Wait for receipt + parse MarketCreated for the market id.
  let marketId: bigint | null = null;
  let marketAddress: Address | null = null;
  try {
    const rc = await pub.waitForTransactionReceipt({hash: txHash});
    if (rc.status !== "success") {
      return NextResponse.json(
        {ok: false, error: `createMarket reverted on-chain: ${txHash}`, txHash},
        {status: 502},
      );
    }
    for (const log of rc.logs) {
      if (log.address.toLowerCase() !== addresses.MarketRegistry.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({abi: marketRegistryAbi, ...log});
        if (decoded.eventName === "MarketCreated") {
          const args = decoded.args as {id: bigint; market: Address};
          marketId = args.id;
          marketAddress = args.market;
          break;
        }
      } catch {
        // not our event
      }
    }
  } catch (err) {
    return NextResponse.json(
      {ok: false, error: `receipt poll failed: ${err instanceof Error ? err.message : String(err)}`, txHash},
      {status: 502},
    );
  }

  if (!marketId || !marketAddress) {
    return NextResponse.json(
      {ok: false, error: "MarketCreated event not found in receipt", txHash},
      {status: 502},
    );
  }

  // Safe-cosigned ResolutionOracle.setAdapter — closes the routing gap that
  // left markets #16-21 unresolvable. ResolutionOracle is Safe-owned, so this
  // requires 2-of-3 cosign. Both signing keys must be on the server (note
  // the trade-off in KNOWN_LIMITATIONS — the multisig is reduced to the
  // server's effective control during the live-judging window).
  let setAdapterTxHash: Hex | null = null;
  let setAdapterError: string | null = null;
  const signer2Key = process.env.MULTISIG_SIGNER_2_PK?.trim() as Hex | undefined;
  if (!signer2Key || !signer2Key.startsWith("0x")) {
    setAdapterError =
      "MULTISIG_SIGNER_2_PK not configured on server — adapter not auto-wired. Run tools/admin-resolve.ts to wire after the fact.";
  } else {
    const adapter = adapterForOracleType(parsed.oracleType);
    try {
      // createRequire keeps @safe-global/protocol-kit out of TS's static
      // type graph entirely — direct or even dynamic `import` of that
      // package widens viem's Address type from `0x${string}` to `string`
      // app-wide, breaking unrelated wagmi-typed components (e.g.
      // FaucetModal). require() is a string-driven runtime resolution that
      // TS doesn't follow at compile time.
      const {createRequire} = await import("node:module");
      const nodeRequire = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SafeMod = nodeRequire("@safe-global/protocol-kit") as any;
      const Safe = SafeMod.default ?? SafeMod;
      const sdk1 = await Safe.init({
        provider: ARB_SEPOLIA_RPC_URL,
        signer: signerKey,
        safeAddress: addresses.Safe,
      });
      const sdk2 = await Safe.init({
        provider: ARB_SEPOLIA_RPC_URL,
        signer: signer2Key,
        safeAddress: addresses.Safe,
      });
      const data = encodeFunctionData({
        abi: RES_ORACLE_ABI,
        functionName: "setAdapter",
        args: [marketId, adapter],
      });
      let safeTx = await sdk1.createTransaction({
        transactions: [{to: addresses.ResolutionOracle, value: "0", data}],
      });
      safeTx = await sdk1.signTransaction(safeTx);
      safeTx = await sdk2.signTransaction(safeTx);
      const exec = await sdk1.executeTransaction(safeTx);
      const safeHash = (exec.hash ?? exec.transactionResponse?.hash) as Hex | undefined;
      if (!safeHash) throw new Error("Safe exec returned no hash");
      const safeRc = await pub.waitForTransactionReceipt({hash: safeHash});
      if (safeRc.status !== "success") throw new Error(`setAdapter reverted: ${safeHash}`);
      setAdapterTxHash = safeHash;
    } catch (err) {
      setAdapterError = `setAdapter cosign failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Record the creator (best-effort — never blocks the success response).
  // Self-signed deploys never reach this route, so the ledger only ever
  // grows from genuinely user-initiated sponsored creations. Skipped when
  // the request didn't supply a creator (older client, or call from a tool).
  if (parsed.creator) {
    try {
      await recordCreator(marketId.toString(), parsed.creator);
    } catch {
      // Ledger persistence is best-effort; the on-chain deploy succeeded.
      // The MINE filter falls back to localStorage on the client when the
      // server ledger is missing an entry.
    }
  }

  return NextResponse.json({
    ok: true,
    marketId: marketId.toString(),
    marketAddress,
    txHash,
    sponsored: true,
    setAdapterTxHash,
    setAdapterError,
  });
}
