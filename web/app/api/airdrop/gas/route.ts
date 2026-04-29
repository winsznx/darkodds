/**
 * POST /api/airdrop/gas
 *
 * Gas-airdrop endpoint for first-time users. Privy email-auth users land
 * with empty wallets and can't pay gas; this endpoint sends 0.005 ETH on
 * Arb Sepolia from a server-managed AIRDROP_PRIVATE_KEY wallet so they can
 * proceed to the TestUSDC step in /faucet without bridging.
 *
 * Rate limits:
 *   - per-address: AT MOST ONCE EVER (anti-Sybil at the address level)
 *   - per-IP: 24 grants in a rolling 24-hour window (lets a NAT-shared
 *     cohort onboard while bounding a single bot's drain rate)
 *
 * Persistence: Vercel KV when configured, /tmp file fallback otherwise.
 * See web/lib/airdrop/rate-limit.ts.
 *
 * Failure modes (NEVER throws 500 — UI must always render):
 *   200 { ok: true, txHash }
 *   429 { ok: false, reason: "address-already-airdropped" | "ip-rate-limit", retryAfterSec? }
 *   400 { ok: false, reason: "invalid-address" | "invalid-body" }
 *   503 { ok: false, reason: "airdrop-disabled" }   ← AIRDROP_PRIVATE_KEY not set
 *   503 { ok: false, reason: "wallet-empty" }       ← airdrop wallet out of funds
 *   502 { ok: false, reason: "tx-failed", message } ← chain-side error
 */

import {NextResponse} from "next/server";

import {parseEther, type Address, type Hex} from "viem";

import {getArbSepoliaFeeOverrides} from "@/lib/contracts/fees";
import {getAirdropClients} from "@/lib/airdrop/wallet";
import {checkRateLimit, persistenceIsDurable, recordAirdrop} from "@/lib/airdrop/rate-limit";

const AIRDROP_AMOUNT_WEI = parseEther("0.005");
/// Reserve enough for ~5 more grants before refusing — keeps the wallet from
/// rejecting txs mid-flow due to gas-budget edge cases.
const MIN_WALLET_RESERVE_WEI = parseEther("0.001");

export const maxDuration = 30;

function ipFrom(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function isAddress(v: unknown): v is Address {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

export async function POST(req: Request): Promise<NextResponse> {
  const clients = getAirdropClients();
  if (!clients) {
    return NextResponse.json(
      {ok: false, reason: "airdrop-disabled", message: "AIRDROP_PRIVATE_KEY not configured on server"},
      {status: 503},
    );
  }

  let body: {address?: unknown};
  try {
    body = (await req.json()) as {address?: unknown};
  } catch {
    return NextResponse.json({ok: false, reason: "invalid-body", message: "invalid JSON"}, {status: 400});
  }
  if (!isAddress(body.address)) {
    return NextResponse.json(
      {ok: false, reason: "invalid-address", message: "address must be a 0x-prefixed 20-byte hex"},
      {status: 400},
    );
  }
  const target = body.address;
  const ip = ipFrom(req);

  // Rate-limit checks (address ever + IP per-24h).
  const rl = await checkRateLimit(target, ip);
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: rl.reason,
        retryAfterSec: rl.retryAfterSec,
        message:
          rl.reason === "address-already-airdropped"
            ? "This address has already received an airdrop. Use the manual ETH onramp in the faucet modal."
            : `Too many grants from this network. Try again in ${Math.ceil((rl.retryAfterSec ?? 0) / 3600)}h.`,
      },
      {status: 429},
    );
  }

  // Wallet reserve check — refuse early if we can't afford the grant + a
  // small reserve. Operator can refund the wallet to clear this state.
  const reserve = AIRDROP_AMOUNT_WEI + MIN_WALLET_RESERVE_WEI;
  let walletBal: bigint;
  try {
    walletBal = await clients.publicClient.getBalance({address: clients.address});
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "tx-failed",
        message: `RPC read failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      {status: 502},
    );
  }
  if (walletBal < reserve) {
    return NextResponse.json(
      {
        ok: false,
        reason: "wallet-empty",
        message: `Airdrop wallet balance is ${walletBal} wei, below the ${reserve} reserve. Operator must top up.`,
      },
      {status: 503},
    );
  }

  // Send the grant. Use Arb Sepolia fee overrides so a stale-basefee
  // wallet doesn't reject mid-flight (same pattern as the bet/claim flows).
  const fees = await getArbSepoliaFeeOverrides(clients.publicClient);
  let txHash: Hex;
  try {
    txHash = (await clients.walletClient.sendTransaction({
      account: clients.walletClient.account!,
      chain: clients.walletClient.chain!,
      to: target,
      value: AIRDROP_AMOUNT_WEI,
      ...fees,
    })) as Hex;
  } catch (err) {
    return NextResponse.json(
      {ok: false, reason: "tx-failed", message: err instanceof Error ? err.message : String(err)},
      {status: 502},
    );
  }

  // Record the grant BEFORE waiting for the receipt so a slow chain doesn't
  // widen the double-grant window if the request retries.
  await recordAirdrop(target, ip);

  // Wait for receipt — gives the UI a confirmable tx hash to surface.
  try {
    const rc = await clients.publicClient.waitForTransactionReceipt({hash: txHash});
    if (rc.status !== "success") {
      return NextResponse.json(
        {ok: false, reason: "tx-failed", message: `tx reverted: ${txHash}`, txHash},
        {status: 502},
      );
    }
  } catch (err) {
    // Tx submitted but receipt-poll failed — return ok with a warning so
    // the UI still surfaces the hash; recordAirdrop already committed.
    return NextResponse.json(
      {
        ok: true,
        txHash,
        warning: `receipt poll failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      {status: 200},
    );
  }

  return NextResponse.json({
    ok: true,
    txHash,
    durablePersistence: persistenceIsDurable(),
  });
}
