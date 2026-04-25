# TEE Handler Runtime Discovery — Phase F5

**Date:** 2026-04-26
**Finding:** The iExec Nox protocol does not expose a custom handler runtime.
No handler images are built or deployed by DarkOdds.

## What the PRD expected

PRD §11 F5 planned four TEE handlers:

1. `validateBet` — validate and commit an encrypted bet amount
2. `freezePool` — public-decrypt the pool totals post-resolution
3. `computePayout` — proportional pari-mutuel math on encrypted user bets
4. `signAttestation` — produce a TDX-signed §9.2 attestation for ClaimVerifier

The model assumed iExec's older iApp worker deployment: build a Docker image, register it
on-chain, capture the TDX measurement from the signed image, pin the measurement in ClaimVerifier.

## What Nox v0.1.0 actually provides

Source: https://docs.iex.ec/nox-protocol/protocol/runner

1. **The Runner is a fixed Rust service in Intel TDX** owned and operated by the iExec protocol
   infrastructure. Application developers cannot deploy custom runner images.

2. **All TEE computation is expressed through Solidity library calls.** The `NoxCompute` library
   emits events; the Ingestor picks them up; the Runner processes each operation inside TDX.
   Operations supported:
   - Core arithmetic: `Nox.add`, `Nox.sub`, `Nox.mul`, `Nox.div`
   - Safe arithmetic: `Nox.safeAdd`, `Nox.safeSub`
   - Comparisons: `Nox.eq`, `Nox.ne`, `Nox.lt`, `Nox.le`, `Nox.gt`, `Nox.ge`
   - Selection: `Nox.select`
   - Type coercion: `Nox.toEuint256`, `Nox.fromExternal`, `Nox.publicDecrypt`
   - Token ops: `Nox.transfer`, `Nox.mint`, `Nox.burn`

3. **`@iexec-nox/handle`** (the only package in the @iexec-nox npm scope) is a client-side
   TypeScript SDK for encrypting inputs (before sending to a contract) and decrypting outputs
   (after the Runner processes them). It is not a handler deployment SDK.

## How each planned handler maps to Nox reality

| Handler           | Disposition | Where the logic lives                                                                                                                                                                                                     |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateBet`     | Moot        | `Market.placeBet` — `Nox.fromExternal(encryptedAmount, inputProof)` validates and ingests the encrypted bet on-chain (F3)                                                                                                 |
| `freezePool`      | Moot        | `Market.freezePool` — `Nox.publicDecrypt(_yesPoolPublished, proof)` decrypts the pool total on-chain (F4)                                                                                                                 |
| `computePayout`   | Superseded  | `Market.claimWinnings` (F5) — `Nox.mul(userBet, totalPool) → Nox.div(_, winningSide) → Nox.sub(gross, fee)` computes proportional payout on-chain                                                                         |
| `signAttestation` | Superseded  | No application-level TDX attestation is possible. The Nox Runner's TDX measurement belongs to the protocol infrastructure. `ClaimVerifier` is retained as an audit-trail artifact but is NOT called from `claimWinnings`. |

## What this means for ClaimVerifier

`ClaimVerifier` (deployed at `0x5cc49763703656fec4be672e254f7f024de2b82a`) pins
`keccak256("DARKODDS_F4_DEMO_MEASUREMENT")` as the TDX measurement and the deployer EOA as the
`attestationSigner`. The contract is correct and well-formed (it verifies ECDSA signatures over
ABI-encoded attestation payloads). Its deployment is preserved as an audit trail artifact.

F5 does not redeploy ClaimVerifier because:

- There is no real TDX measurement to capture (no custom handler deployed)
- There is no off-chain attestation signer (no TEE worker key)
- `claimWinnings` does not need an attestation gate when payout math runs on-chain

A future upgrade path exists: if iExec adds a custom compute surface (iApp-style), deploy a
handler that signs attestations, redeploy ClaimVerifier with the real measurement, and add
`verifyAttestation` back to `claimWinnings`.

## References

- Runner docs: https://docs.iex.ec/nox-protocol/protocol/runner
- Ingestor docs: https://docs.iex.ec/nox-protocol/protocol/ingestor
- Architecture: https://docs.iex.ec/nox-protocol/protocol/global-architecture-overview
- JS SDK: https://docs.iex.ec/nox-protocol/references/js-sdk/getting-started (`@iexec-nox/handle`)
- Arithmetic ops: https://docs.iex.ec/nox-protocol/references/solidity-library/methods/core-primitives/arithmetic
