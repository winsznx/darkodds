/**
 * Attestation JSON envelope — portable selective-disclosure proof.
 *
 * Per PRD §9: a user who claimed winnings can generate this JSON and share
 * it with one party (auditor, accountant, journalist, employer). The
 * recipient verifies via `/audit` page or programmatically via
 * `ClaimVerifier.verifyAttestation(encodedData, signature)`.
 *
 * Wire format mirrors `tools/verify-backend.ts` STEP 7 — same shape so the
 * existing CLI verifier and the new web UI consume the same files.
 */

import type {Address, Hex} from "viem";

/** ABI-encoded payload tuple: matches AttestationPayload in ClaimVerifier.sol §5.5. */
export interface AttestationPayload {
  user: Address;
  /** Stringified bigint for JSON-friendly serialization. */
  marketId: string;
  /** 0=NO, 1=YES, 2=INVALID. */
  outcome: number;
  /** bytes32 — typically the on-chain payoutHandle from ClaimSettled. */
  payoutCommitment: Hex;
  /** Stringified bigint (unix seconds). */
  timestamp: string;
  /** Address(0) iff bearer mode. */
  recipient: Address;
  /** Stringified bigint — unique per attestation, prevents replay caching. */
  nonce: string;
  /** bytes32 — must match ClaimVerifier.pinnedTdxMeasurement at verify time. */
  tdxMeasurement: Hex;
}

export interface AttestationEnvelope {
  payload: AttestationPayload;
  /** ABI-encoded `payload` tuple. */
  encodedData: Hex;
  /** ECDSA(EIP-191) signature of keccak256(encodedData) by attestationSigner. */
  signature: Hex;
  /** keccak256(encodedData) — sanity-check helper, not consumed by the contract. */
  digest: Hex;
  /** Recovered/expected signer address. */
  signer: Address;
  verifierAddress: Address;
  /** Source claim tx hash this attestation was generated from. */
  sourceClaimTx: Hex;
  generatedAt: string;
  mode: "recipient-bound" | "bearer";
}

/** ABI tuple components for encodeAbiParameters / decodeAbiParameters. */
export const ATTESTATION_PAYLOAD_TUPLE = [
  {type: "address", name: "user"},
  {type: "uint256", name: "marketId"},
  {type: "uint8", name: "outcome"},
  {type: "bytes32", name: "payoutCommitment"},
  {type: "uint256", name: "timestamp"},
  {type: "address", name: "recipient"},
  {type: "uint256", name: "nonce"},
  {type: "bytes32", name: "tdxMeasurement"},
] as const;
