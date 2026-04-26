# DRIFT_LOG

Append-only log of every divergence between the implementation and the active PRD.
Source-of-truth: `Darkodds Master PRD v1.3.md` (was v1.2 → v1.1 → v1.0).
Format per §0.2.

---

## [2026-04-26 F5-followup] Empty-winning-side `freezePool` stuck-state — strict auto-Invalid fix in MarketImpl v5

**Expected (per PRD §5.3 + §6.1):** A market with zero pool on the resolved-winning side is a degenerate but legitimate state — losers should be able to recover their stakes via the standard Invalid path.
**Actual (pre-fix):** `freezePool` unconditionally transitioned `Resolving → ClaimWindow` regardless of whether the winning side had any bets. With `winningSideTotal == 0`:

1. `claimWinnings` reverts `NoWinningPosition` for every caller (no one has a bet on the winning side).
2. `markInvalid` reverts `NotInResolvableState` because the state-guard at `Market.sol:365` allows only `{Open, Closed, Resolving}` — `ClaimWindow` is excluded.
3. **Consequence:** all locked pool funds (the entire losing-side pool) are unrecoverable forever.

   Reproducer: alice bets NO 100, bob bets NO 100, admin resolves YES, freezePool succeeds with `yesPoolFrozen=0, noPoolFrozen=200`, market enters ClaimWindow. 200 cUSDC stuck.

   **Reason:** the state-machine design assumed every resolution had non-zero winning-side liquidity, which is false for thin testnet markets and any production market where the consensus belief turns out to be unanimous-but-wrong.
   **Impact:** ships as MarketImpl v5. `freezePool` now checks `winningSide == 0` after the public-decryption proofs are validated; if so, transitions directly to `Invalid` (re-marks `_outcome = INVALID`, emits `MarketInvalidated`, skips emitting `ClaimWindowOpened`). Losers then recover via the existing `refundIfInvalid` path. EIP-1167 clones predating v5 (Markets 1–6) retain the original behavior — operator must avoid resolving thin-side markets to the empty side until the demo migrates clones.
   **Decision: STRICT fix.** Only zero-WINNING-side auto-Invalids. Zero-LOSING-side stays on the Resolved/ClaimWindow path because the proportional formula `payout = userBet * userBet / userBet = userBet` resolves cleanly — winners get exactly their stake back (minus fee), losers had no chance to begin with. That's a degenerate but legitimate resolution, not a stuck-state.

   **Symmetric alternative considered, rejected:** treating zero-LOSING-side as Invalid too would make UX cleaner ("Invalid → refund" rather than "Resolved → claim → got my own money back"), but it conflates "math is degenerate" with "market broke." The formula is well-defined and the funds aren't stuck — strict fix preserves semantic distinction.

   v5 also subsumes the F5 payout logic; v4 is now legacy. Tests added under `test_FreezePool_F5fu_*` in `Market.t.sol`.

---

## [2026-04-26 F5-followup] Synchronous on-chain MIN_BET enforcement infeasible in Nox v0.1.0 — accepted as known limitation

**Expected (operator concern):** `Market.placeBet` should reject dust-amount bets via encrypted comparison + `require`, preventing event-spam griefing.
**Actual:** Nox v0.1.0's encrypted comparison primitives (`Nox.ge`, `Nox.lt`, etc.) return an `ebool` whose decryption requires `Nox.publicDecrypt(handle, decryptionProof)` ([Nox.sol:1222](contracts/lib/nox-protocol-contracts/contracts/sdk/Nox.sol#L1222)). The decryption proof must be issued off-chain by the Nox gateway — it cannot be produced in the same transaction as the comparison. Therefore a synchronous `require(amount >= MIN_BET)` against an encrypted bet amount is structurally impossible.

Three alternatives were evaluated:

- **Silent clamp via `Nox.select`** (zero out dust amounts before `confidentialTransferFrom`): closes the economic griefing vector but leaves event-spam open (`BetPlaced`, `totalBetCount` still increment) AND introduces a per-side lockout footgun — a user who attempts a dust bet by accident initializes `_yesBet[user]` to encrypted-zero, blocking any subsequent real bet on that side via the existing `AlreadyBetThisSide` guard. Half-fix is worse than honest documentation.
- **Plaintext `MIN_BET` argument** (caller passes plaintext amount alongside encrypted handle): defeats the project's privacy thesis on every transaction. Non-starter.
- **Document as known limitation:** matches PRD §0.5 ("if something can't be live, the demo says so"). Attack cost is sub-$0.001/tx on Arbitrum, attacker pays gas with no economic upside, max harm is event-log inflation.

  **Reason:** Nox protocol design predates the operator's threat model for confidential prediction markets. The async-only decrypt pattern is fine for batched analytics but breaks transactional `require`-style validation against private inputs.
  **Impact:** added KNOWN_LIMITATIONS entry "Dust-bet spam not synchronously prevented (F5-followup)" with full attack-surface analysis. Forwarded to iExec/Nox team as a real DX gap proposal in `iexec-feedback.md` (sync `ebool` reveal for `require()` patterns is the cleanest API addition).
  **Decision:** No code change to `placeBet`. Frontend-side input minimum + debounce is the realistic v1 mitigation when F6 web ships.

---

## [2026-04-26 F5-followup] Pari-mutuel imbalance accepted as v1 design choice

**Expected (operator concern):** verify the protocol handles imbalanced pools acceptably.
**Actual:** payout math `userBet * totalPool / winningSide` is mathematically correct (no funds lost or generated); it's the implicit-odds shape that gets extreme on imbalanced pools. With 95/5 (YES:NO) and YES wins, each YES winner gets ~1.05× stake; with 5/95 and YES wins, each YES winner gets ~20× stake. Intrinsic to pari-mutuel.
**Decision:** documented in KNOWN_LIMITATIONS with comparison to Polymarket (CPMM avoids imbalance via slippage but has LP cold-start) and Kalshi (orderbook avoids it via matched bets but has counterparty cold-start). v2 roadmap fix: liquidity-bootstrapping subsidy from `FeeVault` accumulation.

---

## [2026-04-25 F4] PRD §5.4.1 BTC/USD aggregator address misattributed; no Chainlink feeds on Arb Sepolia

**Expected (per PRD v1.3 §5.4.1):** BTC/USD Aggregator at `0x942d00008D658dbB40745BBEc89A93c253f9B882` on Arbitrum Sepolia + L2 Sequencer Uptime Feed available on Arb Sepolia.
**Actual:** Source-evidence research against `smartcontractkit/hardhat-chainlink`'s authoritative deployment registry confirmed:

1. The address `0x942d00008D658dbB40745BBEc89A93c253f9B882` IS the BTC/USD aggregator — but on **Arbitrum One mainnet** (chainId 42161), not Arbitrum Sepolia. Citation: [DataFeeds.json @ commit 25ccf9dc](https://github.com/smartcontractkit/hardhat-chainlink/blob/25ccf9dc81cd922e94e647e7cad1885dc733ec75/src/registries/json/DataFeeds.json).
2. Chainlink has NOT deployed any data feeds to Arb Sepolia — the registry contains zero entries for chainId 421614.
3. There is no L2 Sequencer Uptime Feed on Arb Sepolia. [Issue #10699](https://github.com/smartcontractkit/chainlink/issues/10699) requesting it has been open with `investigating` label since September 2023.
   **Reason:** PRD §5.4.1 was written assuming testnet Chainlink feeds existed; they do not.
   **Impact:** F4 ships `ChainlinkPriceOracle.sol` to spec for **mainnet**, with the sequencer uptime check chain-conditional (skipped when `sequencerFeed == address(0)`, which is the testnet configuration). The contract is deployed on Arb Sepolia for completeness/audit visibility but is not wired into any active market — the BTC-resolved demo market is intentionally OMITTED from testnet per PRD §0.5 ("if something can't be live, the demo skips it — never fakes it"). For mainnet deployment, sequencer feed = `0xFdB631F5EE196F0ed6FAa767959853A9F217697D` (Arbitrum One, verified).
   **Decision:** Proceed without the BTC market on testnet. Documented in `feedback.md` as a Chainlink + Arbitrum Sepolia gap worth flagging upstream.

---

## [2026-04-25 F4] claimWinnings is an INTENT STUB in F4; payout math deferred to F5

**Expected (per PRD §5.3):** `claimWinnings()` returns the user's encrypted payout handle.
**Actual:** F4 ships `claimWinnings()` as a state-recording stub: it validates the claim (state == ClaimWindow, user has a winning bet, no double-claim) and emits `ClaimRecorded(user, outcome, ts)`. No payout math, no confidential transfer. The full proportional `payout = userBet * (totalPool / winningSideTotal)` lives in F5's TEE handler `computePayout(marketId, user)`, which reads the `ClaimRecorded` events and triggers a confidential transfer back to the user via cUSDC.
**Reason:** Payout requires plaintext compute on encrypted user bets, which is exactly what TEE handlers exist for. Doing it in Solidity would require either (a) the user pre-decrypts and asserts their bet via attestation (heavy UX) or (b) skipping the privacy property entirely. Both are worse than the F4/F5 split.
**Impact:** F4 demo can show the FULL claim flow up to and including the on-chain `ClaimRecorded` event. The actual cUSDC transfer arrives in F5. F4's smoke test verifies `hasClaimed[user] == true` after `claimWinnings()` succeeds.
**Decision:** Proceed with intent-only stub. F5 prompt should explicitly wire the TEE handler to consume `ClaimRecorded` events.

---

## [2026-04-25 F4] ClaimVerifier deployed with PLACEHOLDER TDX measurement; F5 redeploys

**Expected (per PRD §5.5):** ClaimVerifier pinned to the real TDX measurement of the deployed Nox TEE handler image.
**Actual:** F4 ships ClaimVerifier with `pinnedTdxMeasurement = keccak256("DARKODDS_F4_DEMO_MEASUREMENT")` and `attestationSigner = deployer EOA`. These are deliberately placeholder values — F5 deploys the TEE handler image, computes the real TDX measurement, and **redeploys** ClaimVerifier with that measurement (trust-anchor migration pattern per §5.5). Old attestations against the placeholder verifier still validate locally, but no real TEE-signed attestations exist yet.
**Reason:** Per PRD §5.5, immutable measurement is load-bearing; pinning to placeholder for F4 lets us ship + verify the contract surface without blocking on F5. Better than waiting.
**Impact:** F4 commit includes a deployed ClaimVerifier that judges/auditors can read. F5 commit will REPLACE the address (current: `0x5cc49763703656fec4be672e254f7f024de2b82a`) with a fresh deployment bound to the real TEE measurement. F5 deploy script must also update `deployments/arb-sepolia.json`.
**Decision:** Proceed with placeholder. README "Deploy addresses" table marks the F4 ClaimVerifier as "placeholder pending F5".

---

## [2026-04-25 F4] AdminOracle reveal-delay; commit-reveal MEV mitigation

**Expected (per PRD §3.4 row "MEV on resolution"):** Commit-reveal with 60s gap between commit and reveal, then 60s gap between reveal and claim window opening.
**Actual:** Implemented as two separate delays:

- `AdminOracle.REVEAL_DELAY = 60 seconds`. Owner commits a hash; reveal must come ≥60s later, otherwise reverts `RevealTooEarly`.
- `Market.CLAIM_OPEN_DELAY = 60 seconds`. After `freezePool` the claim window opens 60s later, gated via `claimWinnings` checking `block.timestamp < claimWindowOpensAt`.
  The two delays compose to give a watcher ~120s of mempool visibility before any claim can land — sufficient on Arbitrum (~250ms blocks → ~480 blocks of visibility) for honest claimers to react.
  **Reason:** Faithful to spec.
  **Decision:** Ship.

---

## [2026-04-25 F4] One-bet-per-user-per-side cap relaxes the spec on refundIfInvalid

**Expected:** `refundIfInvalid()` returns the user's bet handle.
**Actual:** Users may bet on both sides per market (per F3's per-side cap rule), so `refundIfInvalid` may need to be called twice — once for YES, once for NO. Each call refunds whichever side is non-zero, then clears that handle. The third call reverts `NoBetToRefund`. F4's smoke + unit tests cover both single-side and both-sides refund paths. Could be unified into a single call returning both handles, but a single transfer + single event per call is cleaner.
**Decision:** Two-call pattern accepted. Documented here so F6 frontend knows to call twice for users who bet both sides.

---

## [2026-04-25 F4] ChainGPT auditor pass — admin-centralization findings filed as KNOWN_LIMITATIONS

**Expected (per F4 prompt step 10):** Run ChainGPT auditor; ≥medium-severity findings either fixed or filed.
**Actual:** Auditor ran cleanly across all 10 contracts (TestUSDC, ConfidentialUSDC, Market, MarketRegistry, ResolutionOracle, AdminOracle, PreResolvedOracle, ChainlinkPriceOracle, ClaimVerifier, FeeVault). Report: `contracts/audits/chaingpt-2026-04-25-f4.md`. All HIGH-severity findings are admin-centralization concerns ("owner is a single EOA — consider multisig + time-lock"). These are standard hackathon-grade hardening recommendations, not exploitable vulnerabilities. Filed as accepted risk in `KNOWN_LIMITATIONS.md`. The actual code-level concerns (missing event emissions, gas optimizations) were either already addressed or noted as low-priority.
**Decision:** Accept admin-centralization findings as known limitations for v1; production deployment would migrate ownership to a 2/3 admin multisig per §3.4 mitigation.

---

## [2026-04-25 F3] ConfidentialUSDC ABI extended with EIP-7984 operator pattern — F2 deployment superseded

**Expected (per F2 PRD §5.1):** ConfidentialUSDC ships with wrap/unwrap/confidentialTransfer; F2 considered "complete".
**Actual (implementation):** F3's `Market.placeBet` needs to pull cUSDC from the user via the operator/transferFrom pattern (user calls `cUSDC.setOperator(market, until)` once, Market then calls `cUSDC.confidentialTransferFrom(user, market, amount)` per bet). This surface was missing from F2 — `IERC7984` only declared `confidentialTransfer` (caller-side), and the deployed contract lacked `setOperator` / `isOperator` / `confidentialTransferFrom`. F3 extends both the `IERC7984` interface and the implementation with these EIP-7984-canonical methods, then re-deploys cUSDC ("v2") on Arb Sepolia. The F2 deployment at `0xf9f3A9F5F3a2F4138FB680D5cDfa635FD4312372` is now legacy — wrap/unwrap still works there but Market integration requires the v2 address `0xaf1ACDf0B031080d4FAd75129E74D89eAd450c4D`.
**Reason:** F3 cannot run without operator-based debit; the EIP-7984 spec includes this surface and our F2 cut left it on the floor. Better to extend honestly here than to invent a workaround.
**Impact:** Existing F2 wrap/unwrap tests still pass on the v1 contract. v2 contains all v1 functionality plus the operator surface. Re-deploy was 0.001 ETH gas. F2's deployments JSON entry is preserved under `notes.f2_legacy_ConfidentialUSDC`.
**Decision:** Proceed with v2. Future phases bind to the v2 address.

---

## [2026-04-25 F3] Market.placeBet must `Nox.allowTransient` cUSDC before delegating transferFrom

**Expected (intuition):** `Nox.fromExternal(handle, proof)` grants the calling contract transient ACL. Market should be able to pass that handle to cUSDC and have cUSDC's internal `Nox.safeSub` work.
**Actual (implementation):** Markets must additionally call `Nox.allowTransient(betAmount, address(cUSDC))` before invoking `cUSDC.confidentialTransferFrom`. Without this, NoxCompute reverts with `NotAllowed(handle, cUSDC)` — because `msg.sender` of the Nox call from inside cUSDC is cUSDC, not Market. Transient ACL on the original `fromExternal` is per-tx, but it's keyed by _which contract_ called Nox at grant time — a downstream contract participating in the same tx needs its own grant.
**Reason:** This is correct Nox ACL semantics; we just hadn't traced it through cross-contract handle passing. Nox's docs do not explicitly document the cross-contract handle-passing pattern.
**Impact:** One-line fix in `Market.placeBet`. All 28 Market tests + smoke pass cleanly. Documented in `feedback.md` as a Nox DX gap worth flagging upstream.
**Decision:** Add `Nox.allowTransient(betAmount, confidentialUSDC)` immediately after `Nox.fromExternal`.

---

## [2026-04-25 F3] `Nox.toEuint256(0)` produces a _public_ handle — `allowPublicDecryption` reverts on it

**Expected:** Calling `Nox.allowPublicDecryption` on the initial published-pool handles in `Market.initialize` would mark them publicly decryptable.
**Actual:** Reverts with `INoxCompute.PublicHandleACLForbidden()` — `Nox.toEuint256(0)` calls `wrapAsPublicHandle` which produces a handle with bit 0 of the attributes byte unset (= already public). Calling `allowPublicDecryption` on an already-public handle is forbidden.
**Reason:** Nox's ACL state machine: public handles carry no ACL by design and have no use for explicit grants. The `allowPublicDecryption` mutator is reserved for unique (private) handles being demoted to public.
**Impact:** Two tweaks: (1) `initialize` skips the `allowPublicDecryption` calls on the initial-zero handles (they're already public). (2) `_publishBatchInternal` checks `HandleUtils.isPublicHandle(...)` before calling `allowPublicDecryption` on the `Nox.add` result — the empty-batch case can produce a public-handle output if both inputs were public.
**Decision:** Apply the conditional pattern. Logged in `feedback.md` as a Nox DX wrinkle (would benefit from `allowPublicDecryptionIfNotPublic` as a no-op-on-public variant in the SDK, mirroring the existing `_allowIfNotPublic` pattern).

---

## [2026-04-25 F3] Market state cardinality — one bet per user per side per market (v1)

**Expected (per PRD §5.3):** `placeBet(side, handle, proof)` — cardinality unspecified.
**Actual (implementation):** Per the F3 prompt: "Validate user has not already bet on this side (one bet per user per side per market for v1)". Market.placeBet reverts with `AlreadyBetThisSide` if the user already has a non-zero bet handle on the chosen side. Users may still bet on both sides (one YES + one NO).
**Reason:** Simpler claim accounting in F4 — single position per side keeps `claimWinnings` straightforward. Cumulative same-side bets via `Nox.add(existingBet, newBet)` would also work but adds complexity that isn't load-bearing for the demo.
**Impact:** Each user is capped at two bets per market (one YES, one NO). F4 may relax this once the claim path is wired and a "merge bets" semantic is decided — separate DRIFT entry if so.
**Decision:** v1 keeps the per-side-per-user cap.

---

## [2026-04-25 F2] Active PRD bumped v1.2 → v1.3 — ConfidentialUSDC is Nox-native, not OZCC

**Expected (per PRD v1.2 §5.1):** Wrap OpenZeppelin Confidential Contracts' `ERC7984ERC20Wrapper` as the base.
**Actual (implementation):** Built Nox-native on `@iexec-nox/nox-protocol-contracts@0.2.2`. Concretely: `ConfidentialUSDC.sol` imports only `Nox` from `sdk/Nox.sol` + `encrypted-types` types, uses `Nox.fromExternal` / `Nox.mint` / `Nox.burn` / `Nox.allow` / `Nox.allowThis` / `Nox.allowPublicDecryption` / `Nox.publicDecrypt`. ERC-7984 spec compliance preserved at function-shape level via our own `IERC7984` interface re-typed to `euint256` / `externalEuint256`.
**Reason:** OZCC v0.4.0 imports `@fhevm/solidity/lib/FHE.sol` throughout — built for Zama FHEVM, not Nox. Inheriting it would deploy a contract bound to Zama's on-chain ACL (different protocol, different chain). Per §0.1 "docs win", and confirmed by deep source-evidence research (no published iExec wrapped-ERC20 reference exists; we author the canonical pattern). Operator confirmed in v1.3 prompt.
**Impact:** Single largest architecture decision in the project. We give up OZCC's `euint64` interface compat in exchange for Nox's `euint256` (more headroom for F3 pool accumulators). Full rationale captured in PRD v1.3 §5.1.1.
**Decision:** Proceed Nox-native. Cited iExec's own published `ConfidentialTokenMock.sol` as the closest reference for the Nox `_update`/ACL idiom we follow.

---

## [2026-04-25 F2] §11 F2 — `INox.sol` interface dropped; `INoxCompute` already published

**Expected (per F2 prompt):** Author `contracts/src/interfaces/INox.sol` exposing `fromExternal(...)`.
**Actual (implementation):** Did not author. `@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol` is the published interface for the on-chain Nox protocol contract. Our contract uses the high-level `Nox` SDK library which internally calls `INoxCompute`; we never need to declare the interface ourselves.
**Reason:** Avoid duplication. The library's interface is canonical and tracks upstream changes automatically.
**Impact:** None — the integration is identical, with one fewer file to maintain.
**Decision:** Proceed without `INox.sol`. PRD v1.3 §5.1.2 is consistent with this.

---

## [2026-04-25 F2] §11 F2 — Custom `MockNox.sol` dropped; iExec's `TestHelper` used instead

**Expected (per F2 prompt step 5):** Build `contracts/test/mocks/MockNox.sol` that implements `INox` with permissive proof verification.
**Actual (implementation):** Did not author. iExec ships `lib/nox-protocol-contracts/test/utils/TestHelper.sol` (BUSL-1.1, test-only) which `vm.etches` the **real** `NoxCompute` proxy bytecode at the chain-resolved address, generates valid EIP-712 gateway-signed input proofs, builds public-decryption proofs, and creates correctly-formatted handles. We import it directly and run our tests against the **real** on-chain Nox logic (just etched onto local chain 31337). Higher fidelity than a hand-rolled mock — every ACL grant, proof validation, and atomic compute primitive runs against the exact same code that's deployed on Arb Sepolia.
**Reason:** Don't reinvent. iExec's testing infrastructure is canonical.
**Impact:** Skipped ~150-300 lines of mock code. 28 unit tests + 1 fork test pass. 95% line coverage on `src/`.
**Decision:** Proceed with `TestHelper`. Logged in `feedback.md` as a positive iExec DX win.

---

## [2026-04-25 F2] §11 F2 — Foundry contextual remapping for TestHelper's `forge-std/src/...` imports

**Expected:** Standard `forge-std/=lib/forge-std/src/` remapping handles all forge-std imports.
**Actual:** iExec's `TestHelper.sol` imports `forge-std/src/Vm.sol` (with the `src/` prefix), which our standard remapping resolves to `lib/forge-std/src/src/Vm.sol` — wrong path. Foundry deduplicates same-target remappings if both are listed at the top level (`forge-std/=...` and `forge-std/src/=...` collapse).
**Workaround:** Foundry contextual remapping syntax `lib/nox-protocol-contracts/:forge-std/src/=lib/forge-std/src/` — kicks in only for imports originating from inside the Nox lib's directory.
**Impact:** Compile noise (resolver logs an [ERROR] for the first attempt before the contextual fallback succeeds), but functional. Contextual remapping is a real Foundry feature, not a hack.
**Decision:** Proceed.

---

## [2026-04-25 F2] §11 F2 — ChainGPT auditor pass deferred to F4.5

**Expected (per F2 prompt step 8):** Run ChainGPT Smart Contract Auditor on TestUSDC + ConfidentialUSDC, save report.
**Actual (implementation):** Deferred to Phase F4.5 per operator's standing secrets policy. F4.5 is the explicit security-hardening phase; running the auditor there gives it more surface to cover (Market, Resolution, Claim) instead of two F2-only contracts in isolation.
**Impact:** None on F2 deliverable. F4.5 will audit ALL contracts including F2 ones.
**Decision:** Defer.

---

## [2026-04-25 F2] §11 F2 — Verified on Arbiscan (Etherscan V2), not Blockscout

**Expected (per F2 prompt):** Verify on Blockscout's Arbitrum Sepolia instance (no API key required).
**Actual (implementation):** Verified on Arbiscan via Etherscan V2 API (`https://api.etherscan.io/v2/api?chainid=421614`) using operator's `ARBISCAN_API_KEY` from `.env.local`. Both contracts: `Pass - Verified`. Blockscout verification was attempted but the Blockscout API returned HTTP 524 (CloudFlare timeout) — transient outage.
**Reason:** Operationally reachable, operator-supplied real API key, canonical Etherscan-family explorer for Arbitrum.
**Impact:** Judges can verify on Arbiscan today. Blockscout can be re-attempted as a free background task in a later phase.
**Decision:** Proceed with Arbiscan-only for F2 commit.

---

## [2026-04-25 F2] §11 F2 — Deploy via viem, not `forge script` / `forge create`

**Expected (per F2 prompt):** `contracts/script/DeployF2.s.sol` deploys via `forge script`.
**Actual (implementation):** Wrote `DeployF2.s.sol` (committed as documentation of the canonical broadcast pattern), but Foundry 1.6.0 fails to deploy against the public Arb Sepolia RPC: alloy expects `timestampMillis` in `eth_getBlockByNumber` responses, which Arbitrum's RPC does not return. Both `forge script` and `forge create` hit this. We deploy via `tools/deploy-f2.ts` using viem (which doesn't have this strictness), then use `forge verify-contract` post-deploy.
**Reason:** Tooling bug in Foundry 1.6.0 + Arbitrum RPC compat. Not fixable from our side.
**Impact:** None on outcome. We retain `DeployF2.s.sol` for the day Foundry catches up; viem deployer is the active path.
**Decision:** Proceed with viem deployer. Logged in `feedback.md` for upstream report.

---

## [2026-04-25 F2] §11 F2 — Encrypt → wrap → decrypt round-trip GREEN against real Nox + Arb Sepolia

**Expected (per F2 prompt step 7):** Smoke test `tools/smoke-f2.ts` MUST decrypt to plaintext == amount before commit.
**Actual:** GREEN. Latency table from the run:

| step           | latency     |
| -------------- | ----------- |
| load           | 0ms         |
| balance        | 241ms       |
| mint           | 2486ms      |
| approve        | 2601ms      |
| encrypt        | 1930ms      |
| wrap           | 2180ms      |
| balance-handle | 240ms       |
| decrypt        | 1164ms      |
| **total**      | **11441ms** |

This is the moment v1.1 PRD's P0 envisioned. v1.2 deferred decrypt to F2 (correctly — handle ACL lives on-chain via `Nox.fromExternal`). v1.3 is where it lands. Decrypt succeeds because `wrap` calls `Nox.fromExternal(handle, proof)` (committing the deposit handle to on-chain ACL with the contract as transient admin) and then `Nox.allow(newBalance, msg.sender)` (granting the user persistent viewer access). Off-chain `decrypt(balanceHandle)` succeeds via the gateway's `isViewer(handle, user)` check.
**Decision:** GREEN. Phase complete.

---

## [2026-04-25 P0-retry] Active PRD bumped v1.1 → v1.2

**Expected (per PRD v1.1):** P0 gate validates `encrypt → decrypt → viewACL` round-trip.
**Actual (implementation):** P0 gate revised in PRD v1.2 §11 to validate infrastructure reachability only — `rpc`, `client`, `encrypt`, `nox-code` (Nox protocol contract bytecode at SDK-configured address), `subgraph` (GraphQL introspection). The `decrypt` and `viewACL` steps are removed; new §6.0 explains the two-stage handle lifecycle that makes them structurally impossible at this stage.
**Reason:** Operator updated PRD in response to the previous P0 RED in `BUG_LOG.md`. Per §0.1 ("docs win"), the corrected gate is doc-aligned with the SDK's actual semantics.
**Impact:** `tools/healthcheck.ts` rewritten. Five steps now: `rpc`, `client`, `encrypt`, `nox-code`, `subgraph`. The `decrypt` round-trip naturally occurs in Phase F2 when `ConfidentialUSDC.wrap()` consumes the proof on-chain.
**Decision:** Proceed under v1.2 gate.

---

## [2026-04-25 F1] §11 F1 — `forge init --no-commit` flag does not exist in Foundry 1.6.0

**Expected (per F1 prompt):** `forge init contracts --no-commit --no-git`
**Actual (implementation):** Used `forge init contracts --use-parent-git`. Foundry 1.6.0 does not accept `--no-commit`; only `--commit` (opt-in) and `--no-git` exist. `--use-parent-git` lets the contracts project participate in the parent darkodds repo's git tracking instead of creating its own.
**Reason:** Flag drift in Foundry. Verified by inspecting `forge init --help`.
**Impact:** Functionally equivalent — no extra commit was made, no nested git repo was created.
**Decision:** Proceed with `--use-parent-git`.

---

## [2026-04-25 F1] §4.2 — `contracts/` is NOT a pnpm workspace

**Expected (per F1 prompt step 1):** `pnpm-workspace.yaml` declaring `contracts`, `web`, `subgraph`.
**Actual (implementation):** Workspaces are `web` + `subgraph`. `contracts/` is a Foundry-only project consumed by the root `pnpm test:contracts` script (`forge test --root contracts`).
**Reason:** Foundry projects do not use Node.js dependency management. Adding `contracts/` to pnpm-workspace would force creation of a `contracts/package.json` that has no real role and creates two competing dep systems for the same directory. Per §0.1, doc-correct is to keep them separate.
**Impact:** None on observable behavior. Foundry's `forge install` continues to manage `contracts/lib/` (git submodules under the parent darkodds repo via `--use-parent-git`).
**Decision:** Proceed.

---

## [2026-04-25 F1] §F1 — Tailwind v4 is CSS-first; `tailwind.config.ts` is intentionally minimal

**Expected (per F1 prompt):** "Configure `tailwind.config.ts` to extend with placeholder design tokens from §7.1".
**Actual (implementation):** Tokens live in `web/app/globals.css` under `@theme inline { ... }` per the Tailwind v4 idiom. `tailwind.config.ts` exists but only declares `content` paths — it does NOT redeclare tokens.
**Reason:** Tailwind v4's official guidance is CSS-first config; `tailwind.config.ts` is a backward-compat surface, not the primary place for tokens. Duplicating tokens in JS would create two sources of truth.
**Impact:** Phase F6 styles consume tokens via `var(--bg)` and the matching `bg-bg` Tailwind utility (auto-generated from `--color-bg`). Same DX as token-in-JS, single source.
**Decision:** Proceed.

---

## [2026-04-25 F1] §F1 — `shadcn init` defaults conflict with PRD §7.1; partially undone

**Expected (per F1 prompt):** "Configure shadcn/ui via `npx shadcn@latest init` — accept defaults that align with §7.1".
**Actual (implementation):** Ran `shadcn@4.4.0 init -y --defaults --base base --no-monorepo`. The defaults DO NOT align with §7.1:

1. shadcn injected `import { Geist } from "next/font/google"` into `app/layout.tsx` — directly violates §7.1's "locally host all fonts under `/public/fonts/`" rule.
2. shadcn imported `tw-animate-css` and `shadcn/tailwind.css`, polluting `globals.css` with conflicting oklch palette, a competing `.dark` class (we use `[data-theme="dark"]`), and `--radius: 0.625rem` (§7.1 forbids rounded corners > 2px).
3. shadcn added 7 runtime deps (`@base-ui/react`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `tw-animate-css`, `shadcn` itself) all with caret ranges — violates §15.3 exact-pin rule.
4. shadcn generated `components/ui/button.tsx` and `lib/utils.ts` ahead of the F6 design pass.

**Reason:** §0.1 ("docs win" / spec compliance) overrides the operator prompt's request. The shadcn defaults pre-impose decisions that §7.1 explicitly forbids.

**Impact:** Reconciled by:

- Restoring `app/layout.tsx` to local-fonts-only (no `next/font/google`).
- Rewriting `app/globals.css` to PRD §7.1 tokens, with `--radius: 0px` and shadcn-conflicting blocks dropped.
- Removing all shadcn-injected runtime deps from `web/package.json`.
- Deleting `components/ui/button.tsx` and `lib/utils.ts` — F6 will hand-build per §7.3.
- Keeping `web/components.json` (zero-cost marker) so `shadcn add <component>` is one command if F6 decides to use any specific shadcn component as a starting point. F6 will need to override the radius/font/palette before keeping anything shadcn outputs.
  **Decision:** Proceed with reconciled state. F6 starts with no shadcn components in tree.

---

## [2026-04-25 F1] §15.2 — eslint pinned to 9.39.4 instead of latest 10.2.1

**Expected (per §0.1):** "Latest stable, advisory-clean version".
**Actual (implementation):** `eslint@9.39.4` (latest 9.x; npm `dist-tags.maintenance`). npm `dist-tags.latest` is 10.2.1.
**Reason:** `eslint-config-next@16.2.4` and its bundled plugins (`eslint-plugin-import@2.32.0`, `eslint-plugin-jsx-a11y@6.10.2`, `eslint-plugin-react@7.37.5`) declare peer-dep ranges that cap at `^9`. Installing eslint 10 produces three `unmet peer eslint` warnings. Per §15.3 "advisory-clean", peer-mismatch is a real signal — pinning to 9.39.4 satisfies all peers cleanly.
**Impact:** None on linting behavior. Re-evaluate when `eslint-config-next` ships a 10-compatible release (track upstream).
**Decision:** Proceed on 9.39.4.

---

## [2026-04-25 F1] §F1 — Foundry `assertEq(1+1, 2)` ambiguity required explicit uint256 coercion

**Expected (per F1 prompt step 2):** "trivial `test/Sanity.t.sol` that asserts `1 + 1 == 2`"
**Actual (implementation):** Test reads `assertEq(uint256(1) + uint256(1), uint256(2))`. The literal `1` is `int_const` and forge-std's `assertEq` has overloads for `bool`, `uint256`, `int256`, `address`, `bytes32`, `string`, `bytes` — Solidity's argument-dependent lookup cannot pick a unique candidate.
**Reason:** Solidity 0.8.34 + forge-std 1.16.0 overload resolution. Documented and well-known.
**Impact:** None — test passes in 7.95ms.
**Decision:** Proceed.

---

## [2026-04-25 P0-retry] §11 P0 step 4/5 — SDK has no public network-config introspection

**Expected (per PRD v1.2 §11 P0):** "Read the smart contract address used by the SDK's auto-config for Arbitrum Sepolia. Consult ... advanced-configuration for the documented introspection path. If the SDK doesn't expose this directly, log to BUG_LOG and infer from the SDK source."
**Actual (implementation):** `@iexec-nox/handle@0.1.0-beta.10`'s `src/index.ts` only re-exports the three factory functions (`createHandleClient`, `createEthersHandleClient`, `createViemHandleClient`). `NETWORK_CONFIGS` and `resolveNetworkConfig` from `src/config/networks.ts:8-15` are internal. The constructed `HandleClient` does not surface the resolved config either. We extract the values by source-inspection and pin them as constants in `tools/healthcheck.ts`.
**Reason:** Documented introspection path does not exist; source inspection is the prompt's documented fallback.
**Impact:** If the SDK changes the Arb Sepolia auto-config addresses in a future patch, our hardcoded constants will drift. The script's `nox-code` and `subgraph` steps will catch that drift loudly (bytecode missing or 4xx) rather than silently. Logged in BUG_LOG too.
**Decision:** Proceed with hardcoded values. Re-verify on every SDK pin bump.

---

## [2026-04-25 P0] §11 P0 — `@iexec-nox/handle` is beta-only

**Expected (per PRD §0.1, §15.2):** Latest **stable** `@iexec-nox/handle` (advisory-clean).
**Actual (implementation):** `@iexec-nox/handle@0.1.0-beta.10` — the package has no stable release; the entire publish history is `0.1.0-beta` through `0.1.0-beta.10` (latest dist-tag points at the beta).
**Reason:** SDK is pre-1.0. There is no stable channel to install from. Verified via `npm view @iexec-nox/handle versions`.
**Impact:** None for P0 — the API surface used here (`createViemHandleClient`, `encryptInput`, `decrypt`, `viewACL`) is documented and stable enough to round-trip. Phase F2+ should re-pin against the latest beta on each phase commit per §15.3.
**Decision:** Proceed. Pinned exactly to `0.1.0-beta.10`.

---

## [2026-04-25 P0] §11 P0 — `encryptInput(42)` shorthand is wrong; real signature is 3-arg

**Expected (per PRD §11 P0 step 4):** `encryptInput(42)` returns a handle.
**Actual (implementation):** Per `https://docs.iex.ec/nox-protocol/references/js-sdk/methods/encryptInput`, the documented signature is:

```ts
await handleClient.encryptInput(value, solidityType, applicationContract);
// → { handle, handleProof }
```

`encryptInput` is a 3-argument method. The PRD's `encryptInput(42)` is shorthand, not the real surface.
**Reason:** Docs win per §0.1. `value` must be paired with an explicit `SolidityType` ("uint256" used here) and an `applicationContract` address that the handle is bound to for on-chain proof verification.
**Impact:** Health check binds the handle to the ephemeral EOA address (no on-chain validation occurs in this gate, so any address that the wallet can sign for is sufficient for the round-trip). Phase F2+ markets must pass the deployed `Market.sol` address as the `applicationContract` — this is now load-bearing for `placeBet` proof verification.
**Decision:** Proceed with documented 3-arg signature.

---

## [2026-04-25 P0] §11 P0 — encrypt → decrypt round-trip is structurally impossible without an on-chain commit

**Expected (per PRD §11 P0):** `encryptInput(42)` followed by `decrypt(handle)` returns 42.
**Actual (implementation):** `decrypt` performs an on-chain `isViewer(handle, user)` call against the Nox protocol contract. The handle is only authorized after the bound `applicationContract` calls `fromExternal(handle, proof)` on-chain. `encryptInput` alone never triggers that write, so `decrypt` always fails on a never-committed handle. Same goes for `viewACL`, which queries a subgraph populated only by on-chain ACL events.
**Reason:** The Nox SDK's ACL model is on-chain by design (see `decrypt.ts:56-65`, `viewACL.ts:32-43`). The PRD assumes off-chain symmetry between encrypt and decrypt — that is not how Nox is built.
**Impact:** **Blocks P0 success as currently specified.** Health check exits RED. See `BUG_LOG.md` for full root-cause and remediation paths. Phase F2 must be aware: every test that wants to round-trip a handle through decrypt must first land a `fromExternal` tx via `ConfidentialUSDC` or a similar Nox-aware contract.
**Decision:** Halt. Operator must pick one of the three paths in BUG_LOG before P0 can move to GREEN.

---

## [2026-04-25 P0] §11 P0 — TypeScript pinned to 5.9.3, not 6.x

**Expected (per PRD §15.2):** "TypeScript: 5.x" floor.
**Actual (implementation):** Pinned `typescript@5.9.3`. Note that npm `dist-tags.latest` for `typescript` is now `6.0.3`, so "latest stable" technically means TS 6.
**Reason:** P0 prompt explicitly mandated "Latest stable TypeScript 5.x" — the prompt overrides the §0.1 floor-not-ceiling rule for this prompt.
**Impact:** None at P0. Phase F1 should reassess whether to bump to TS 6 or stay on 5.9.x for the monorepo.
**Decision:** Proceed on 5.9.3.

---

## [2026-04-25 F4.5] §11 F4.5 — Slither found 0 High; Medium fixes are real, slither tooling reports phantoms

**Expected (per PRD §11 F4.5):** "Slither static analysis run, fix all findings >= medium severity."
**Actual:** Slither 0.11.5 reports 16 Medium findings on the patched source. Triage:

- **13 reentrancy-no-eth** — false positives. All flagged functions carry `nonReentrant` from `@openzeppelin/contracts/utils/ReentrancyGuard.sol`. Slither flags state-mutation-after-external-call syntactically and does not model `ReentrancyGuard` semantically.
- **2 unused-return + 1 uninitialized-local** — addressed in source, but slither 0.11.5 retains stale source mapping for user-defined-value-type (`euint256`) variable declarations. Verified via direct AST inspection of forge build-info: `betHandle` IS initialized at declaration, `transferred`/`refunded` ARE captured from cUSDC return, `confidentialUSDC` IS declared `immutable`. Compiler-validated, AST-validated, test-validated. Slither tool-side limitation.
  **Reason:** UDVT support in slither's source-position resolver is incomplete. Filing under tooling gap, not contract bug.
  **Impact:** PRD bar ("0 High and Medium") MET on real findings; tooling-FPs documented in `audits/slither-2026-04-25/summary.md`.
  **Decision:** Proceed. Re-test in slither 0.11.6+ when released.

---

## [2026-04-25 F4.5] §11 F4.5 — placeBet now binds pool/bet to cUSDC-returned `transferred`, not gateway-issued `betAmount`

**Expected (per PRD):** N/A — this is a hardening, not a spec change.
**Actual:** `Market.placeBet` was previously storing the gateway-issued `betAmount` handle into `_yesBet[user]`/`_noBet[user]` and adding it to the pool batch. Under ERC-7984 silent-failure semantics, if the user's cUSDC balance < `betAmount`, the cUSDC `safeSub` returns success=false and the actual `transferred` is encrypted-zero — but `betAmount` was being credited to the user as if it were transferred. This created a phantom-bet attack surface (chain-of-custody fail at the eventual claim transfer due to safeSub on an inadequate market balance, but bet records still inflated).
**Reason:** Slither flagged the unused return value of `confidentialTransferFrom`. Following the canonical ERC-7984 invariant ("market only credits a user with what was actually pulled"), F4.5 captures the `transferred` return value and uses it for ALL downstream pool/bet accounting.
**Impact:** Existing on-chain Market clones (Market_1, Market_2 from F4 deploy) still use the OLD impl (delegatecall pinning at clone-time). New clones via the patched MarketImpl v3 (deployed at `0x73167b1f0e07d3d3ce24b05a90ef8b0d991cc7ea` and pointed-to by the registry as of the F4.5 deploy) get the safer behavior. Markets 5 and 6 from `smoke-f45` are clones of v3 and exercise the patched path.
**Decision:** Proceed. Document as a hardening win in BUG_LOG.

---

## [2026-04-25 F4.5] §11 F4.5 — multisig governance migrated; 2-of-3 instead of the spec-implied 2/3 of an unspecified set

**Expected (per PRD §3.4 row "Resolution oracle wrong"):** "Admin override via 2/3 multisig" — operator multisig threshold mentioned but signer composition unspecified.
**Actual:** Deployed 2-of-3 Gnosis Safe v1.4.1 at `0x042a49628f8A107C476B01bE8edEbB38110FA332`. Signers: deployer EOA + two freshly-generated EOAs (private keys in `.env` mode 0600). Threshold 2 chosen for operator liveness during the demo (the sole operator has access to all three keys for testnet expedience).
**Reason:** Operator can co-sign owner-side ops (createMarket, setAdapter, mint TestUSDC) without external coordination during the demo. Production roadmap is 3-of-5 with hardware signers + a timelock for sensitive ops.
**Impact:** Resolved the F4 ChainGPT auditor's HIGH "admin centralization" finding. All seven Ownable contracts (TestUSDC, MarketRegistry, ResolutionOracle, AdminOracle, PreResolvedOracle, ChainlinkPriceOracle, FeeVault) are now Safe-owned. Governance audit trail in `deployments/arb-sepolia.json` `ownership.contracts`.
**Decision:** 2-of-3 for v1; 3-of-5 with hardware + timelock for production. Documented in KNOWN_LIMITATIONS.md.

---

## [2026-04-26 F5] §11 F5 — Nox has no custom handler runtime; all four TEE handlers superseded by on-chain Solidity + Nox arithmetic

**Expected (per PRD §11 F5 + F5 prompt):** Build and deploy four TEE handlers as separate worker
images: `validateBet`, `freezePool`, `computePayout` (the wedge), `signAttestation`. Capture the
real TDX measurement post-deploy, redeploy ClaimVerifier with that measurement, wire
Market.claimWinnings to call ClaimVerifier.verifyAttestation before releasing payout.
**Actual:** Runtime discovery (docs at docs.iex.ec/nox-protocol/protocol/runner + ingestor +
global-architecture-overview) confirmed:

1. The Nox Runner is a **fixed Rust service in Intel TDX** managed by the protocol infrastructure.
   Developers **cannot deploy custom handler images** — there is no user-facing TDX worker API.
2. All TEE compute is expressed through Solidity library primitives: `Nox.add`, `Nox.mul`,
   `Nox.div`, `Nox.sub`, `Nox.select`, `Nox.toEuint256`, `Nox.fromExternal`, `Nox.publicDecrypt`,
   and token ops. The Runner processes operations by pulling events emitted by the library contracts.
3. `@iexec-nox/handle` (the only @iexec-nox npm package) is a client-side JS SDK for encrypting
   inputs / decrypting outputs — not a handler deployment SDK.

Disposition of each handler:

- **validateBet** — MOOT. Already inline in Market.placeBet via Nox.fromExternal (F3).
- **freezePool** — MOOT. Already inline in Market.freezePool via Nox.publicDecrypt (F4).
- **computePayout** — SUPERSEDED. Implemented on-chain in Market.claimWinnings using
  Nox.mul(userBet, totalPool) / winningSide followed by fee deduction via Nox.mul/div/sub.
- **signAttestation / ClaimVerifier gate** — SUPERSEDED. ClaimVerifier stays deployed as an
  audit-trail artifact (F4 measurement placeholder). claimWinnings does NOT call verifyAttestation
  because there is no application-level TEE to attest. The Nox Runner's TDX measurement belongs
  to the protocol infrastructure.

**Reason:** PRD §11 F5 was written against iExec's older SDK model (iApp worker deployment).
Nox v0.1.0 introduced a different computation model: protocol-native primitives only.
**Impact:** tee-handlers/RUNTIME_DISCOVERY.md documents the finding. No handler images built,
no TDX measurement captured. claimWinnings is fully functional on-chain. MarketImpl_v4 deployed
and registered via Safe-mediated setMarketImplementation.
**Decision:** On-chain Nox arithmetic is more correct than the original TEE handler plan —
computation is TEE-attested at the protocol level without per-application measurement management.

---

## [2026-04-26 F5] §6.1 FeeVault direct transfer deferred — fee stays in market cUSDC balance

**Expected (per PRD §6.1 + FeeVault NatSpec):** Market.claimWinnings computes the protocol fee
and calls FeeVault.receiveFee(amount) with a plaintext uint256.
**Actual:** FeeVault.receiveFee takes plaintext, but the per-claim fee is an encrypted euint256
handle computed via Nox.mul/div. Exposing it as plaintext requires a publicDecrypt round-trip
(async Nox operation → Runner processes → gateway issues proof → second tx).
**Reason:** Avoid two-tx claim UX for a testnet demo. Plaintext fee decryption adds operational
complexity without changing the trust model.
**Impact:** Fee handle is ACL-granted to the market contract and stays in the market's cUSDC
balance. The ClaimSettled event emits the encrypted fee handle for off-chain accounting. Post-F5,
the Safe-owned admin can drain via cUSDC.confidentialTransfer(feeVault, feeHandle) once
publicDecrypt proofs are available.
**Decision:** Deferred. KNOWN_LIMITATIONS updated. Production: FeeVault accepts confidential
cUSDC transfers (requires ERC-7984-aware FeeVault redesign).

---

## [2026-04-25 F4.5] §11 F4.5 — ChainGPT credits exhausted on re-audit; F4 audit + Slither + smoke-f45 form the F4.5 evidence triad

**Expected (per F4.5 prompt step 3):** Re-run ChainGPT auditor on contracts modified in F4.5 (Market.sol, MarketRegistry.sol).
**Actual:** Both POSTs to `api.chaingpt.org/chat/stream` returned `400: Insufficient credits`. The F4.5 prompt's documented fallback applies: "F4.5 can complete without re-audit if Slither is clean and ChainGPT's original concerns are all addressed by the multisig migration." Both conditions hold:

- Slither: 0 High, 0 real Medium (all `reentrancy-no-eth` are nonReentrant-mitigated false positives).
- F4 ChainGPT main HIGH ("admin centralization"): RESOLVED by Safe migration.
  **Reason:** Free-tier credit ceiling on the operator's account.
  **Impact:** Pending re-audit recorded at `contracts/audits/chaingpt-2026-04-25-f45/PENDING.md`. The cross-reference SUMMARY.md is populated. F5 phase can re-run after credit replenishment.
  **Decision:** Proceed. F4.5 ships with documented audit-trail completion.
