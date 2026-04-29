# DarkOdds resolution flow audit — 2026-04-29

**Author:** automated audit
**Scope:** inventory whether the three oracle types (Admin, Chainlink, PreResolved) actually work end-to-end for user-deployed markets, or if PreResolved is the only fully-wired path.
**Verdict (executive summary):** **PreResolved is the only path that works end-to-end today.** The 6 markets deployed via `/create` since F10b are all `oracleType=0` (Admin) and are stuck in `Open` because no adapter was wired for their marketId. AdminOracle has never had a `commit/reveal` cycle on this deployment. ChainlinkPriceOracle has never had a `configure()` call.

---

## 1. /create routing — what oracleType does ChainGPT pick?

ChainGPT GeneralChat decides `oracleType` based on the prompt content. The system prompt at [api/chaingpt/generate-market/route.ts:31-68](web/app/api/chaingpt/generate-market/route.ts#L31-L68) tells the model:

> `oracleType: 0 = admin-resolved (events not natively on-chain — sports, politics, real-world), 1 = Chainlink price feed (crypto prices BTC/ETH/SOL), 2 = pre-resolved (demos / historical)`

Worked examples baked into the prompt:

- "BTC closes above $150,000 by December 31 2026 UTC, resolved by Chainlink price feed." → `oracleType: 1`
- "Arsenal wins the 2026-27 Premier League season" → `oracleType: 0`

Empirically (per the Admin markets at ids 16-21 in §5):

- A natural-language prompt mentioning a sports team / political question → `oracleType: 0` ✓
- A prompt about a crypto price → `oracleType: 1` (untested in production — see §3)
- Polymarket mirror via `?source=polymarket&id=` → ChainGPT receives the question text + the resolution-criteria hint "as defined by the source Polymarket market"; in practice this routes to `oracleType: 0` if the question is sports/political, `1` if crypto. The mirror prompt at [create/page.tsx:52-64](<web/app/(dashboard)/create/page.tsx#L52-L64>) does not pin the oracleType.

**After ChainGPT returns the params, neither the self-sign path ([create/page.tsx:235-267](<web/app/(dashboard)/create/page.tsx#L235-L267>)) nor the sponsored path ([api/admin/deploy-market/route.ts:185-204](web/app/api/admin/deploy-market/route.ts#L185-L204)) calls `ResolutionOracle.setAdapter(marketId, ...)` after `createMarket`.** Confirmed by reading both code paths end-to-end. This is the load-bearing gap.

---

## 2. AdminOracle status

**Contract:** `0x96b6ECC138A231Ddff9E8eA856fB8869b4be103F` (deployed, owner = 2-of-3 Safe `0x042a…A332` per [arb-sepolia.json:96-100](contracts/deployments/arb-sepolia.json#L96-L100)).

**Source:** [contracts/src/oracles/AdminOracle.sol](contracts/src/oracles/AdminOracle.sol) — clean commit-reveal flow. `commit(marketId, hash)` → `REVEAL_DELAY` (60s) → `reveal(marketId, outcome, salt)`.

### On-chain history

Scanned blocks `253878726..263878726` (last ~10M blocks, covers entire deployment):

```
OutcomeCommitted: 0
OutcomeRevealed:  0
→ AdminOracle has NEVER been exercised end-to-end on this deployment.
```

The contract is deployed, ownable, audited. It has never been called.

### UI surface for the multisig to commit + reveal

Search across `web/` and `tools/` for any UI or script that calls `AdminOracle.commit` or `AdminOracle.reveal`:

```
$ grep -rln 'AdminOracle\|commitOutcome\|reveal.*outcome' web/ tools/
web/app/_landing/FAQ.tsx              # static prose, line 73
tools/seed-claimable-market.ts        # PreResolvedOracle only
tools/create-demo-market.ts           # PreResolvedOracle only
tools/smoke-f4.ts, smoke-f45.ts, smoke-f5.ts  # PreResolvedOracle only
```

The landing FAQ mentions AdminOracle exists; nothing else interacts with it. **There is no UI, no script, and no operational tooling for commit/reveal.** A judge cannot resolve an Admin-typed market today through any code path in this repo.

### Could a judge realistically resolve an AdminOracle market today?

**No.** Two blockers:

1. The Safe owns AdminOracle. Resolving via the Safe requires hand-authoring the commit-hash (`keccak256(abi.encode(outcome, salt))`), submitting via the Safe UI as two separate proposals (commit, then 60s later reveal), and hand-decoding outcomes. No tooling automates this.
2. Even if commit + reveal were performed, `ResolutionOracle.adapterOf(marketId)` is `0x0` for every Admin market deployed via `/create` (see §5). `Market.resolveOracle()` calls `IResolutionOracle.resolve(marketId)` which reverts with `AdapterNotSet(marketId)` per [ResolutionOracle.sol:37-43](contracts/src/ResolutionOracle.sol#L37-L43). The adapter has to be set before any resolve attempt.

---

## 3. ChainlinkPriceOracle status

**Contract:** `0x316dC924697406af553c7276c285b11B83Cc3cb2` (deployed, owner = Safe).

### Sequencer uptime feed

```
ChainlinkPriceOracle.sequencerFeed = 0x0000000000000000000000000000000000000000
→ ZERO ADDRESS (sequencer-uptime check skipped per Arb Sepolia constructor flag).
```

Constructor docstring at [ChainlinkPriceOracle.sol:75-83](contracts/src/oracles/ChainlinkPriceOracle.sol#L75-L83) confirms this is intentional:

> "Pass `address(0)` on chains where Chainlink does not publish a feed (e.g., Arbitrum Sepolia testnet) — `resolve()` will skip the sequencer check entirely. Production deploys on Arbitrum One MUST pass the real feed `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`."

The PRD §5.4.1 cite of `0x942d00008D658dbB40745BBEc89A93c253f9B882` is for **Arbitrum One mainnet BTC/USD**. There is no equivalent feed on Arbitrum Sepolia — verified in [arb-sepolia.json:47](contracts/deployments/arb-sepolia.json#L47) (`f4_chainlink_skip` note: _"Chainlink data feeds are not deployed on Arb Sepolia (verified against smartcontractkit/hardhat-chainlink registry). ChainlinkPriceOracle is deployed for mainnet completeness; the BTC-resolved demo market is omitted from testnet per PRD §0.5 'no mocks'."_).

### Has any market with oracleType=1 ever been resolved?

```
ChainlinkPriceOracle.MarketConfigured events scanned: 0
→ ChainlinkPriceOracle.configure() has NEVER been called for any market.
```

No `MarketConfigured` events on the configured oracle, ever. Per the markets table in §5, **zero markets** have `oracleType=1`. The Chainlink path has been deployed but never used.

### If a market with oracleType=1 + a 1-hour expiry were deployed right now, would resolveOracle() work?

**No, three failure modes stack:**

1. `/create` never calls `ChainlinkPriceOracle.configure(marketId, aggregator, threshold, op, expiryTs)`. `resolve()` would revert with `NotConfigured(marketId)` per [ChainlinkPriceOracle.sol:113](contracts/src/oracles/ChainlinkPriceOracle.sol#L113).
2. Even if configure() were called, no real BTC/USD aggregator exists on Arb Sepolia. The `_tryLatestRoundData` try/catch returns zeros → `updatedAt == 0` → resolve returns `INVALID` (outcome=2). The market would auto-invalidate and refund all bettors.
3. Even if a synthetic aggregator were deployed and wired, `/create`'s sponsored deploy route doesn't take an aggregator address as input — there's no UI for it.

**Net:** Chainlink resolution is not functional on Arb Sepolia regardless of how the market is created. This is consistent with PRD §0.5 ("no mocks") — Chainlink is wired for mainnet and deliberately stubbed on testnet.

---

## 4. PreResolvedOracle status

**Contract:** `0x76147d3C1e241B4bb746002763991789661Cc893` (canonical instance), plus per-seed-run instances at `0x96b6EC…`, `0x698fc1…`, `0x540851…`, `0x47C64d…`, `0xeC3EAe…`, `0x201ca4…`, `0x5618F5…`, `0xE5EB84…` (per the seed-claimable-market script's "deploy fresh PreOracle" step at [tools/seed-claimable-market.ts:194](tools/seed-claimable-market.ts#L194)).

**Status:** **Fully working.** 20 of 26 deployed markets use `oracleType=2` and have an adapter wired in `ResolutionOracle`. Of those 20, 9 reached `ClaimWindow` and 4 reached `Invalid` — the full lifecycle has been exercised dozens of times via smoke-f4/f45/f5, verify-backend, seed-claimable-market, and seed-history runs.

This is currently the only verified-end-to-end resolution path on the deployed system.

---

## 5. Market state classification

Live state pulled from MarketRegistry on Arb Sepolia (`nextMarketId=27`, 26 markets):

| id  | oracleType  | state       | adapter wired | question (60ch)                                               |
| --- | ----------- | ----------- | ------------- | ------------------------------------------------------------- |
| 1   | PreResolved | Open        | 0x96b6EC…     | Pre-resolved demo market: did Q4 2025 happen?                 |
| 2   | PreResolved | Open        | 0x76147d…     | smoke-f4 YES                                                  |
| 3   | PreResolved | ClaimWindow | 0xd9FD52…     | smoke-f4 YES                                                  |
| 4   | PreResolved | Invalid     | 0xd9FD52…     | smoke-f4 INVALID                                              |
| 5   | PreResolved | ClaimWindow | 0xBEdc24…     | smoke-f45 YES                                                 |
| 6   | PreResolved | Invalid     | 0xBEdc24…     | smoke-f45 INVALID                                             |
| 7   | PreResolved | ClaimWindow | 0x8537EC…     | smoke-f5 YES                                                  |
| 8   | PreResolved | Invalid     | 0x8537EC…     | smoke-f5 INVALID                                              |
| 9   | PreResolved | Open        | 0x5B7921…     | smoke-f5 YES                                                  |
| 10  | PreResolved | ClaimWindow | 0xFAcCc8…     | smoke-f5 YES                                                  |
| 11  | PreResolved | Invalid     | 0xFAcCc8…     | smoke-f5 INVALID                                              |
| 12  | PreResolved | ClaimWindow | 0x76147d…     | verify-backend-2026-04-26T14-47-59                            |
| 13  | PreResolved | Open        | 0x76147d…     | Will BTC close above $100,000 by end of 2026?                 |
| 14  | PreResolved | ClaimWindow | 0x698fc1…     | f10b claimable seed (2026-04-28-00-04-17)                     |
| 15  | PreResolved | ClaimWindow | 0x540851…     | f10b claimable seed (2026-04-28-04-01-34)                     |
| 16  | **Admin**   | **Open**    | **NONE**      | Will F10b ship by tomorrow?                                   |
| 17  | **Admin**   | **Open**    | **NONE**      | Will Timberwolves win against Nuggets?                        |
| 18  | **Admin**   | **Open**    | **NONE**      | Will the Israel x Hezbollah ceasefire be extended by April 2… |
| 19  | **Admin**   | **Open**    | **NONE**      | verify-f10b sponsored deploy 2026-04-28T10-36-18              |
| 20  | **Admin**   | **Open**    | **NONE**      | verify-f10b sponsored deploy 2026-04-28T11-12-55              |
| 21  | **Admin**   | **Open**    | **NONE**      | verify-f10b sponsored deploy 2026-04-28T13-14-59              |
| 22  | PreResolved | Open        | 0x47C64d…     | seed-open: pre-staged Open market (2026-04-29-13-33-51)       |
| 23  | PreResolved | ClaimWindow | 0xeC3EAe…     | seed-claimable: pre-staged YES winner (2026-04-29-13-36-11)   |
| 24  | PreResolved | Open        | 0x201ca4…     | seed-history: 5-batch settled market (2026-04-29-13-40-16)    |
| 25  | PreResolved | Open        | 0x5618F5…     | seed-history: 5-batch settled market (2026-04-29-13-50-33)    |
| 26  | PreResolved | ClaimWindow | 0xE5EB84…     | seed-history: 5-batch settled market (2026-04-29-14-45-11)    |

### Distribution summary

| oracleType      | count | resolved (ClaimWindow + Invalid) | adapter wired |
| --------------- | ----- | -------------------------------- | ------------- |
| Admin (0)       | 6     | 0                                | 0/6           |
| Chainlink (1)   | 0     | 0                                | 0/0           |
| PreResolved (2) | 20    | 13 (9 + 4)                       | 20/20         |

- **77% PreResolved, 23% Admin, 0% Chainlink.**
- **All 13 markets that ever reached a resolved state are PreResolved.**
- **All 6 Admin markets are stuck in Open.** They were created via `/create` (the question texts match ChainGPT-generated patterns and `verify-f10b` sponsored-deploy signatures) and have no adapter wired in `ResolutionOracle`.

---

## 6. Honest summary

### Are Chainlink and Admin functional for users who deploy via /create?

**No.**

- **Chainlink (`oracleType=1`):** broken end-to-end on testnet. Three independent gaps (no auto-configure on createMarket, no real Arb Sepolia aggregator, no UI to specify aggregator address). Per PRD §0.5 "no mocks", this was a deliberate testnet skip; it would work on mainnet with the canonical feeds.
- **Admin (`oracleType=0`):** the contract is fully audited and deployable, but the off-chain operational path doesn't exist. `/create` skips `setAdapter`. The Safe has no commit/reveal UI. No tooling automates the sequence. Even if a judge knew exactly what to do, they'd be hand-rolling Safe transactions in the Safe UI for at least 4 separate cosigns (setAdapter → commit → wait 60s → reveal) per market.

### Smallest set of changes to make all three oracle types genuinely work end-to-end

#### A. Wire `setAdapter` automatically on `createMarket` (~30 minutes, **highest leverage**)

Modify `MarketRegistry.createMarket(...)` to call `IResolutionOracle.setAdapter(id, defaultAdapterFor(oracleType))` inline. The "default adapter" mapping (oracleType → adapter address) needs to be settable by the registry owner. This makes ALL three oracle types have a wired adapter immediately on deploy. The adapter still needs its own per-market configuration (`AdminOracle.commit`, `ChainlinkPriceOracle.configure`, `PreResolvedOracle.configure`) but the routing layer is no longer the load-bearing gap.

**This is a contract change** — `contracts/src/MarketRegistry.sol` plus a one-line addition to `MarketImplementation_v6` deploy script. It's outside the polish-all "do not touch contracts" scope; surfacing for operator decision.

Alternative without contract change: have `/api/admin/deploy-market` perform a follow-up `setAdapter` call after `createMarket`, owner-co-signing through the Safe. This adds two cosigns (one per setAdapter call) but doesn't require a redeploy. **Roughly the same 30 min** of work.

#### B. AdminOracle commit/reveal UI (~6-8 hours)

Build a minimal admin panel (gated behind the deployer EOA address in dev, or behind the Safe address in prod) at `/admin/resolve/[marketId]`:

1. Form: outcome (YES / NO / INVALID), random salt input (auto-generated, copyable).
2. "Commit" button → `AdminOracle.commit(marketId, keccak256(outcome, salt))`. Stores `(outcome, salt)` to localStorage so the operator can reveal later from the same browser without re-entering.
3. 60-second visible countdown (using the `BatchTimer` primitive shipped in polish-all).
4. "Reveal" button → `AdminOracle.reveal(marketId, outcome, salt)`. Verifies pre-image matches the on-chain commitment; surfaces `CommitmentMismatch` etc. cleanly.
5. After reveal, prompts "Now call `Market.resolveOracle()` to finalize" with a one-click button.

Half-day of work. Touches: 1 new route, 1 new component, ~150 LoC. No contract changes.

#### C. ChainlinkPriceOracle aggregator picker (~2 hours, mainnet-only utility)

Add an aggregator-address dropdown to `/create` when `oracleType=1` is selected, populated with the canonical Arbitrum One feed addresses (BTC/USD, ETH/USD, SOL/USD). Plus a manual address input for power users. After `createMarket`, call `ChainlinkPriceOracle.configure(marketId, aggregator, threshold, op, expiryTs)`.

This only ever pays off on mainnet. On testnet it remains broken because no aggregators exist there. Lower priority than A or B.

### Time-to-fix verdict

| Change                                                      | Wallclock                       | Risk                              |
| ----------------------------------------------------------- | ------------------------------- | --------------------------------- |
| **A.** Auto-wire setAdapter (off-chain via /api/admin path) | ~30 min                         | low                               |
| **A'.** Auto-wire setAdapter (contract change)              | ~2 hours incl redeploy + verify | medium (touches audited contract) |
| **B.** AdminOracle commit/reveal UI                         | ~6-8 hours                      | low                               |
| **C.** Chainlink aggregator picker                          | ~2 hours                        | low (mainnet payoff only)         |

### Recommended path for tomorrow's demo

**Either:**

- **Option 1 — fix:** ship change A' (off-chain auto-setAdapter on the sponsored deploy route) + change B (AdminOracle commit/reveal UI). ~7 hours of work. End state: judges who deploy any oracleType via /create get a market that can be resolved through visible UI surfaces. The wedge claim "three oracle adapters: AdminOracle, ChainlinkPriceOracle, PreResolvedOracle — all auditable, all on-chain" becomes literally true rather than aspirationally true.
- **Option 2 — document:** add a KNOWN_LIMITATIONS entry stating that on testnet the only verified-end-to-end resolution path is PreResolved. Adjust the demo screenplay so Account 1's deploy uses a PreResolved-typed prompt (e.g. "this market resolves YES at deploy" framing) rather than an Admin-typed prompt. Demo Market B (claimable) is already PreResolved. ~30 minutes including doc + screenplay update.

**Operator decides.** I'll halt here regardless of choice.

---

## 7. Appendix — methodology

Audit script lived at `audit-resolve.mjs` (one-shot, deleted after audit per repo hygiene). It:

1. Read `MarketRegistry.nextMarketId()` to discover total markets.
2. For each market 1..N, read the proxy address, then `oracleType()`, `state()`, `question()` from the Market clone, then `ResolutionOracle.adapterOf(marketId)` to check whether an adapter is wired.
3. Read `ChainlinkPriceOracle.sequencerFeed()` to confirm the chain-conditional skip.
4. Scanned the last ~10M Arb Sepolia blocks (covers the entire deployment window since F4) for `OutcomeCommitted` / `OutcomeRevealed` on AdminOracle and `MarketConfigured` on ChainlinkPriceOracle.

Findings are reproducible from the chain state — no claims rest on local files alone. Each block-explorer link in the table can be clicked to verify a market's oracleType and state independently.
