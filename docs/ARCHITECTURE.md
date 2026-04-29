# Architecture

DarkOdds is a privacy-permissionless prediction market on Arbitrum Sepolia. Outcomes and odds are public; bet sizes are encrypted on iExec Nox; payouts are decrypted only by the recipient. This document maps the system topology, the encrypted-handle lifecycle, and the design choices that distinguish it from FHE-based confidential markets.

For the deployed addresses, see [`README.md#deployed-addresses`](../README.md#deployed-addresses). For the verifier suite that exercises every step end-to-end, see [`README.md#verify-it-works-in-60-seconds`](../README.md#verify-it-works-in-60-seconds).

---

## Verified end-to-end

DarkOdds ships with a regression suite (`pnpm verify:f10b` + `pnpm verify:claim-flow`) that runs `45/45` checks against real Arbitrum Sepolia state. The claim-flow verifier is the strongest single piece of evidence in the repo: it places a real encrypted bet, watches the market resolve, and decrypts the payout handle that the contract grants to the winner.

A representative run against Market #26 (PreResolved, YES outcome) produced a payout of `36,750,000` cUSDC base units, decrypted via `nox.decrypt(payoutHandle)` from the winner's wallet. The math:

```
totalPool        = 50,000,000  (sum of all bet amounts, base units = 6 decimals)
winningSideTotal = 50,000,000  (winner is the only YES bettor; pool is balanced 50/50)
userBet          = 37,500,000

gross = userBet * totalPool / winningSideTotal
      = 37,500,000 * 50,000,000 / 50,000,000
      = 37,500,000

fee   = gross * protocolFeeBps / 10_000
      = 37,500,000 * 200 / 10_000
      = 750,000

payout = gross - fee
       = 37,500,000 - 750,000
       = 36,750,000     // 36.75 cUSDC after the 2% protocol fee
```

The same arithmetic runs inside `Market.claimWinnings` via Nox encrypted-arithmetic library calls (`Nox.mul → Nox.div → Nox.sub`). The Nox runner — a fixed Intel TDX service operated by iExec — performs the multiplication and division on the encrypted handles in plaintext inside the TEE, then re-encrypts the result and grants it to `msg.sender` via `Nox.allow`. The winner reads the handle from the `ClaimSettled` event and calls `nox.decrypt(handle)` client-side.

This is the proportional pari-mutuel that pure-FHE markets cannot ship. FHE schemes can `add` and `multiply-by-constant` in ciphertext space, but encrypted-by-encrypted division is intractable in current homomorphic schemes. The OpenZeppelin Confidential Contracts reference market sidesteps the problem by simplifying payout to "winner gets own bet back," which is not a real market. DarkOdds solves it by doing the math inside the TDX TEE, not in homomorphic ciphertext space — the TEE sees plaintext, computes the exact proportional payout, re-encrypts, and never leaks the inputs or output to the chain.

The verifier output transcript at `verification-output/claim-flow-{stamp}/transcript.txt` records every check, every transaction hash, and the final decrypted payout. Re-run `pnpm verify:claim-flow` after any contract change to catch regressions.

---

## Topology

```mermaid
graph TB
    subgraph Browser["Browser / wallet"]
        UI[Next.js 16 dashboard<br/>/markets, /portfolio,<br/>/audit, /create]
        Privy[Privy embedded wallet<br/>+ wagmi v4]
    end

    subgraph Vercel["Next.js API routes (Vercel)"]
        DEPLOY[/api/admin/deploy-market<br/>sponsored createMarket<br/>+ Safe-cosigned setAdapter/]
        AIRDROP[/api/airdrop/gas<br/>0.005 ETH grants<br/>address-once + IP-rate-limited/]
        CHAINGPT[/api/chaingpt/generate-market<br/>natural-language → market params/]
        ATTEST[/api/attestation/generate<br/>EIP-191 selective-disclosure receipt/]
        POLY[/api/polymarket/*<br/>read-only Gamma mirror/]
        CREATED_BY[/api/markets/created-by/[address]<br/>MINE filter ledger/]
    end

    subgraph ArbSepolia["Arbitrum Sepolia (chainId 421614)"]
        REG[MarketRegistry<br/>EOA-owned for /create]
        IMPL[MarketImplementation v5<br/>clone target]
        MARKET[Market clones<br/>Open → Closed → Resolving<br/>→ ClaimWindow → Settled]
        CUSDC[ConfidentialUSDC<br/>ERC-7984 wrapper]
        TUSDC[TestUSDC<br/>ERC-20 + Permit]

        RESOLVE[ResolutionOracle<br/>per-market adapter routing]
        ADMIN[AdminOracle<br/>commit-reveal + 60s delay]
        PRE[PreResolvedOracle<br/>fixed-outcome demo path]
        CHAINLINK[ChainlinkPriceOracle<br/>mainnet-ready]

        VERIFIER[ClaimVerifier<br/>EIP-191 attestation gate]
        FEE[FeeVault<br/>2% protocol fee handles]
        FAUCET[Faucet<br/>1k tUSDC / 6h]
        SAFE[Gnosis Safe v1.4.1<br/>2-of-3, governs 7 contracts]
    end

    subgraph IExec["iExec Nox (Intel TDX)"]
        NOX[Nox protocol contract<br/>0xd464…c229]
        RUNNER[TDX Runner<br/>fixed Rust service<br/>processes encrypted ops]
    end

    subgraph External["External read-only sources"]
        GAMMA[Polymarket Gamma API<br/>display-only mirror]
        CG[ChainGPT GeneralChat<br/>+ Smart Contract Auditor]
    end

    UI -->|wagmi tx| MARKET
    UI -->|wagmi tx| CUSDC
    UI -->|wagmi tx| FAUCET
    UI --> Privy

    UI -.->|fetch| DEPLOY
    UI -.->|fetch| AIRDROP
    UI -.->|fetch| CHAINGPT
    UI -.->|fetch| ATTEST
    UI -.->|fetch| POLY
    UI -.->|fetch| CREATED_BY

    DEPLOY -->|cosign| REG
    DEPLOY -->|Safe cosign| RESOLVE
    AIRDROP -->|EOA tx| MARKET

    CHAINGPT -.->|HTTPS| CG
    POLY -.->|HTTPS| GAMMA

    REG -->|clones| IMPL
    REG -->|deploys| MARKET
    MARKET -->|placeBet/payout handles| CUSDC
    MARKET -->|fee handle| FEE
    MARKET -->|reads| RESOLVE
    RESOLVE -->|adapterOf| ADMIN
    RESOLVE -->|adapterOf| PRE
    RESOLVE -->|adapterOf| CHAINLINK
    CUSDC -->|wraps| TUSDC

    SAFE -.->|owns 7| TUSDC
    SAFE -.->|owns 7| RESOLVE
    SAFE -.->|owns 7| ADMIN
    SAFE -.->|owns 7| PRE
    SAFE -.->|owns 7| CHAINLINK
    SAFE -.->|owns 7| FEE
    SAFE -.->|owns 7| FAUCET

    MARKET -->|encryptInput / fromExternal<br/>add / mul / div / publicDecrypt| NOX
    CUSDC -->|encrypted handles| NOX
    NOX -->|TDX compute| RUNNER

    Privy -.->|wallet decrypt| NOX
```

`/api/admin/deploy-market` is the sponsored-deploy path: a connected wallet describes a market, the route Safe-cosigns `MarketRegistry.createMarket` + `ResolutionOracle.setAdapter` server-side, and the user gets a clickable market URL within ~30 seconds. Self-signed deploys (advanced operators with funded wallets) bypass the API entirely and call `MarketRegistry.createMarket` directly.

---

## Contracts

### `ConfidentialUSDC` (ERC-7984)

Confidential wrapper around TestUSDC. Implements ERC-7984 in full per the OpenZeppelin reference, with the operator pattern enabled so `Market` clones can pull encrypted balances from bettors via `confidentialTransferFrom` after a one-time approval.

- **Wrap:** `wrap(amount, encryptedHandle, inputProof)` — pulls plaintext TestUSDC via `transferFrom`, then `Nox.fromExternal(encryptedHandle, inputProof)` validates the encrypted amount matches the plaintext input and credits the user's confidential balance.
- **Unwrap:** `requestUnwrap(handle, recipient)` queues a `Nox.publicDecrypt` request; once the gateway-issued proof returns, anyone can call `executeUnwrap` to mint the plaintext TestUSDC back to the recipient.
- **Transfer:** `confidentialTransfer(to, handle)` and `confidentialTransferFrom(from, to, handle)` both return the actually-transferred handle (not the input handle), matching the canonical ERC-7984 invariant. F4.5 captured this return at every call site so silent-failure semantics on insufficient balance produce zero credit, never phantom balance.

### `MarketRegistry` + `Market` clones

`MarketRegistry` is an EIP-1167 minimal-proxy clone factory. `createMarket(...)` deploys a fresh proxy pointing at the current `MarketImplementation` and returns the new market id. The implementation is hot-swappable via `setMarketImplementation(addr)` (Safe-only); existing markets stay pinned to their original implementation, so V3 markets keep V3 behavior even after V5 ships.

The `Market` state machine (defined in `IMarket.State`):

```
Created → Open → Closed → Resolving → Resolved → ClaimWindow → Settled
                                            ↘ Invalid (refund all)
```

- **Created → Open:** the registry calls `initialize(...)` immediately after clone deployment, so markets enter Open in the same transaction.
- **Open → Closed:** automatic at `block.timestamp >= expiryTs`. No tx required to flip; later operations check the timestamp directly.
- **Closed → Resolving:** triggered by `resolveOracle()`. Reads `ResolutionOracle.resolve(marketId)`, which dispatches to the per-market adapter (`AdminOracle`, `PreResolvedOracle`, or `ChainlinkPriceOracle`).
- **Resolving → Resolved:** atomic — `resolveOracle()` either lands a YES/NO outcome or an INVALID outcome.
- **Resolved (YES/NO) → ClaimWindow:** requires `freezePool(yesProof, noProof)`. The proofs are gateway-issued `Nox.publicDecrypt` results for the published pool handles. Freezing the pool lands plaintext `yesPoolFinal` and `noPoolFinal` on-chain so `claimWinnings` can do per-bettor proportional math.
- **ClaimWindow → Settled:** automatic at `block.timestamp > claimWindowDeadline` (= `expiryTs + 7 days`). Unclaimed pool dust stays in the contract; `markInvalid()` is callable by the Safe in case of resolution griefing.
- **Invalid (any time):** all bettors call `refundIfInvalid()` to recover their original bet via `confidentialTransfer`. F5-fu auto-Invalidates if the winning side has zero bettors (otherwise division would revert).

Every Market clone holds an immutable `claimWindowDeadline = expiryTs + 7 days` and a `protocolFeeBps` (capped at 1000 = 10%). The current canonical clone target is `MarketImplementation v5` at [`0xf3aa6…27779`](https://sepolia.arbiscan.io/address/0xf3aa651f5e5c8ff51472ae2beab6ec1ed0d27779).

### Resolution adapters

`ResolutionOracle` is the single entry point that `Market.resolveOracle()` calls. Internally it routes by `adapterOf(marketId)` (set per-market via `setAdapter`):

| `oracleType` | Adapter                | Resolution path                                                                                           |
| ------------ | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `0`          | `AdminOracle`          | Commit-reveal: hash → 60s delay → reveal → outcome. Run via `tools/admin-resolve.ts`.                     |
| `1`          | `ChainlinkPriceOracle` | Sequencer-uptime check → heartbeat freshness → round completeness → threshold compare. Mainnet only.      |
| `2`          | `PreResolvedOracle`    | Outcome configured at oracle init via `configure(marketId, outcome)`. Used for demo + historical markets. |

After F10b's auto-wire patch, `/api/admin/deploy-market` Safe-cosigns `setAdapter` immediately after `createMarket`, so adapters are pre-routed without operator intervention. Pre-existing markets that lack an adapter wiring are recovered preflight in `tools/admin-resolve.ts`.

### `ClaimVerifier` (selective-disclosure receipts)

`ClaimVerifier.verifyAttestation(payload, signature)` is an EIP-191 ECDSA verifier with two immutable state vars: `pinnedTdxMeasurement` (the F5 measurement, currently `keccak256("DARKODDS_F4_DEMO_MEASUREMENT")` per the F4 placeholder) and `attestationSigner` (the deployer EOA acts as the pseudo-TDX signer in v1).

The flow:

1. User claims a winning position via `Market.claimWinnings()`. The contract grants the encrypted payout handle to `msg.sender` via `Nox.allow`.
2. User calls `/api/attestation/generate`, which produces a JSON payload `{recipient, marketId, outcome, payoutHandle, timestamp, nonce}` and signs it with `ATTESTATION_SIGNER_KEY` (server-side, EIP-191).
3. User downloads the attestation. They can keep it sealed forever, or hand it to an auditor / accountant / counterparty along with their wallet's `nox.decrypt(payoutHandle)` output.
4. The auditor calls `ClaimVerifier.verifyAttestation(payload, signature)` on-chain. If the signer matches `attestationSigner` and the measurement matches `pinnedTdxMeasurement`, the verifier emits `AttestationVerified` and the auditor has cryptographic confirmation that DarkOdds (specifically, the pinned TEE measurement) authored this receipt.

`ClaimVerifier` is **not** called from `claimWinnings`. It exists as an audit-trail artifact: the on-chain payout math runs without it; the attestation is purely a downstream selective-disclosure receipt the user can opt into. Background on why no application-level TDX measurement exists: [`tee-handlers/RUNTIME_DISCOVERY.md`](../tee-handlers/RUNTIME_DISCOVERY.md).

### `FeeVault`

Accumulates 2% protocol-fee handles from `Market.claimWinnings`. F5-current state: the fee handle is granted to the market contract and stays in its cUSDC balance. Post-judging, the Safe can drain accumulated fees via `cUSDC.confidentialTransfer(feeVault, feeHandle)` once `publicDecrypt` proofs are available off-chain. Splitting the claim UX across two transactions for a synchronous fee transfer was deemed worse than the documented honesty — see [`KNOWN_LIMITATIONS.md`](../KNOWN_LIMITATIONS.md#feevault-fee-collection-deferred-f5).

### `Faucet`

Safe-owned dispenser of 1,000 TestUSDC per address per 6 hours. Plain `safeTransfer` — no wrap, no allowance, `nonReentrant`. Sized at 10× the verifier's wrap default so a fresh wallet can run `verify:backend` once and still bet again.

### `TestUSDC`

ERC-20 + ERC-2612 Permit, 6-decimals. Mints are Safe-cosigned. Real USDC on Arbitrum is not permitted — the F8 wrap UX therefore falls back to two-tx approve-then-wrap on mainnet (`KNOWN_LIMITATIONS` discloses this honestly).

---

## Nox handle lifecycle

iExec Nox provides a confidential-data primitive (the **handle** = `euint256`) plus a fixed Rust runner inside Intel TDX that processes operations on those handles. The application contract emits ops as Solidity library calls (`Nox.add`, `Nox.mul`, `Nox.publicDecrypt`, etc.); the Ingestor picks them up; the Runner executes inside TDX; the result lands back on-chain as a new handle.

Two distinct decryption paths matter:

| Operation              | Use site                                          | Who can decrypt the result              |
| ---------------------- | ------------------------------------------------- | --------------------------------------- |
| `Nox.publicDecrypt(h)` | `Market.freezePool` for pool totals               | Anyone (handle is publicly decryptable) |
| `Nox.allow(h, addr)`   | `Market.claimWinnings` for per-user payout handle | Only `addr` via `nox.decrypt(handle)`   |

`verify:claim-flow` originally used `nox.publicDecrypt` against the payout handle and got a permission error — the contract uses `Nox.allow(payoutHandle, msg.sender)`, not `allowPublicDecryption`. The verifier was patched to use `nox.decrypt` (user-bound) which produced the `36,750,000` plaintext payout. This is exactly the privacy guarantee at work: pool totals are public; per-user payouts are not.

The full lifecycle of a single bet:

```
1. User picks YES, amount = 5 cUSDC
2. Frontend (lib/nox/client.ts):
     handle = await nox.encryptInput(5_000_000n, "uint256", marketAddress)
     // returns { ciphertext: 0x.., handle: euint256, inputProof: 0x.. }
3. wagmi tx:
     market.placeBet(YES, ciphertext, inputProof)
4. Market.placeBet (on-chain):
     bet = Nox.fromExternal(ciphertext, inputProof)
     transferred = cUSDC.confidentialTransferFrom(msg.sender, address(this), bet)
     yesPoolPending = Nox.add(yesPoolPending, transferred)
5. After 60s: anyone calls publishBatch
     yesPoolPublished = Nox.add(yesPoolPublished, yesPoolPending)
     yesPoolPending = Nox.toEuint256(0)
6. After expiry: resolveOracle()
     outcome = ResolutionOracle.resolve(marketId) // → YES
7. After resolution: freezePool
     yesPoolFinal = Nox.publicDecrypt(yesPoolPublished, gatewayProof)
     noPoolFinal  = Nox.publicDecrypt(noPoolPublished, gatewayProof)
     // both pool totals now plaintext on-chain
8. After 60s claim-open delay: claimWinnings()
     // pool totals are plaintext uints; userBet is still encrypted
     totalPool      = yesPoolFinal + noPoolFinal
     winningSide    = yesPoolFinal // (outcome was YES)
     gross = Nox.mul(userBet, Nox.toEuint256(totalPool))
     gross = Nox.div(gross, Nox.toEuint256(winningSide))
     fee   = Nox.div(Nox.mul(gross, Nox.toEuint256(protocolFeeBps)), Nox.toEuint256(10_000))
     payout = Nox.sub(gross, fee)
     cUSDC.confidentialTransfer(msg.sender, payout)
     Nox.allow(payout, msg.sender)
     emit ClaimSettled(marketId, msg.sender, payoutHandle)
9. Frontend (winner's wallet):
     plaintext = await nox.decrypt(payoutHandle) // → 36_750_000n
```

---

## 60-second batch publication

`Market.placeBet` accumulates encrypted bets into `yesPoolPending` / `noPoolPending`. Every 60 seconds, anyone can call permissionless `publishBatch` to fold the pending handle into the published one and zero the pending. The published handles are what `freezePool` decrypts at resolution.

The 60s cadence is the privacy-vs-staleness tradeoff:

- **Too short:** pool deltas reveal individual bet timing + size by inference. A market with 1 bet/min and per-block updates leaks bet size at every block.
- **Too long:** odds displayed in the UI become stale; bettors don't know what they're betting against.
- **60s on Arbitrum (~25 blocks/sec):** one batch covers ~1500 blocks of bets. Multiple bets per batch are common in active markets, so per-bet inference fails. Stale by 60s, which is below human-perceptible UI staleness.

The cadence is configurable per-protocol-version via the `BATCH_INTERVAL` constant (currently `60 seconds` in v5).

---

## Frontend & API routes

### Routes (Next.js 16 App Router)

```
/                             # landing — hero + howitworks + stack
/markets                      # list — DarkOdds + Polymarket dual feed, MINE filter
/markets/[id]                 # detail — pool state, bet flow, batch history
/portfolio                    # user positions + claim flow
/audit                        # selective-disclosure attestation upload + verify
/create                       # ChainGPT-powered market creation
/terms /privacy /disclaimer   # legal
/api/admin/deploy-market      # sponsored createMarket + setAdapter
/api/airdrop/gas              # 0.005 ETH grants for new wallets
/api/attestation/generate     # EIP-191 selective-disclosure receipts
/api/chaingpt/generate-market # NL → market params via GeneralChat
/api/markets/created-by/[address]   # MINE filter ledger read
/api/polymarket/markets       # Gamma list mirror (60s cache)
/api/polymarket/market/[id]   # Gamma single mirror (30s cache)
```

### State management

- **Wallet state:** Privy v3.22 (embedded by default, injected fallback). Wagmi v4 hooks are read via the Privy connector. The `useConnectedAddress()` hook (`web/lib/wallet/use-connected-address.ts`) is the single source of truth — it reads from Privy's `useWallets()` gated by `ready && authenticated`, fixing a hydration race where `useAccount().address` lagged Privy's ready signal by hundreds of ms.
- **Market data:** `web/lib/darkodds/markets.ts` (chain reads) + `web/lib/polymarket/gamma.ts` (read-only Gamma API). Both layers go through Next.js `fetch` with `next: {revalidate: ...}` for server-side caching.
- **Encrypted handle compute:** `web/lib/nox/client.ts` wraps `@iexec-nox/handle@0.1.0-beta.10`. `encryptInput` for bet placement, `publicDecrypt` for pool totals, `decrypt` for per-user payout handles.

### Read-only Polymarket mirror

`/api/polymarket/markets` proxies the Gamma list endpoint (`gamma-api.polymarket.com/markets`, no auth). DarkOdds renders Polymarket markets in the right column of `/markets` for bettor-side context. **No proxied trading** — the "VIEW ON POLYMARKET ↗" CTA is a plain link with `rel="noopener noreferrer"`. Geo-restriction on the destination is Polymarket's own concern. Quirks (events join missing on single-market endpoint, etc.) are documented in [`docs/POLYMARKET_INTEGRATION.md`](./POLYMARKET_INTEGRATION.md).

### ChainGPT integration

`/api/chaingpt/generate-market` posts the user's natural-language description to the ChainGPT GeneralChat endpoint with a structured prompt asking for `{question, resolutionCriteria, oracleType, expiryDays}`. The response is JSON-parsed and validated client-side before the user signs the deploy. CI runs `tools/chaingpt-audit.ts` on every contract change to keep `contracts/audits/chaingpt-2026-04-28.md` current; the showcase loop (`tools/chaingpt-showcase.ts`) generates a new spec contract from a NL DarkOdds description and pipes it back through the auditor.

---

## Deployment topology

| Component               | Where it runs                                | Why                                                                                   |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Contracts               | Arbitrum Sepolia                             | Cheap L2 testnet, EVM-compatible, supports Nox protocol contract at `0xd464…c229`     |
| Frontend + API          | Vercel (Next.js 16 App Router)               | Edge for static, serverless for API routes. KV available for ledger persistence.      |
| Encrypted compute       | iExec Nox (Intel TDX, protocol-managed)      | Confidential data + arbitrary compute. Application can't deploy custom runner images. |
| Auth + embedded wallets | Privy (managed)                              | Email/social → embedded wallet → wagmi-compatible. v3.22 + wagmi adapter v4.0.6.      |
| AI                      | ChainGPT (managed)                           | GeneralChat for spec generation, Smart Contract Auditor for CI gate.                  |
| Polymarket mirror       | Polymarket Gamma read APIs (no auth, public) | Display-only. We never write to Polymarket.                                           |

### Persistence backends

Two server-side ledgers — airdrop history and created-by — both use the same KV-or-file pattern:

- **Vercel KV** when `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set. Durable across deploys.
- **`/tmp/*-ledger.json`** fallback for local dev. Per-instance ephemeral on Vercel; doesn't survive deploy cycles. Production deploys must enable Vercel KV.

The `@vercel/kv` package is loaded lazily via `createRequire` so it stays an optional dependency. This avoids type pollution from `@safe-global/protocol-kit` widening viem's `Address` type to `string` app-wide when bundled alongside Privy's TypeScript types.

### Ownership model

| Contract               | Owner during judging       | Production owner                   |
| ---------------------- | -------------------------- | ---------------------------------- |
| `MarketRegistry`       | Deployer EOA (operational) | 2-of-3 Safe (restoration scripted) |
| `TestUSDC`             | 2-of-3 Safe                | 2-of-3 Safe                        |
| `ResolutionOracle`     | 2-of-3 Safe                | 2-of-3 Safe                        |
| `AdminOracle`          | 2-of-3 Safe                | 2-of-3 Safe                        |
| `PreResolvedOracle`    | 2-of-3 Safe                | 2-of-3 Safe                        |
| `ChainlinkPriceOracle` | 2-of-3 Safe                | 2-of-3 Safe                        |
| `FeeVault`             | 2-of-3 Safe                | 2-of-3 Safe                        |
| `Faucet`               | 2-of-3 Safe                | 2-of-3 Safe                        |

`MarketRegistry` is operationally delegated to the deployer EOA so the one-click `/create` flow doesn't need a second human in the loop during judging. Restoration is `tools/transfer-registry-ownership.ts --to-safe` — a single ~30s tx from the deployer. Audit trail in [`contracts/deployments/arb-sepolia.json`](../contracts/deployments/arb-sepolia.json) under `governance_history`. Full reasoning in [`KNOWN_LIMITATIONS.md`](../KNOWN_LIMITATIONS.md#registry-ownership-temporary-delegation).

---

## What we cut, and why

These are the architecture-shaping decisions the build hit and resolved, in order:

1. **OpenZeppelin Confidential Contracts → Nox-native cUSDC.** OZCC is FHEVM-bound; using it would have disconnected DarkOdds from Nox's on-chain ACL. F2 rewrote `ConfidentialUSDC` against `@iexec-nox/nox-protocol-contracts` directly. ERC-7984 spec compliance held at function-shape level. (PRD §5.1, drift entry F2-arch-halt.)
2. **Custom TEE handler images → Solidity library calls.** PRD §11 F5 expected four deployable handler images. Nox v0.1.0 doesn't expose a custom-handler runtime — the runner is a fixed Rust service. All compute is therefore expressed via `Nox.*` library calls in the Market contract; the TDX runner processes them inside the Intel TDX enclave. ([`tee-handlers/RUNTIME_DISCOVERY.md`](../tee-handlers/RUNTIME_DISCOVERY.md).)
3. **3-of-3 multisig → 2-of-3.** 2-of-3 preserves operator liveness during the demo while still resolving the F4 ChainGPT-flagged HIGH "admin centralization" finding. 3-of-5 hardware-signer multisig + timelock is roadmapped for production.
4. **Synchronous min-bet enforcement → documented dust-spam acceptance.** Nox v0.1.0's `Nox.ge` returns an `ebool` whose decryption needs an off-chain gateway proof; a synchronous `require(amount >= MIN_BET)` against an encrypted bet is structurally impossible in this protocol version. We accept the dust-spam vector (event pollution at <$0.001/tx) rather than ship a half-fix that locks legitimate users out of a side. (Documented in `KNOWN_LIMITATIONS`; proposal forwarded to the iExec/Nox team via `feedback.md`.)
5. **Permissionless `MarketRegistry.createMarket` → operational delegation.** Multisig-gated `createMarket` is incompatible with a one-click judge demo. We delegate registry ownership to the deployer EOA for the live-judging window and surface the state to users via a `GOVERNANCE STATE` topbar badge. Restoration is a single tx; audit trail is structured and grep-friendly.

The full inventory of accepted v1 risks lives in [`KNOWN_LIMITATIONS.md`](../KNOWN_LIMITATIONS.md). The roadmap to mainnet lives in [`Darkodds Master PRD v1.3.md`](../Darkodds%20Master%20PRD%20v1.3.md) §16.
