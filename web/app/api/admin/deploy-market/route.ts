/**
 * POST /api/admin/deploy-market
 *
 * Sponsored deployment route for the live-judging window. Lets a judge with
 * any connected wallet click DEPLOY MARKET on /create — server-side signs
 * with `DEPLOYER_PRIVATE_KEY` (the operationally-delegated registry owner)
 * and submits the createMarket tx with the same `getArbSepoliaFeeOverrides`
 * fee discipline used by the bet/claim flows.
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
 *   - Cost on us (deployer EOA pays gas — ~0.0001 ETH per market on Arb
 *     Sepolia, negligible for the judging window)
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
 * Response: { ok: true, marketId, marketAddress, txHash } | { ok: false, error }
 */

import {NextResponse} from "next/server";

import {createPublicClient, createWalletClient, decodeEventLog, http, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";

import {ARB_SEPOLIA_RPC_URL} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";
import {getArbSepoliaFeeOverrides} from "@/lib/contracts/fees";
import {marketRegistryAbi} from "@/lib/contracts/generated";

interface DeployRequest {
  question?: unknown;
  resolutionCriteria?: unknown;
  oracleType?: unknown;
  expiryTs?: unknown;
  protocolFeeBps?: unknown;
}

interface ParsedRequest {
  question: string;
  resolutionCriteria: string;
  oracleType: 0 | 1 | 2;
  expiryTs: bigint;
  protocolFeeBps: bigint;
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
  return {
    question: body.question.trim(),
    resolutionCriteria: body.resolutionCriteria.trim(),
    oracleType: body.oracleType as 0 | 1 | 2,
    expiryTs,
    protocolFeeBps: feeBps,
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

  // Check that the server-side signer actually holds ownership. If we're
  // back in PRODUCTION MODE (Safe-owned), this route can't help — return
  // 503 with a pointer to the restoration script.
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
          `not the deployer EOA. The registry is in PRODUCTION MODE (multisig-owned) — ` +
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

  return NextResponse.json({
    ok: true,
    marketId: marketId.toString(),
    marketAddress,
    txHash,
    sponsored: true,
  });
}
