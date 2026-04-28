/**
 * POST /api/attestation/generate
 *
 * Generates a selective-disclosure JSON attestation for a settled claim,
 * signed server-side by the deployer EOA (which is the
 * `attestationSigner` pinned at ClaimVerifier deploy — F4 placeholder per
 * `contracts/deployments/arb-sepolia.json` notes; production swaps in a
 * TEE-attested key).
 *
 * Request body:  { marketId: string, claimTx: Hex, recipient?: Address, bearer?: boolean }
 * Response:      AttestationEnvelope (see web/lib/attestation/types.ts)
 *
 * Mirrors the canonical generation in `tools/verify-backend.ts` STEP 7 so the
 * web-issued JSON is byte-compatible with the CLI-issued JSON.
 */

import {NextResponse} from "next/server";

import {
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  http,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";

import {addresses} from "@/lib/contracts/addresses";
import {claimVerifierAbi, marketAbi} from "@/lib/contracts/generated";
import {
  ATTESTATION_PAYLOAD_TUPLE,
  type AttestationEnvelope,
  type AttestationPayload,
} from "@/lib/attestation/types";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

const RPC_URL = process.env.NEXT_PUBLIC_ARB_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";

interface GenerateRequest {
  marketId?: unknown;
  claimTx?: unknown;
  recipient?: unknown;
  bearer?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const signerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim() as Hex | undefined;
  if (!signerKey || !signerKey.startsWith("0x")) {
    return NextResponse.json({error: "DEPLOYER_PRIVATE_KEY not configured on server"}, {status: 500});
  }

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({error: "invalid JSON body"}, {status: 400});
  }

  const marketIdRaw = body.marketId;
  const claimTx = body.claimTx;
  const bearer = body.bearer === true;
  const recipientArg = body.recipient;

  if (typeof marketIdRaw !== "string" || marketIdRaw.length === 0) {
    return NextResponse.json({error: "marketId is required (string)"}, {status: 400});
  }
  if (typeof claimTx !== "string" || !isHex(claimTx) || claimTx.length !== 66) {
    return NextResponse.json({error: "claimTx must be a 32-byte hex tx hash"}, {status: 400});
  }
  let marketId: bigint;
  try {
    marketId = BigInt(marketIdRaw);
    if (marketId <= BigInt(0)) throw new Error("marketId must be > 0");
  } catch (err) {
    return NextResponse.json(
      {error: `invalid marketId: ${err instanceof Error ? err.message : String(err)}`},
      {status: 400},
    );
  }

  let recipient: Address;
  if (bearer) {
    recipient = ZERO_ADDRESS;
  } else if (typeof recipientArg === "string" && isAddress(recipientArg)) {
    recipient = recipientArg as Address;
  } else {
    return NextResponse.json({error: "recipient address required when bearer=false"}, {status: 400});
  }

  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC_URL)});

  // 1. Resolve the market address from the registry.
  let marketAddress: Address;
  try {
    const addr = (await pub.readContract({
      address: addresses.MarketRegistry,
      abi: (await import("@/lib/contracts/generated")).marketRegistryAbi,
      functionName: "markets",
      args: [marketId],
    })) as Address;
    if (!addr || addr === ZERO_ADDRESS) throw new Error("market not found");
    marketAddress = addr;
  } catch (err) {
    return NextResponse.json(
      {
        error: `failed to resolve market #${marketIdRaw}: ${err instanceof Error ? err.message : String(err)}`,
      },
      {status: 404},
    );
  }

  // 2. Pull the claim tx receipt + originating block, validate it targets the
  //    expected market, and parse ClaimSettled for outcome + payoutHandle.
  let payoutCommitment: Hex = "0x";
  let outcome = 0;
  let claimUser: Address = ZERO_ADDRESS;
  let timestamp = BigInt(0);
  try {
    const rc = await pub.getTransactionReceipt({hash: claimTx as Hex});
    if (rc.status !== "success") {
      return NextResponse.json({error: `claim tx ${claimTx} did not succeed`}, {status: 400});
    }
    if (rc.to?.toLowerCase() !== marketAddress.toLowerCase()) {
      return NextResponse.json(
        {
          error: `claim tx target ${rc.to ?? "null"} does not match market #${marketIdRaw} at ${marketAddress}`,
        },
        {status: 400},
      );
    }
    claimUser = rc.from;

    for (const log of rc.logs) {
      if (log.address.toLowerCase() !== marketAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({abi: marketAbi, ...log});
        if (decoded.eventName === "ClaimSettled") {
          const args = decoded.args as {
            user: Address;
            outcome: number;
            payoutHandle: Hex;
            feeHandle: Hex;
          };
          payoutCommitment = args.payoutHandle;
          outcome = args.outcome;
          break;
        }
      } catch {
        // not our event
      }
    }
    if (payoutCommitment === ("0x" as Hex)) {
      return NextResponse.json({error: "ClaimSettled event not found in tx receipt"}, {status: 400});
    }

    const block = await pub.getBlock({blockNumber: rc.blockNumber});
    timestamp = block.timestamp;
  } catch (err) {
    return NextResponse.json(
      {error: `failed to read claim tx receipt: ${err instanceof Error ? err.message : String(err)}`},
      {status: 502},
    );
  }

  // 3. Read pinned TDX measurement from the live ClaimVerifier — pinned at
  //    deploy, immutable, fetched once per generation so we never drift from
  //    the real on-chain value.
  let pinnedTdxMeasurement: Hex;
  let attestationSigner: Address;
  try {
    [pinnedTdxMeasurement, attestationSigner] = (await Promise.all([
      pub.readContract({
        address: addresses.ClaimVerifier,
        abi: claimVerifierAbi,
        functionName: "pinnedTdxMeasurement",
      }),
      pub.readContract({
        address: addresses.ClaimVerifier,
        abi: claimVerifierAbi,
        functionName: "attestationSigner",
      }),
    ])) as [Hex, Address];
  } catch (err) {
    return NextResponse.json(
      {error: `failed to read ClaimVerifier: ${err instanceof Error ? err.message : String(err)}`},
      {status: 502},
    );
  }

  const account = privateKeyToAccount(signerKey);
  if (account.address.toLowerCase() !== attestationSigner.toLowerCase()) {
    return NextResponse.json(
      {
        error:
          `server-side signer ${account.address} does not match ClaimVerifier.attestationSigner ` +
          `${attestationSigner}. This deploy targets a different signer; rotate keys or redeploy ClaimVerifier.`,
      },
      {status: 500},
    );
  }

  // 4. Build payload, ABI-encode, sign EIP-191(personal_sign) over keccak256.
  const nonce = BigInt(
    `0x${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`,
  );

  const payload: AttestationPayload = {
    user: claimUser,
    marketId: marketId.toString(),
    outcome,
    payoutCommitment,
    timestamp: timestamp.toString(),
    recipient,
    nonce: nonce.toString(),
    tdxMeasurement: pinnedTdxMeasurement,
  };

  const encodedData = encodeAbiParameters(
    [{type: "tuple", components: [...ATTESTATION_PAYLOAD_TUPLE]}],
    [
      {
        user: payload.user,
        marketId: BigInt(payload.marketId),
        outcome: payload.outcome,
        payoutCommitment: payload.payoutCommitment,
        timestamp: BigInt(payload.timestamp),
        recipient: payload.recipient,
        nonce: BigInt(payload.nonce),
        tdxMeasurement: payload.tdxMeasurement,
      },
    ],
  );
  const digest = keccak256(encodedData);
  const signature = await account.signMessage({message: {raw: digest}});

  const envelope: AttestationEnvelope = {
    payload,
    encodedData,
    signature,
    digest,
    signer: account.address,
    verifierAddress: addresses.ClaimVerifier,
    sourceClaimTx: claimTx as Hex,
    generatedAt: new Date().toISOString(),
    mode: bearer ? "bearer" : "recipient-bound",
  };

  return NextResponse.json(envelope);
}
