# DarkOdds — Master PRD

> **Confidential prediction market on Arbitrum Sepolia. Public outcomes, public odds, hidden bet sizes. Selective-disclosure payouts via iExec Nox.**
>
> **Submission:** iExec Vibe Coding Challenge × ChainGPT — DoraHacks
> **PRD version:** 1.3 (post F2 architecture halt — Nox-native lock)
> **Build operator:** Claude Code
> **Author:** Tim (winsznx)

---

## v1.3 changelog

- §5.1 rewritten — ConfidentialUSDC is Nox-native, built on `@iexec-nox/nox-protocol-contracts`, NOT inheriting OpenZeppelin Confidential Contracts (which is FHEVM-bound and would disconnect from Nox's on-chain ACL). ERC-7984 spec compliance held at function-shape level. Type compat trade-off: `euint256` (Nox) over `euint64` (OZCC) — actually better for pool accumulators in F3.
- §5.1.1 added — explicit "why Nox-native" rationale captured for posterity. This was a real architecture call, not a default.

## v1.2 changelog

- §6.0 added — Nox SDK ground truth (two-stage handle lifecycle: gateway-side ciphertext, then on-chain ACL commit via `fromExternal`). Read this before building.
- §11 P0 rewritten — corrected gate validates infrastructure reachability (RPC, gateway, Nox protocol contract bytecode, subgraph). Removed the impossible decrypt round-trip; that exercise belongs to Phase F2 where `ConfidentialUSDC.wrap()` naturally calls `fromExternal`.
- §15.2 — `@iexec-nox/handle` is beta-only, no stable channel; pin exactly to latest beta and re-pin on every phase commit.
- `encryptInput` corrected from 1-arg shorthand to 3-arg `(value, solidityType, applicationContract)` per Nox docs.

## v1.1 changelog

- §3.3 step E: pool side-totals batched and decrypted every 60s, not instant
- §3.3 new step E.1: batch publishes show count of bets in batch (selective disclosure in action — count revealed, sizes hidden)
- §3.4 added rows: ACL key rotation, attestation replay, claim queue saturation, batch front-running, resolution griefing
- §5.3 `Market.sol`: `nonReentrant` on placeBet and claimWinnings, new `claimWindowDeadline`, new `markInvalid()` for griefing protection
- §5.5 `ClaimVerifier.sol`: TDX measurement pinned immutably at deployment, no setter
- §6.2 added: lazy public decryption with 60s batch interval, atomic batch processing
- §7.3 added `<ClaimQueue>` component for claim flow position display
- §9.2 attestation format: added optional `recipient` field (default present, recommended), optional `nonce`
- §9.5 new: attestation modes — recipient-bound (default) and bearer (opt-in)
- §11 inserted Phase F4.5 — security hardening pass
- §14 added `KNOWN_LIMITATIONS.md` as deliverable
- §16 new: known limitations to document honestly

---

## 0. Operating Rules — read this first, agent

These rules govern every prompt, every session, every commit. Violating them is a stop-the-build event.

### 0.1 — Always verify latest

Before installing or upgrading any dependency, the agent MUST resolve the latest stable, advisory-clean version from the official source. Never trust this PRD's version pins as authoritative. The pins in §15 are **floors, not ceilings.**

When uncertain about API surface, signature, or behavior: read the official docs first. URLs are listed in §15. Do NOT pattern-match from memory or stale tutorials.

If the docs disagree with this PRD, **the docs win.** Log the divergence in `DRIFT_LOG.md` and proceed with the doc-correct version.

### 0.2 — Drift log

Maintain `DRIFT_LOG.md` at repo root from prompt 0. Append an entry every time the implementation diverges from this PRD for any reason. Format:

```
## [YYYY-MM-DD HH:MM] §<section> — <one-line summary>

**Expected (per PRD):** <what PRD said>
**Actual (implementation):** <what was built>
**Reason:** <why diverged — bug / outdated PRD / better pattern / dep change>
**Impact:** <what downstream sections this affects>
**Decision:** <proceed | escalate to operator>
```

No drift is too small. If you change a contract function signature, a package version, a state machine state, a CSS variable name — log it. The drift log is the single source of truth for how the actual build differs from this spec.

### 0.3 — Bug log

Maintain `BUG_LOG.md` at repo root. Append every encountered bug, with reproduction and resolution. Format:

```
## [YYYY-MM-DD HH:MM] <component> — <one-line summary>

**Repro:** <minimal steps>
**Symptom:** <what was observed>
**Root cause:** <what was actually wrong>
**Fix:** <what was changed>
**Time to fix:** <minutes>
**Tags:** <#contracts | #frontend | #sdk | #infra | #tee>
```

This log is part of the deliverable — it surfaces depth of work to judges in `feedback.md`.

### 0.4 — feedback.md

Maintain `feedback.md` at repo root from prompt 0. iExec ranks this artifact in the rubric. Capture, as you build:

- What worked smoothly in the Nox SDK and Solidity Library
- Where docs were unclear or absent
- Bugs encountered with the SDK or contracts (cross-reference BUG_LOG.md)
- Suggestions for improving the developer experience
- DX comparisons to other confidential-compute SDKs you know

Aim for 600–1200 words of specific, technical, useful feedback. Generic feedback ("docs are good!") is worth zero. Concrete feedback ("the encryptInput helper returns `bytes32` but contract expects `externalEuint64`, mismatch caused 2hr debug, would suggest …") is worth full points.

### 0.5 — Hard rules

- **NO mocked data.** Anywhere. Demo runs against real Arbitrum Sepolia, real Nox handles, real TEE round-trips. If something can't be live, the demo skips it — never fakes it.
- **NO grids in layout.** Specifically: no Tailwind `grid-cols-*` classes for primary content layout. Single-column, two-column max via Flexbox, or list-row patterns. (Charts internally may grid; layout structure does not.)
- **NO generic AI fonts.** Inter, Roboto, Arial, system fonts, Space Grotesk are banned. Approved fonts in §7.1.
- **NO purple gradients.** No "AI hackathon" aesthetic. No bento boxes. No glassmorphism cards. No floating dashboard cards on solid color.
- **Latest versions, always.** See §0.1.
- **Spec compliance, always.** ERC-7984 must be implemented in full per OpenZeppelin reference and iExec Nox docs. Partial implementations = disqualification.

---

## 1. Mission & Pitch

### 1.1 — One-sentence WHAT

> DarkOdds is a confidential prediction market on Arbitrum Sepolia where outcomes are public, odds are public, but bet sizes are hidden — and winners claim payouts with cryptographic proofs they can selectively show to auditors, governments, or nobody.

### 1.2 — WHY (the pull)

Polymarket did $9B+ in 2024 election volume. Every wallet that bets gets scraped by trackers, copied by sharps, and doxxed when wins go viral. **The sharper your edge, the more you get punished for showing it.** DarkOdds keeps the wager private and the market public — the part that needs to be public stays public, the part that needs to be private stays private.

### 1.3 — HOW (the technical wedge)

The hard problem in confidential prediction markets is **proportional pari-mutuel payout**: when winners share the losing pool by stake, you need division on encrypted values. Pure FHE struggles with division — the existing Labz/OpenZeppelin reference market sidesteps it by simplifying payout to "winner gets own bet back," which is not a real market.

DarkOdds solves division by computing payout **inside the Intel TDX TEE in plaintext**, then re-encrypting the result via Nox handles. This is the first fully proportional pari-mutuel confidential market — and it is only possible because Nox's TEE-backed handles can carry arbitrary computation, not just additive operations.

The 30-second pitch:

> _"Polymarket but your bet size is hidden. Built on iExec Nox: outcomes and odds are public, your stake is encrypted. When you win, you get a cryptographic receipt you can show your accountant — or keep sealed forever. We solved the proportional payout problem that pure-FHE markets couldn't, by doing the math in TEE plaintext."_

---

## 2. Strategic Positioning

### 2.1 — Rubric alignment

| Criterion                        | DarkOdds hit                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| End-to-end no mocks              | Live on Arb Sepolia, real Nox handles, real TEE compute                                                                                    |
| ERC-7984 spec compliance         | Full implementation via `cUSDC` confidential token wrapping test USDC                                                                      |
| Composability with existing DeFi | Resolution oracle pluggable (Chainlink demo, UMA roadmap), payout exits as standard ERC-20                                                 |
| Selective disclosure as feature  | First-class — `/audit` page where users prove wins to third parties                                                                        |
| Intel TDX TEE round-trip visible | Every bet placement and every claim shows the encrypted handle and the attestation in the UI                                               |
| ChainGPT integration depth       | Smart Contract Generator generates new market contracts from natural language; Auditor runs in CI on every contract; visible in demo video |
| Real-world use case              | Polymarket has $9B+ volume, every bettor pain — universal pull                                                                             |

### 2.2 — Differentiation from prior winners

| Project                         | Their approach                            | Our differentiation                                     |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| Labz/OpenZeppelin ref market    | FHE, simplified "winner gets own bet"     | TEE plaintext compute → full proportional pari-mutuel   |
| iPred (Inco)                    | Full-confidential market on FHEVM         | Public odds for liquidity, hidden sizes only — surgical |
| ShadowSwap (iExec Hack4Privacy) | Confidential DEX on Hyperliquid           | Different chain, different primitive (markets ≠ swaps)  |
| Polymarket                      | Public everything                         | We are the privacy-on dual                              |
| Veil Markets (Arcium)           | Confidential prediction on Solana via MPC | Different ecosystem, different cryptographic substrate  |

---

## 3. End-to-End User Lifecycle

The following lifecycle MUST work end-to-end in the demo. Every step exercises real on-chain or TEE state.

### 3.1 — User states

```
Visitor → Connected → Funded → BettingActive →
    OutcomeAwaiter → Winner | Loser →
    Winner: ClaimReady → Claimed → AttestationHolder
    Loser: Archived
```

### 3.2 — Market states

```
Created → Open → Closed → Resolving →
    Resolved(YES) | Resolved(NO) | Invalid →
    ClaimWindow → Settled
```

### 3.3 — Full A-to-Z

**A. Visitor lands on `/`**
Sees a list (not grid) of open markets. Each row shows question, current pool sizes (YES/NO), implied odds, time-to-close, total volume. List is dense, scannable, Bloomberg-coded.

**B. Visitor connects wallet**
Privy modal. Email/social or external wallet. Lands on Arbitrum Sepolia automatically. If wrong network, prompt switch.

**C. User funds**
Modal: "Get test USDC." Click → faucet endpoint mints 1000 test USDC to user. Then click "Wrap to confidential" → `ConfidentialUSDC.wrap(amount)` triggers Nox `encryptInput` → returns handle → user receives ERC-7984 cUSDC. UI shows balance as redacted bar with toggle "👁 view" that calls `decrypt`.

**D. User picks a market**
Click row → `/market/[id]`. Page shows:

- Question (large editorial type)
- Pool sizes YES/NO (public, large numerics in mono)
- Odds bar (single horizontal split, YES green / NO oxblood)
- Time-to-close timer
- "Place bet" panel (right side or below — flex column)
- Recent activity feed (anonymized: "someone bet on YES 14s ago" — no amounts)

**E. User places a bet**
Selects YES or NO + amount (slider or direct input). Frontend:

1. Calls Nox SDK `encryptInput(amount)` → handle + proof
2. Submits tx `Market.placeBet(side, handle, proof)`
3. Contract verifies proof, debits user's confidential balance, credits market side-pool (encrypted accumulator handle)
4. Tx confirms, position appears in user's portfolio (encrypted)
5. **Pool side-totals do NOT update publicly on this tx.** Side-pool handles remain ACL'd to the TEE only. Bets accumulate within a 60-second batch window.
6. UI toast: "Bet placed. Your size is sealed. Pool reveals in batch (next: 23s) ← arbiscan"

**E.1. Batch publication (every 60s)**
A keeper (or anyone) can call `Market.publishBatch()` after the 60s window elapses:

1. TEE handler `publishBatch` decrypts the accumulated YES total and NO total
2. Re-publishes them as publicly-decryptable handles
3. Emits event `BatchPublished(marketId, batchId, betsInBatch, yesTotal, noTotal)` — the batch count is public, individual sizes are not
4. Frontend reads new totals via `publicDecrypt`, recomputes odds bar
5. UI surfaces "+N bets settled into pool" with no amounts disclosed — this IS selective disclosure in action: count revealed, sizes hidden

The 60s window is a deliberate UX × privacy trade-off. UI shows a countdown timer to the next batch. Bets within a batch are indistinguishable from each other.

**F. Bet window closes**
At `expiryTs`, `Market.closeMarket()` callable by anyone (or auto via cron-keeper). State: `Open → Closed`. No more bets.

**G. Resolution**
Three demo markets, three resolution paths:

1. **Chainlink-resolved** — `Market.requestResolution()` reads price feed at expiryTs+5min, posts outcome
2. **Admin-resolved** — operator multisig posts `Market.adminResolve(outcome)`
3. **Pre-resolved historical** — for guaranteed demo flow, one market is created with a resolved outcome already so the claim flow can be demonstrated regardless of live oracle latency

State: `Closed → Resolving → Resolved(outcome)` then `→ ClaimWindow`. Resolution emits a public event with outcome and pool snapshots.

**H. Winner claims**
User on `/portfolio` sees their resolved positions. For each winning position:

1. Click "Claim"
2. Frontend calls `Market.claimWinnings(marketId)`
3. Contract triggers Nox handler `computePayout` — runs in Intel TDX TEE:
   - Reads user's encrypted bet
   - Verifies user bet on winning side (ACL check + handle decrypt inside TEE)
   - Computes `payout = userBet * (totalPool / winningSideTotal)` in plaintext
   - Subtracts 2% protocol fee
   - Re-encrypts result, emits as ERC-7984 confidential transfer to user's cUSDC handle
4. UI: "Claim sealed. ← arbiscan" + "Generate audit attestation" button

**I. Selective disclosure**
User clicks "Generate audit attestation":

1. `AttestationService.generateAttestation(marketId, user)` — TEE handler signs `(user, marketId, outcome, payoutAmount, timestamp)` with TDX measurement-bound key
2. Returns JSON attestation, downloadable
3. User shares with whoever — accountant, tax authority, journalist
4. Recipient pastes into `/audit` page → `ClaimVerifier.sol` validates signature against pinned TDX measurement → green check + disclosed fields

**J. Withdraw**
User calls `ConfidentialUSDC.unwrap(amount)` — TEE-attested burn of cUSDC handle, mints standard test USDC back. Standard ERC-20 from there.

**K. Loser archives**
Loser positions: pool was already debited at bet time. Encrypted handle stays as historical record. No claim possible. UI shows position as "Resolved — no payout" with a sealed icon. No further action.

### 3.4 — Failure modes

| Mode                                      | Trigger                                                                | Mitigation                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nox relayer down                          | Devnet flaky                                                           | Day 0 health check (see §11). If down at demo, fallback: pre-recorded TEE responses keyed off market ID, played back through a local relay shim. Demo proceeds.                                                                                                                                                 |
| Resolution oracle wrong                   | Admin fat-fingers, Chainlink stale                                     | 5-min dispute window before claim opens. Admin override via 2/3 multisig. Pre-resolved historical market is resolution-independent for demo.                                                                                                                                                                    |
| Bet > balance                             | Underflow                                                              | TEE rejects in handler; tx reverts cleanly; frontend pre-checks balance before submission.                                                                                                                                                                                                                      |
| Race on claim                             | User attempts claim before resolution                                  | State machine guard: `claimWinnings` reverts if state ≠ `ClaimWindow`.                                                                                                                                                                                                                                          |
| Frontend leaks plaintext                  | Console logs, network calls, React DevTools                            | Strict client-side encryption boundary. No console logs of plaintext amounts. Sentry rule blocks any string matching `/[0-9]{4,}\s*USDC/`. Decrypted values stored only as pre-formatted display strings in hooks, never raw numbers in component state. `user-select: none` on `<Redacted />` revealed values. |
| MEV on resolution                         | Front-run between oracle post and claim window open                    | Commit-reveal: oracle commits hash at expiry, reveals after 60s, claim opens 60s after reveal. Same pattern applied to admin resolution.                                                                                                                                                                        |
| Demo dependency on live oracle            | Chainlink feed delay                                                   | One market uses pre-resolved historical event, guaranteed claim flow regardless of live state.                                                                                                                                                                                                                  |
| ACL key rotation on Privy social recovery | User loses email, recovers via different method, ACL pinned to old key | ACL grants stored against Privy account ID via signature, not raw signer. Documented as known risk in `KNOWN_LIMITATIONS.md`. v1 acceptance: edge case, hackathon scope.                                                                                                                                        |
| Attestation replay                        | User shares with auditor 1, auditor republishes                        | Recipient-bound attestations by default (§9). Bearer mode is explicit opt-in with warning.                                                                                                                                                                                                                      |
| Claim queue saturation                    | Many winners claim at once at resolution                               | Client-side rate limiting + server queue. UI shows position ("you are #4, ~12s wait"). Queue events are public on-chain anyway, no privacy cost.                                                                                                                                                                |
| Batch front-run                           | MEV searcher simulates next batch decryption, front-runs the next bet  | Bets queued atomically per batch. Queue cleared in single tx via `publishBatch`. SUAVE-style atomic batching primitive.                                                                                                                                                                                         |
| Resolution griefing                       | Admin delays resolution indefinitely, bettors locked                   | `claimWindowDeadline = expiryTs + 7 days`. After deadline, anyone can call `markInvalid()`. Bettors get refunded.                                                                                                                                                                                               |
| Reentrancy on claim                       | Malicious receiver hook on confidential transfer                       | `nonReentrant` modifier on all state-changing market functions. CEI ordering.                                                                                                                                                                                                                                   |
| User redacts wallet, loses keys           | Standard                                                               | Out of scope — Privy embedded wallet with social recovery for non-crypto-native demo users.                                                                                                                                                                                                                     |

---

## 4. System Architecture

### 4.1 — Three layers

```
┌─────────────────────────────────────────────────┐
│  FRONTEND (Next.js 16 App Router)               │
│  - Pages: /, /market/[id], /portfolio, /audit,  │
│    /create (admin-gated), /admin                │
│  - State: Zustand for ephemeral UI, Wagmi for   │
│    chain, custom hooks for Nox SDK              │
└─────────────────────────────────────────────────┘
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
┌──────────────────┐         ┌────────────────────┐
│ ARBITRUM SEPOLIA │         │ NOX TEE / HANDLE   │
│ Smart contracts  │         │ GATEWAY             │
│ - MarketRegistry │◄───────►│ - encryptInput      │
│ - Market         │         │ - decrypt           │
│ - cUSDC (7984)   │         │ - computePayout     │
│ - ResolutionOrac │         │ - signAttestation   │
│ - ClaimVerifier  │         │                     │
│ - FeeVault       │         │ Intel TDX enclaves  │
└──────────────────┘         └────────────────────┘
        │                              │
        └──────────────┬───────────────┘
                       ▼
            ┌────────────────────┐
            │  OFF-CHAIN INFRA   │
            │  - The Graph (subgraph for public state)│
            │  - Vercel functions (ChainGPT proxy,    │
            │    attestation helper)                  │
            └────────────────────┘
```

### 4.2 — Repository structure

```
darkodds/
├── README.md
├── DRIFT_LOG.md
├── BUG_LOG.md
├── feedback.md
├── contracts/                  # Foundry project
│   ├── foundry.toml
│   ├── lib/                    # forge install
│   ├── src/
│   │   ├── MarketRegistry.sol
│   │   ├── Market.sol
│   │   ├── ConfidentialUSDC.sol
│   │   ├── ResolutionOracle.sol
│   │   ├── ClaimVerifier.sol
│   │   ├── FeeVault.sol
│   │   └── interfaces/
│   ├── script/
│   │   ├── Deploy.s.sol
│   │   └── SeedMarkets.s.sol
│   ├── test/
│   │   ├── Market.t.sol
│   │   ├── ConfidentialUSDC.t.sol
│   │   └── Integration.t.sol
│   └── deployments/
│       └── arb-sepolia.json
├── web/                        # Next.js 16 app
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                  # market list
│   │   ├── market/[id]/page.tsx
│   │   ├── portfolio/page.tsx
│   │   ├── audit/page.tsx
│   │   ├── create/page.tsx
│   │   ├── admin/page.tsx
│   │   └── api/
│   │       ├── chaingpt/
│   │       │   ├── generate-market/route.ts
│   │       │   └── audit-contract/route.ts
│   │       └── attestation/
│   │           └── verify/route.ts
│   ├── components/
│   │   ├── primitives/         # design system primitives
│   │   ├── market/
│   │   ├── bet/
│   │   ├── portfolio/
│   │   └── audit/
│   ├── lib/
│   │   ├── nox.ts              # Nox SDK wrapper
│   │   ├── contracts.ts        # contract addresses + ABIs
│   │   ├── chaingpt.ts
│   │   └── format.ts
│   ├── hooks/
│   │   ├── useEncryptedBalance.ts
│   │   ├── usePlaceBet.ts
│   │   ├── useClaim.ts
│   │   └── useAttestation.ts
│   └── public/
│       └── fonts/              # locally hosted fonts
├── subgraph/                   # The Graph subgraph
│   ├── subgraph.yaml
│   ├── schema.graphql
│   └── src/
│       └── mappings.ts
├── tee-handlers/               # Nox TEE handler code if separate deployment
│   └── (per Nox SDK conventions)
└── docs/
    ├── ARCHITECTURE.md
    ├── DEMO_SCRIPT.md           # 4-min video script
    └── SUBMISSION.md
```

---

## 5. Smart Contract Specification

All contracts in Solidity (latest stable patch in 0.8.x line, see §15). Foundry test coverage: ≥85%.

### 5.1 — `ConfidentialUSDC.sol`

ERC-7984-shape wrapper over a test USDC ERC-20, built **Nox-native** on `@iexec-nox/nox-protocol-contracts`.

#### 5.1.1 — Why Nox-native, not OZ Confidential Contracts

OpenZeppelin's `openzeppelin-confidential-contracts@0.4.0` is FHEVM-only — every wrapper imports `@fhevm/solidity/lib/FHE.sol`, uses `externalEuint64`, calls `FHE.fromExternal` / `FHE.makePubliclyDecryptable` / `FHE.checkSignatures`. None of those primitives exist on Nox. Inheriting OZCC would deploy a contract bound to **Zama FHEVM's on-chain ACL**, disconnected from the entire P0/F1 Nox foundation we already validated.

iExec ships its own Solidity library at `@iexec-nox/nox-protocol-contracts` (BUSL-1.1 → MIT) targeting `NoxCompute` on Arb Sepolia, with native `Nox.fromExternal`, `Nox.allow`, `Nox.addViewer`, `Nox.transfer`, `Nox.mint`, `Nox.burn` over `euint256` from `encrypted-types`. This is the canonical Nox-native primitive set. PRD §0.1 binds: docs win. We use it.

ERC-7984 spec compliance is preserved at the **function-shape level** (the EIP defines wire shape, not which encryption scheme backs it). Type compat with OZCC's `euint64` is given up; we use Nox's `euint256` instead — which gives more headroom for pool accumulators that Phase F3 needs anyway.

#### 5.1.2 — Implementation

```solidity
// PSEUDOCODE — agent must consult Nox Solidity Library docs for exact imports
import {Nox, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {IERC7984} from "./interfaces/IERC7984.sol"; // function-shape compat

contract ConfidentialUSDC is IERC7984, ReentrancyGuard {
  IERC20 public immutable underlying;
  address public immutable noxProtocol;

  mapping(address => euint256) internal _confidentialBalance;

  function wrap(
    uint256 amount,
    bytes32 handle,
    bytes calldata proof
  ) external nonReentrant returns (bytes32 confidentialHandle);

  function unwrap(
    bytes32 amountHandle,
    bytes calldata authProof
  ) external nonReentrant returns (uint256 amount);

  function confidentialBalanceOf(address user) external view returns (bytes32 handle);

  function confidentialTransfer(address to, bytes32 amountHandle) external nonReentrant;
}
```

Key behaviors:

- `wrap`: pull underlying USDC via SafeERC20.transferFrom → call `Nox.fromExternal(handle, proof)` to commit handle on-chain → use Nox encrypted-types arithmetic to credit `_confidentialBalance[msg.sender]` → grant viewer ACL to msg.sender → emit `Wrapped(user, handle, amount)`. Returns the user's confidential balance handle.
- `unwrap`: user must have viewer ACL on the amount handle → use Nox's burn primitive on `_confidentialBalance[msg.sender]` → SafeERC20.transfer underlying back → emit `Unwrapped(user, amount)`. The decrypt step required for plaintext underlying transfer happens via Nox's documented decrypt-with-attestation path.
- `confidentialTransfer`: standard ERC-7984 wire-shape, implemented with Nox encrypted ops + ACL grant to recipient.

Use `@iexec-nox/nox-protocol-contracts` as the base. Do not fork. Do not inherit OZCC. If anything in the Nox Solidity Library looks suboptimal, log to feedback.md but do NOT modify.

### 5.2 — `MarketRegistry.sol`

Factory + indexer for market contracts.

```solidity
contract MarketRegistry {
  address public admin;
  address public marketImplementation;
  mapping(uint256 => address) public markets;
  uint256 public nextMarketId;

  event MarketCreated(uint256 indexed id, address market, string question, uint256 expiryTs);

  function createMarket(
    string calldata question,
    string calldata resolutionCriteria,
    uint8 oracleType, // 0=admin, 1=chainlink, 2=preresolved
    uint256 expiryTs,
    uint256 protocolFeeBps // basis points, e.g. 200 = 2%
  ) external onlyAdmin returns (uint256 id, address market);
}
```

### 5.3 — `Market.sol`

Per-market logic. Could be a clone via minimal proxy or a singleton with mapping — agent picks based on gas profile testing. Default to **clone pattern** for cleaner per-market state and event indexing.

```solidity
contract Market is ReentrancyGuard {
  uint256 public id;
  string public question;
  uint256 public expiryTs;
  uint256 public claimWindowDeadline; // = expiryTs + 7 days; anyone can markInvalid after
  State public state; // enum: Open, Closed, Resolving, Resolved, ClaimWindow, Invalid
  uint8 public outcome; // 0=NO, 1=YES, 2=INVALID

  // Encrypted accumulators — ACL'd to TEE only between batches
  bytes32 internal _yesPoolBatchHandle;
  bytes32 internal _noPoolBatchHandle;

  // Publicly-decryptable totals — published every 60s via publishBatch()
  bytes32 public yesPoolPublishedHandle;
  bytes32 public noPoolPublishedHandle;
  uint256 public lastBatchTs;
  uint256 public batchCount;

  mapping(address => bytes32) public yesBet;
  mapping(address => bytes32) public noBet;
  mapping(address => bool) public claimed;

  event BetPlaced(address indexed user, uint8 side, bytes32 handle, uint256 batchId);
  event BatchPublished(uint256 indexed batchId, uint256 betsInBatch, uint256 timestamp);
  event MarketResolved(uint8 outcome, uint256 timestamp);
  event MarketInvalidated(uint256 timestamp);
  event Claimed(address indexed user, bytes32 payoutHandle);
  event Refunded(address indexed user, bytes32 refundHandle);

  function placeBet(uint8 side, bytes32 amountHandle, bytes calldata proof) external nonReentrant;

  function publishBatch() external; // permissionless after 60s window elapsed

  function closeMarket() external;
  function resolveAdmin(uint8 outcome) external onlyAdmin;
  function resolveOracle() external; // calls Chainlink + L2 sequencer uptime check

  function claimWinnings() external nonReentrant returns (bytes32 payoutHandle);
  function refundIfInvalid() external nonReentrant returns (bytes32 refundHandle);
  function markInvalid() external; // permissionless after claimWindowDeadline
}
```

Critical implementation notes:

- `placeBet` uses Nox `fromExternal` to convert client-side handle into internal encrypted state, then `FHE.add` (or TEE compute path) to update the _batch_ accumulator. Bet is queued atomically — published on next `publishBatch`.
- `publishBatch` is permissionless: after `lastBatchTs + 60s`, anyone can call to trigger TEE handler that decrypts batch totals and re-publishes them as `*PublishedHandle` with public-decrypt ACL. `BatchPublished` event includes count of bets in the batch only — no amounts.
- Individual bets ACL'd only to the user — never publicly decryptable.
- `claimWinnings` is the wedge: invokes off-chain TEE handler `computePayout` per §6.
- `markInvalid` is the griefing protection: after `claimWindowDeadline`, anyone can transition state to `Invalid`, enabling all bettors to call `refundIfInvalid` and recover stake.
- All state-changing user functions guarded by `nonReentrant`. CEI ordering enforced.

### 5.4 — `ResolutionOracle.sol`

Oracle abstraction. Adapters for:

- `AdminOracle`: signed message from admin multisig
- `ChainlinkPriceOracle`: pulls Chainlink price feed at expiryTs, evaluates threshold condition stored in market
- `PreResolvedOracle`: returns hardcoded outcome (for the demo's safe-path market)

Each adapter implements:

```solidity
interface IResolutionAdapter {
  function isReady(uint256 marketId) external view returns (bool);
  function resolve(uint256 marketId) external returns (uint8 outcome);
}
```

#### 5.4.1 — Chainlink Arbitrum Sepolia specifics (verified)

For the BTC market in the demo:

| Field              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| BTC/USD Aggregator | `0x942d00008D658dbB40745BBEc89A93c253f9B882`             |
| Decimals           | 8 (so `latestAnswer = 12000000000000` means $120,000.00) |
| Interface          | `AggregatorV3Interface.latestRoundData()`                |

**MANDATORY: L2 Sequencer Uptime check.** On Arbitrum, Chainlink price feeds are unsafe to consume without first checking the L2 Sequencer Uptime Feed. If the sequencer is down, the price can be stale, and a market resolved on stale data is catastrophic.

`ChainlinkPriceOracle.resolve()` MUST:

1. Read the L2 Sequencer Uptime Feed (agent pulls Sepolia address from Chainlink docs at implementation time — https://docs.chain.link/data-feeds/l2-sequencer-feeds)
2. Verify sequencer is up (answer = 0) AND has been up for ≥ `GRACE_PERIOD_TIME` (recommended 3600s)
3. Read `latestRoundData()` from BTC/USD aggregator
4. Verify `updatedAt > block.timestamp - 3600` (heartbeat freshness)
5. Compare answer against market's stored threshold (e.g. $120,000 × 10^8 = `12000000000000`)
6. Return outcome

If any check fails, mark market as `INVALID` rather than resolving with bad data. Bettors get refunded.

#### 5.4.2 — Roadmap mention (for submission docs only, not built)

Chainlink Data Streams is available on Arb Sepolia (ETH/USD stream `0x000359843a543ee2fe414dc14c7e7920ef10f4372990b79d6361cdc0dd1ba782`). Lower latency, pull-based, designed for use cases like prediction markets. Out of scope for v1 (adds Automation upkeep + LINK funding overhead) but called out in submission `README.md` "Roadmap" section as the production migration path.

### 5.5 — `ClaimVerifier.sol`

Off-chain attestation verifier. Validates a TEE-signed JSON attestation against an immutably pinned TDX measurement.

```solidity
contract ClaimVerifier {
  bytes32 public immutable pinnedTdxMeasurement; // set in constructor, NEVER mutable
  address public immutable attestationSigner; // Nox attestation signer, immutable

  constructor(bytes32 _measurement, address _signer) {
    pinnedTdxMeasurement = _measurement;
    attestationSigner = _signer;
  }

  function verifyAttestation(
    bytes calldata attestationData,
    bytes calldata signature
  )
    external
    view
    returns (
      address user,
      uint256 marketId,
      uint8 outcome,
      bytes32 payoutCommitment,
      uint256 timestamp,
      address recipient, // address(0) if bearer mode
      uint256 nonce
    );
}
```

Why immutable: if the measurement could be re-pinned by an admin, a compromised admin key could re-pin to a malicious enclave that signs forgery. Treat the measurement-pin as a trust anchor — bake into deployment, no setter, ever.

If a TEE upgrade changes the measurement, deploy a NEW `ClaimVerifier` with the new measurement. Old attestations validate against the old verifier, new ones against the new verifier. This is the standard "trust anchor migration" pattern.

This contract is read-only — it's used by the `/audit` page to validate attestations users share. Off-chain JS can call it via `eth_call`.

### 5.6 — `FeeVault.sol`

Receives 2% protocol fee from each resolution. Standard `Ownable`. Withdraw function. Emits events for accounting.

---

## 6. Off-chain & TEE Handlers

### 6.0 — Nox SDK ground truth (read this first)

A handle in Nox has a two-stage lifecycle. Misunderstanding this is the single largest pitfall when building on Nox.

**Stage 1: gateway-side ciphertext.** Calling `encryptInput(value, solidityType, applicationContract)`:

- POSTs ciphertext to the Nox Handle Gateway
- Returns a `handle` (bytes32, with leading bytes encoding the bound chainId) and an `handleProof` (EIP-712 signature from the gateway)
- Does **NOT** write anything on-chain
- Does **NOT** authorize anyone to decrypt the handle

At this stage, the handle exists but is unreachable. `decrypt(handle)` will fail. `viewACL(handle)` returns nothing meaningful. Nobody can compute on this handle.

**Stage 2: on-chain ACL commit.** The bound `applicationContract` calls `Nox.fromExternal(handle, proof)`:

- Validates the gateway's EIP-712 signature
- Registers the handle in the Nox protocol contract's storage
- Grants the appropriate ACL — typically the EOA that owns the value gets viewer access, the application contract gets compute permissions
- Emits events that the Nox subgraph indexes

After this stage, `decrypt(handle)` works for authorized viewers, `viewACL(handle)` returns admins/viewers, and the handle is composable in further compute.

**Implication for design:** every flow that creates a handle must include an `applicationContract` that calls `fromExternal`. There is no off-chain-only path. `ConfidentialUSDC.wrap()` is our entry point for user-bet handles — it accepts the proof and calls `fromExternal` to register the deposit handle, granting the user viewer access. `Market.placeBet()` accepts an already-committed handle and consumes it inside `fromExternal` (or `decryptHandle` patterns) for the bet update.

**Implication for testing:** any unit test that wants to round-trip `decrypt` must first land a `fromExternal` tx. Mocking decrypt returns gives false confidence.

### 6.1 — Required handlers

**`validateBet(marketId, user, sideHandle, amountHandle, proof)`**

- Verify proof against handle gateway
- Decrypt amount in TEE plaintext
- Read user's confidential balance, ensure ≥ amount
- Debit balance, append to current batch accumulator (encrypted)
- Re-encrypt updated state, emit handles
- Cost target: <300ms

**`publishBatch(marketId)`** _(new)_

- Permissionless trigger after 60s window elapsed
- Decrypt batch YES total + batch NO total in TEE
- Add to running published totals
- Re-encrypt as publicly-decryptable handles (`allowPublicDecrypt`)
- Reset batch accumulator
- Return batch metadata: `{batchId, betsInBatch, timestamp}` for `BatchPublished` event
- IMPORTANT: count revealed, individual sizes never revealed

**`freezePool(marketId)`**

- At resolution, snapshot YES/NO totals
- Decrypt totals, store as plaintext on-chain (post-resolution privacy is not required since outcome is known and pool structure is needed for proportional payout)
- Emit event with frozen pool sizes

**`computePayout(marketId, user)`**

- Read frozen pool totals
- Read user's encrypted bet on winning side (return zero if user bet on losing side)
- Decrypt user's bet in TEE
- Compute `payout = userBet * (totalPool / winningSideTotal)`
- Subtract 2% fee, accumulate to FeeVault
- Re-encrypt result, return as handle for confidential transfer
- Emit `Claimed` event

**`signAttestation(user, marketId, recipient, nonce)`** _(updated signature)_

- Verify market resolved + user has unclaimed winning position
- Generate JSON: `{user, marketId, outcome, payoutAmount, timestamp, recipient, nonce, tdxMeasurement}`
- If `recipient == address(0)`, attestation is bearer mode
- Otherwise, attestation is recipient-bound
- Sign with TDX measurement-bound key
- Return JSON + signature

### 6.2 — Lazy public decryption pattern

Unlike a naive design where every bet immediately updates a public running total (which leaks per-bet deltas), DarkOdds uses **lazy batched public decryption**:

1. Bets accumulate into encrypted batch handles, ACL'd only to TEE
2. Every 60s, `publishBatch` decrypts the batch in TEE, adds to public running total
3. Public running total is republished with `allowPublicDecrypt`
4. Frontend `publicDecrypt` reads new total, recomputes odds

This is why we can claim "bet sizes hidden" honestly. A naive immediate-public-total design would leak bet sizes via deltas.

Atomic batch processing: `publishBatch` is a single transaction that closes the current batch window and opens the next. No interleaved bets within a batch finalization.

Individual bet handles are NEVER made publicly decryptable. They are ACL'd only to the user, and to the TEE for computation.

---

## 7. Frontend Specification

### 7.1 — Design System

#### Aesthetic direction: "Declassified Dossier"

Editorial document × terminal-grade financial UI. Every confidential value renders as a redaction bar — solid black on light, solid bone on dark. When the user "selectively discloses" a value, the redaction bar lifts in a controlled animation to reveal the number underneath. Stamps, seals, paper grain (subtle), monospace numerics.

Reference points: Bloomberg Terminal density × Penguin Classics typography × FOIA document redaction × Kalshi clean.
Anti-references: any 2024–2026 hackathon dashboard, Polymarket card grid, AI-generated SaaS UI, glassmorphism, neumorphism, dark-mode-only websites, purple gradient hero sections.

#### Typography (locally host all fonts under `/public/fonts/`)

- **Display / question type:** Fraunces (variable, free, distinctive)
- **Body:** Geist (Vercel, free, clean, not Inter)
- **Numerics & redaction labels:** Geist Mono (or JetBrains Mono fallback)
- **Stamp / metadata:** Special Elite (for "RESOLVED" / "SEALED" stamps) — used sparingly

NEVER use: Inter, Roboto, Arial, Helvetica, Space Grotesk, system fonts as primary.

#### Color tokens

Define both themes as CSS variables in `globals.css`. User can toggle theme. Default = system.

```css
@layer base {
  :root {
    /* light: declassified-light — bone parchment + ink */
    --bg: #f5f1e8; /* bone */
    --bg-2: #ede7d8; /* paper-shadow */
    --fg: #0a0908; /* ink */
    --fg-mute: #4a4742; /* aged-ink */
    --redaction: #0a0908; /* solid ink bar */
    --accent-yes: #1f5c3d; /* forest */
    --accent-no: #7a1e1e; /* oxblood */
    --accent-signal: #c49a00; /* aged-gold */
    --border: rgba(10, 9, 8, 0.15);
    --grain: url("/textures/paper-grain.png"); /* 4% opacity */
  }

  [data-theme="dark"] {
    /* dark: declassified-dark — graphite + bone */
    --bg: #0e0e0d; /* graphite */
    --bg-2: #1a1a18; /* graphite-2 */
    --fg: #f5f1e8; /* bone */
    --fg-mute: #ada89e; /* dust */
    --redaction: #f5f1e8; /* solid bone bar */
    --accent-yes: #2d8159; /* emerald */
    --accent-no: #b33a3a; /* crimson */
    --accent-signal: #f4c430; /* signal-yellow */
    --border: rgba(245, 241, 232, 0.15);
    --grain: url("/textures/grain-dark.png");
  }
}
```

Tailwind config must extend with these tokens (`darkodds-bone`, `darkodds-ink`, etc. — agent picks naming, but tokens map 1:1 to vars).

#### Layout primitives

- **Container:** max-width 1280px desktop, 768px tablet, full mobile. Padding: 32px desktop, 24px tablet, 16px mobile.
- **Vertical rhythm:** 8px base unit. Section spacing 64px desktop, 40px mobile.
- **Borders:** 1px solid `var(--border)` — used to draw rules between document sections, NOT as card outlines around content.
- **No cards.** No drop-shadow boxes. Sections are separated by horizontal rules (`<hr/>`-style 1px borders), not bordered containers.
- **Dense rows.** Market rows are 56px tall. List view, not grid.

#### Iconography

Lucide icons only, sized 16px or 20px, stroke-width 1.5. No emojis in product UI. (Allowed in marketing/social copy.) Custom SVG for "redaction stamp" and "sealed" iconography — agent generates these as inline SVG components.

#### Motion

- Page transitions: 240ms ease-out fade
- Redaction reveal: 320ms cubic-bezier(0.4, 0, 0.2, 1) — bar slides up off the value
- Toast: 200ms slide from top-right
- Bet placement confirmation: redaction bar "stamps" onto the amount with 80ms scale-and-flash
- Resolved stamp: rotates in 8°, drops with 240ms spring

Use Motion (motion.dev) for React. Not Framer Motion classic — Motion is the renamed/current version.

### 7.2 — Layout principles

- Single primary content column on most pages (max-width 768–960px content, 1280px wrapper)
- Two-column ONLY on `/market/[id]` (60/40 — context left, betting panel right) and `/portfolio` (50/50 active/resolved)
- Lists, not grids, for collections (markets, positions)
- Sidebar navigation banned. Use a top horizontal bar with primary nav and a sticky footer for legal/links.
- Numerics right-aligned, mono font, never inside paragraphs

### 7.3 — Component inventory (`components/primitives/`)

Build these as the foundation. All consume the design tokens from §7.1.

- `<Redacted value="" disclosed={false} />` — the brand element. Shows redaction bar when `disclosed=false`, the value (mono) when `disclosed=true`. Animates between. `user-select: none` on revealed values.
- `<MarketRow market={...} />` — single dense row for market list
- `<OddsBar yes={...} no={...} />` — single horizontal split bar showing pool ratio
- `<NumericDisplay value={...} unit="USDC" size="sm|md|lg" />` — mono, right-aligned, with unit
- `<Stamp variant="sealed|resolved|invalid" />` — SVG stamp overlay
- `<DocumentRule />` — horizontal rule with optional centered label
- `<TimerBadge expiry={...} />` — counts down to expiry, mono numerics
- `<BatchTimer next={...} />` — shows seconds until next pool batch publication. Use on `/market/[id]` near the odds bar. Turns the privacy-preserving 60s delay into a visible feature.
- `<ClaimQueue position={...} estimatedWait={...} />` — shown when user has submitted a claim and is awaiting TEE handler. Position + ETA. Privacy cost is zero since claim events are public on-chain anyway.
- `<Button variant="primary|ghost|destructive" />` — primary = ink/bone solid, ghost = outline, destructive = oxblood/crimson
- `<TextInput />` — bottom-border-only style, no rounded box
- `<Slider />` — horizontal slider for bet amount, with redaction-bar fill
- `<Toast />` — top-right, ink/bone background, mono text
- `<Modal />` — centered, no rounded corners (or 2px max), border 1px

### 7.4 — Pages

#### `/` — Market list

- Top: page title "DARKODDS — open markets" in display font, large
- Subtitle: count + total volume in mono
- Filter bar: "all | sports | crypto | politics | misc" — text links, underlined active
- Document rule
- List of `<MarketRow>`s — one per row, full width
- Each row: question (display, 18px), pool sizes (mono, right), odds bar, time to close, total volume
- Hover: subtle bg-2 fill, no scaling

#### `/market/[id]` — Market detail

- Two columns desktop, stack mobile
- Left (60%): question (display, 36px), resolution criteria, document rule, recent activity feed (anonymized — "wager placed on YES, 14s ago" no amounts), pool history sparkline
- Right (40%): bet panel — side selector (YES/NO toggle), amount input (slider + numeric), "PLACE BET" primary button. Shows current confidential balance as `<Redacted />` with toggle.
- Below: full activity log (paginated)

#### `/portfolio` — User positions

- Header: "YOUR POSITIONS" + total deposited (redacted by default)
- Two columns: ACTIVE | RESOLVED
- ACTIVE: list of open bets, each row shows market, side, bet (redacted), market state
- RESOLVED: list of resolved bets, each shows market, outcome, payout (redacted), CLAIM or ARCHIVED button
- Click CLAIM → modal → tx flow → "Generate audit attestation" CTA after success

#### `/audit` — Attestation verifier

- Header: "VERIFY ATTESTATION"
- Large textarea: paste attestation JSON
- Or: file drop zone for `.json` file
- VERIFY button → server-side `eth_call` to ClaimVerifier
- Result panel:
  - If valid: green check, displays disclosed fields (user address, market id, outcome, payout amount, timestamp), TDX measurement match
  - If invalid: red X, reason

#### `/create` — ChainGPT-powered market creation (admin-gated)

- Header: "GENERATE NEW MARKET"
- Prompt textarea: "Describe the market you want to create…"
- Example prompts as ghost text
- "GENERATE WITH CHAINGPT" button → calls `/api/chaingpt/generate-market`
- Response shows: structured market params (question, resolution criteria, oracle type, expiry) editable as form
- "DEPLOY MARKET" button → calls `MarketRegistry.createMarket(...)`
- Success: redirect to `/market/[id]`

This page is the demo wow moment for ChainGPT. It must work flawlessly.

#### `/admin` — Admin actions

- Resolve markets (for admin-resolved markets)
- View FeeVault balance
- Pin TDX measurement
- Trigger Chainlink resolution

### 7.5 — Charts

Use Recharts (already loaded in environment). Custom theming only — never default colors.

- Pool history sparkline: 1px line, accent-signal color, no axis labels, no grid lines, just the line. 48px tall.
- Pool ratio bar: single horizontal bar, split YES/NO with accent-yes/accent-no, 8px tall, no labels (numbers shown adjacent in mono)
- Total volume area chart on `/`: thin line + soft fill at 12% opacity, no grid lines, axis labels mono 10px

NO 3D, NO excessive gradients on charts, NO dot markers, NO legend overlays. The data is the visual.

---

## 8. ChainGPT Integration

ChainGPT plays two roles. Both must be visible in the demo video.

### 8.1 — Smart Contract Generator

In `/create` page (§7.4), user prompts in natural language:

> "Create a market: BTC closes above $120,000 by May 30 2026 UTC, resolved by Chainlink price feed."

Frontend calls `/api/chaingpt/generate-market`:

1. Server proxies to ChainGPT Smart Contract Generator API
2. ChainGPT returns structured market params + (optionally) generated condition Solidity if needed
3. Server validates structure, returns to client
4. Client displays editable form pre-filled with ChainGPT output
5. User clicks DEPLOY → `MarketRegistry.createMarket(...)`

Use the official ChainGPT SDK or REST API — see §15. Get API credits from `@vladnazarxyz` on Telegram per the brief.

### 8.2 — Smart Contract Auditor

In CI:

1. On every push, run ChainGPT Auditor against `contracts/src/*.sol`
2. Save output to `contracts/audits/chaingpt-{date}.md`
3. Commit it
4. Reference it in `feedback.md` and the demo video

The audit report is a deliverable artifact judges will see.

### 8.3 — Optional: AI bet intent

Stretch goal, only after MVP is shipping: prompt-to-bet via ChainGPT LLM.

> "Bet $200 on the BTC market quietly"
> LLM parses intent, surfaces confirmation modal, frontend executes. Do NOT build this until §11 phases F1-F8 are green.

---

## 9. Selective Disclosure & Audit

This is iExec's #1 narrative phrase. We execute it as a first-class product feature.

### 9.1 — User flow

After winning, user can:

- Keep payout fully sealed (default)
- Generate attestation, share with one party (accountant, tax authority, journalist, employer)
- Generate attestation publicly (e.g., for a viral "I won $50k privately, here's proof" moment)

The attestation is portable JSON. It can be verified by anyone with `/audit` URL access OR programmatically via `ClaimVerifier.sol`.

### 9.2 — Attestation format

```json
{
  "version": "1.1",
  "user": "0xabc…",
  "marketId": 42,
  "marketQuestion": "BTC > $120k by 2026-05-30",
  "outcome": "YES",
  "payoutAmount": "1234567890",
  "payoutCurrency": "USDC",
  "timestamp": 1714502400,
  "recipient": "0xdef…", // address of intended recipient; OR "0x0000…0000" for bearer mode
  "nonce": "0x…", // unique per-attestation, prevents replay caching
  "tdxMeasurement": "0xdeadbeef…",
  "signature": "0x…"
}
```

### 9.3 — Verification

- Off-chain: paste JSON into `/audit`, page validates locally + verifies signature via `eth_call` to `ClaimVerifier.verifyAttestation(...)`
- On-chain: any contract can call `ClaimVerifier.verifyAttestation(data, sig)` — composable. Imagine an insurance protocol that requires proof you won a market to claim coverage.
- If `recipient != address(0)`, verification additionally checks: caller == recipient (or signed-message proof of recipient identity).

### 9.4 — Privacy guarantees

- No attestation is generated automatically — user must explicitly request it
- Attestation discloses only the fields included; market id and outcome are mandatory, payout amount is optional (configurable by user at generation time)
- Attestation does NOT reveal original bet size — only the final payout
- `nonce` ensures no two attestations are bit-identical even for the same payout (prevents fingerprinting)

### 9.5 — Attestation modes

DarkOdds supports two modes. The UI presents recipient-bound as primary; bearer is opt-in advanced.

#### Recipient-bound (default, recommended)

User specifies a `recipient` address at generation time. The attestation is verifiable only when presented by the recipient (or proven to be from the recipient). Sharing with a third party breaks verification — the third party would have to coerce the recipient to provide a proof of forwarding, which is non-trivial.

Use cases:

- "Send proof to my accountant" → recipient = accountant's wallet
- "Show my bookmaker the win" → recipient = bookmaker contract
- "Submit to my employer's compliance team" → recipient = compliance multisig

#### Bearer (opt-in)

User skips recipient. The attestation is portable and verifiable by anyone. **Functions as a self-doxx tool — once shared, the holder loses control.**

Use cases:

- Public flex ("I won $50k, here's the proof")
- Submission to a public bounty or grant
- Journalistic verification

UI shows recipient field as required by default. A small "use bearer mode (anyone can verify)" toggle below requires explicit confirmation: "This attestation will be portable. If shared, you cannot revoke it. Continue?"

---

## 10. Demo Script (4-min video)

The video MUST be ≤ 4:00. 4:01 = DQ risk. Target: 3:50 with 10s buffer.

### 10.1 — Beats

| Time      | Beat                                                                                                                                                                                           | Visual                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 0:00–0:15 | Hook: "Polymarket showed your bet on the wrong side of every front page." Fast cuts of doxxed wallets, news headlines tracking Polymarket whales.                                              | News footage / wallet trackers     |
| 0:15–0:45 | Problem: "Public bets get tracked, copied, doxxed."                                                                                                                                            | Polymarket UI showing wallet sizes |
| 0:45–1:30 | Demo entry: "DarkOdds: same markets, hidden sizes." Open `/`, scroll list, click into a market.                                                                                                | Live `/` and `/market/[id]`        |
| 1:30–2:15 | Place bet flow: connect, wrap to cUSDC (show redaction), select YES, slide amount, confirm tx. Cut to Arbiscan: only handles, no amounts.                                                      | Live web → Arbiscan tab            |
| 2:15–2:40 | Tracker contrast: same market on Polymarket-style tracker, shows whale wallets. Same market on DarkOdds tracker, shows nothing.                                                                | Side-by-side                       |
| 2:40–3:10 | Resolution + claim. Market resolves YES, navigate to `/portfolio`, click CLAIM. Show TEE attestation flow. Payout sealed.                                                                      | Live `/portfolio`                  |
| 3:10–3:35 | Selective disclosure. "Generate audit attestation" → JSON download → paste into `/audit` → verified, fields revealed. "Send this to your accountant. Or don't."                                | Live `/audit`                      |
| 3:35–3:50 | Tech callout: "Built on iExec Nox — first proportional pari-mutuel confidential market. ERC-7984 + Intel TDX TEE + ChainGPT smart contract generation." Show ChainGPT generating a new market. | Live `/create` flash               |
| 3:50–3:58 | Close: "DarkOdds. Public market. Private wager." Logo. Submission tags.                                                                                                                        | End card                           |

### 10.2 — Production rules

- 1080p minimum, 60fps
- No royalty-issue music — use a track from Epidemic Sound or YouTube Audio Library
- Lower-thirds in mono font, ink/bone
- Cuts on action, not on silence
- Voice-over in confident editorial register, not hype-bro
- Captions burned in (judges may watch muted)

---

## 11. Build Phases (sequenced for Claude Code)

Each phase is one concern. Each phase has a defined deliverable. **No phase begins until the previous phase's deliverable is verified working.**

The agent MUST commit after each green phase with a commit message of format: `phase(<id>): <summary>`. The agent MUST update `DRIFT_LOG.md` and `BUG_LOG.md` continuously.

### Day 0 — Infrastructure validation gate

**P0 — Nox devnet health check (revised v1.2 — doc-aligned)**

> **Why this gate is shaped this way:** Nox handles have an on-chain ACL. `encryptInput` only POSTs ciphertext to the gateway and returns a handle + proof; the handle is NOT decryptable until the bound `applicationContract` calls `Nox.fromExternal(handle, proof)` on-chain to register the ACL. Any P0 spec that demands `encrypt → decrypt` symmetry off-chain is structurally impossible against the SDK. The corrected gate validates _infrastructure reachability_, which is what Day 0 actually needs. Full encrypt-to-decrypt round-trip is naturally exercised in Phase F2 when `ConfidentialUSDC.wrap()` consumes the proof on-chain.

Before any contract or frontend work, the agent runs a health check script that validates:

1. **RPC reachability** — `eth_chainId` against Arbitrum Sepolia returns `0x66eee` (421614). Document the RPC URL used in `feedback.md`.

2. **Nox client construction** — `createViemHandleClient(walletClient)` with a fresh ephemeral key. Time the call.

3. **Gateway encrypt** — Call `encryptInput(42n, 'uint256', applicationContract)` where `applicationContract` is the ephemeral EOA. Verify:
   - Returned `handle` is `bytes32`-shaped
   - Handle's leading 6 nibbles decode to `0x66eee` (chainId 421614 — confirms gateway issued an Arb-Sepolia-bound handle)
   - `handleProof` is a non-empty EIP-712 signature
   - Time the round-trip

4. **Nox protocol contract reachability** — Read the Nox protocol contract address from the SDK's auto-config (or fetch via documented introspection if available). Verify `eth_getCode` returns non-empty bytecode at that address. This proves the on-chain ACL contract is deployed and reachable on the chain we expect.

5. **Subgraph reachability** — Send a trivial introspection query to the Nox subgraph URL (auto-configured for Arb Sepolia). Verify it returns 200 OK with a valid GraphQL schema response. This proves the indexer that powers `viewACL` is alive.

6. **Print summary table** — each step PASS/FAIL with latency.

**What this gate does NOT do (intentionally):**

- Does NOT call `decrypt(handle)` — would fail by design without an `applicationContract` having called `fromExternal`. That happens in Phase F2.
- Does NOT call `viewACL(handle)` for the same reason.
- Does NOT deploy any contract.

**Setup rules:**

- Per §0.1, install LATEST `@iexec-nox/handle` from npm. Note: as of v1.1 of this PRD, the package is published as `0.1.0-beta.x` only — there is no stable channel. Pin exactly to the latest beta and log the version in `DRIFT_LOG.md`. Re-pin on each phase commit.
- Verify package existence at https://www.npmjs.com/package/@iexec-nox/handle before install.
- pnpm + tsx (or bun, document choice).
- Latest stable Viem v2 — exact pin.
- TypeScript 5.x — exact pin (note: TS 6.x is now stable; v1 stays on 5.x for ecosystem peer compatibility, document choice).
- No carets, no tildes — exact pins per §15.3.
- Project layout for THIS prompt only: `package.json`, `tsconfig.json`, `.env.example`, `tools/healthcheck.ts`, `feedback.md`, `DRIFT_LOG.md`, `BUG_LOG.md`. No `contracts/`, no `web/`, no `subgraph/` yet.

**On failure at any step:**

- DO NOT mock, DO NOT invent workarounds.
- Log to `BUG_LOG.md` per §0.3 format.
- Append context to `feedback.md`.
- Print "RED — see BUG_LOG.md", exit code 1, halt for operator.

**On success:**

- Print "GREEN — Nox infra validated, ready for Phase F1".
- Append structured entry to `feedback.md` covering: SDK install experience, API ergonomics, latency observations, any DX friction.
- Commit `phase(P0): Nox devnet health check GREEN`.

**Deliverable:** `tools/healthcheck.ts` that prints GREEN under the criteria above, plus seeded `feedback.md` / `DRIFT_LOG.md` / `BUG_LOG.md`.

### Phase F1 — Project skeleton

- Initialize monorepo with `contracts/` (Foundry) + `web/` (Next.js 16 app) + `subgraph/` + `docs/`
- Create `DRIFT_LOG.md`, `BUG_LOG.md`, `feedback.md` with templates
- Configure root `README.md` with setup instructions
- Set up `pnpm` workspaces
- Configure git, gitignore, prettier, eslint, tsconfig

**Deliverable:** clean monorepo, `pnpm install` runs clean, both subprojects scaffold.

### Phase F2 — Contracts: ConfidentialUSDC + tests

- Foundry init in `contracts/`
- Install OpenZeppelin Confidential Contracts via forge
- Implement `ConfidentialUSDC.sol` per §5.1
- Write Foundry tests covering wrap/unwrap/transfer
- Deploy to Arbitrum Sepolia via `Deploy.s.sol`
- Verify on Blockscout/Arbiscan

**Deliverable:** verified contract on Arb Sepolia, ≥85% test coverage, deployment artifact in `deployments/arb-sepolia.json`.

### Phase F3 — Contracts: Market core

- Implement `Market.sol` per §5.3 (placeBet, closeMarket, state machine)
- Implement `MarketRegistry.sol` per §5.2
- Tests: bet placement updates pools, side accounting, state transitions
- Deploy registry, deploy 1 test market via script

**Deliverable:** registry + 1 live market on Arb Sepolia, integration test passing.

### Phase F4 — Contracts: Resolution + Claim

- Implement `ResolutionOracle.sol` with all three adapters
- Implement claim flow in `Market.sol` — `claimWinnings()` calls TEE handler
- Implement `ClaimVerifier.sol`
- Implement `FeeVault.sol`
- End-to-end test: place bets, resolve, claim, verify fee accounting

**Deliverable:** full contract suite deployed, integration test scripted in `script/EndToEnd.s.sol`.

### Phase F4.5 — Security hardening pass

Before TEE handler integration, harden contracts:

- Add `nonReentrant` modifier from OpenZeppelin to `placeBet`, `claimWinnings`, `refundIfInvalid`, `wrap`, `unwrap`
- Verify checks-effects-interactions ordering on all state-mutating functions
- Implement `claimWindowDeadline` and `markInvalid()` per §5.3
- Implement `refundIfInvalid()` for bettor recovery
- L2 sequencer uptime check in `ChainlinkPriceOracle.resolve()` per §5.4.1
- Heartbeat freshness check (`updatedAt > block.timestamp - 3600`)
- Slither static analysis run, fix all findings >= medium severity
- ChainGPT Auditor run on all contracts, archive output to `contracts/audits/chaingpt-{date}.md`

**Deliverable:** Slither clean, ChainGPT Auditor report committed, all contracts redeployed with hardening, deployment artifacts updated.

### Phase F5 — TEE handlers

- Implement `validateBet`, `freezePool`, `computePayout`, `signAttestation` per §6
- Deploy via Nox SDK conventions (consult §15 docs)
- Wire handlers to deployed `Market.sol`
- End-to-end: bet via raw script, resolve, claim, verify payout

**Deliverable:** live TEE handlers, end-to-end CLI test passes.

### Phase F6 — Frontend: skeleton + design system

- Next.js 16 init with App Router, TypeScript, Tailwind v4
- Install Geist, Geist Mono, Fraunces, Special Elite locally
- Configure CSS variables per §7.1 with light/dark theme toggle
- Build all primitives in `components/primitives/` per §7.3
- Build `<Layout>` with top nav and footer
- Storybook (or simple `/style-guide` page) showing every primitive

**Deliverable:** style guide page rendering, all primitives functional, theme toggle working.

### Phase F7 — Frontend: market list + detail

- Build `/` page per §7.4
- Build `/market/[id]` page per §7.4
- Wire to subgraph for public state (or direct contract reads via Wagmi)
- Wire `<Redacted>` to Nox SDK `decrypt` for user balance

**Deliverable:** browse markets, view detail, see public pool data, no bet flow yet.

### Phase F8 — Frontend: bet flow

- Build wallet connect via Privy
- Build cUSDC wrap/unwrap modal
- Build bet placement flow per §3.3 step E
- Wire Nox SDK `encryptInput` end-to-end
- Wire `Market.placeBet` tx
- Live tested on Arb Sepolia with real handles

**Deliverable:** user can fund, wrap, place a bet end-to-end. Bet appears in portfolio.

### Phase F9 — Frontend: portfolio + claim + audit

- Build `/portfolio` per §7.4
- Build claim flow with TEE handler invocation
- Build attestation generation
- Build `/audit` page with verification

**Deliverable:** full lifecycle end-to-end through UI.

### Phase F10 — ChainGPT integration

- Build `/api/chaingpt/generate-market/route.ts`
- Build `/create` page UI
- Set up CI step running ChainGPT Auditor on contracts on every push
- Document ChainGPT usage in `feedback.md`

**Deliverable:** market creation via prompt works, audit reports saved.

### Phase F11 — Subgraph

- Build subgraph schema + mappings for public state (markets, resolutions, pool totals)
- Deploy to The Graph hosted service or self-hosted
- Wire frontend to subgraph for list view

**Deliverable:** public state queryable via GraphQL.

### Phase F12 — Polish + admin

- Build `/admin` page for resolution actions
- Build admin-resolution flow for sports market
- Build Chainlink-resolution flow for BTC market
- Build pre-resolved historical market for guaranteed demo
- Polish all pages, fix every UX paper-cut

**Deliverable:** three demo markets live, all resolution paths working, UI polished.

### Phase F13 — Demo + submission

- Record demo video per §10
- Edit to ≤ 4:00
- Polish README with screenshots, architecture diagram, deployment addresses
- Finalize `feedback.md`
- Tag release `v1.0.0`
- Publish X submission post tagging @iEx_ec and @Chain_GPT

**Deliverable:** submission live on DoraHacks + X.

### Phase Hero check

After every phase F6+ commit, the agent runs the "hero check":

> Is this commit moving toward the redaction-bar-lift moment in the demo at 3:10–3:35? If not, why was it built?

Log answer in `DRIFT_LOG.md`.

---

## 12. Infrastructure & Deployment

### 12.1 — Networks

- **Primary:** Arbitrum Sepolia (chainId 421614)
- **Local:** Anvil fork of Arb Sepolia for fast iteration
- **Mainnet:** noted as roadmap, NOT scope of this build

### 12.2 — Hosting

- **Frontend:** Vercel (free tier, ChainGPT prize covers hosting if needed)
- **Subgraph:** The Graph hosted (or self-hosted on Render free tier as fallback)
- **TEE handlers:** per Nox deployment conventions

### 12.3 — Secrets

- Never commit `.env`. Use `.env.example` with placeholder values.
- Required env vars:
  - `NEXT_PUBLIC_RPC_URL` — Arbitrum Sepolia RPC (Alchemy / public)
  - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
  - `PRIVY_APP_ID` (public) + `PRIVY_APP_SECRET` (server-only)
  - `CHAINGPT_API_KEY` (server-only)
  - `THEGRAPH_API_KEY`
  - `DEPLOYER_PRIVATE_KEY` (local only, never committed)
  - `NOX_ENV` — devnet/staging per Nox docs

### 12.4 — Monitoring (light)

- Vercel logs + analytics (free)
- Optional: PostHog for product analytics — strictly no plaintext bet amounts in events

---

## 13. Drift Log + Bug Log Conventions

See §0.2 and §0.3 for formats. Both files live at repo root, both are committed, both are part of the deliverable.

Judges who read these will see the depth of work. Treat them as artifacts, not chores.

---

## 14. Submission Deliverables

Per the iExec Vibe Coding Challenge brief:

- [x] Public GitHub repo with complete viewable code
- [x] README with setup + usage instructions
- [x] Comprehensive deployment + usage docs
- [x] Functional frontend
- [x] Demo video ≤ 4 minutes
- [x] `feedback.md` with specific technical iExec tools feedback
- [x] Live deployment on Arbitrum Sepolia
- [x] X post tagging @iEx_ec and @Chain_GPT containing: project description, demo video, GitHub link

In addition (judge-bait extras):

- [x] `DRIFT_LOG.md` and `BUG_LOG.md` showing depth of work
- [x] `contracts/audits/chaingpt-{date}.md` showing ChainGPT auditor usage
- [x] `docs/ARCHITECTURE.md` with diagram
- [x] `docs/DEMO_SCRIPT.md` with full script
- [x] `KNOWN_LIMITATIONS.md` documenting v1 trade-offs honestly (see §16)

---

## 16. Known Limitations (v1)

This file lives at repo root as `KNOWN_LIMITATIONS.md`. Content honestly captures the trade-offs the team made for v1, separating "won't fix in scope" from "deferred to roadmap." Judges value this — it shows engineering maturity.

### Will not fix in v1 (acceptable for hackathon scope)

**Pool-total delta leakage on resolution.** When `freezePool` decrypts side totals at resolution, anyone who knows another participant's bet structure can reconstruct their share. This is an accepted trade-off — proportional pari-mutuel payout requires some structural information at resolution. Future direction: ZK proofs of correct payout without revealing pool structure.

**Per-batch count visibility.** `BatchPublished` events emit `betsInBatch` count. This is a deliberate "selective disclosure" choice — count is shown, individual sizes are not. Future direction: range-proofs on count buckets (1–5 / 6–20 / 20+) instead of exact count.

**Batch interval as fixed parameter.** 60 seconds chosen for v1. Could be per-market configurable. Trade-off documented.

### Roadmap (deferred)

- **Chainlink Data Streams migration.** v1 uses standard Data Feeds. Streams provide lower-latency, pull-based oracles ideal for prediction markets. Migration path documented; out of v1 scope due to Automation upkeep complexity.
- **ACL recovery on Privy social recovery.** v1 stores ACL grants against immediate signer. If user rotates keys via social recovery, balance access breaks. Solution: store ACL grants against Privy account ID via signed message. Requires Privy team coordination.
- **Smart contract upgrade path.** v1 deploys immutable. Production version would use OpenZeppelin UUPS proxies with timelocked upgrades.
- **Subgraph indexing latency.** v1 hybrid (subgraph for list view, direct contract reads for detail). Production version would deploy a dedicated indexer with sub-second updates.
- **AI bet intent.** ChainGPT LLM as natural-language bet placement ("bet $200 on BTC market quietly"). v1 stretch only; not blocking for submission.
- **Cross-chain attestation verification.** Make `ClaimVerifier` deployable on multiple chains so users can prove DarkOdds wins inside other ecosystems. Composable trust anchor.

### Out of scope forever (intentional non-goals)

- KYC. DarkOdds is permissionless. Recipient-bound attestations are the compliance handoff to whoever needs them.
- Custodial mode. User keys via Privy embedded; never delegated to platform.
- Mobile-native app. v1 is responsive web. Native is a different product.

---

## 15. Stack Reference & Doc URLs

The agent consults these docs whenever uncertain. Versions listed are floors — use latest stable at install time.

### 15.1 — Reference docs (consult these)

- **iExec Nox:** https://docs.iex.ec/nox-protocol/getting-started/welcome
- **iExec Nox JS SDK:** https://docs.iex.ec/nox-protocol/references/js-sdk
- **iExec Nox Solidity Library:** https://docs.iex.ec/nox-protocol/references/solidity-library
- **iExec Nox Foundry guide:** https://docs.iex.ec/nox-protocol/guides/build-confidential-smart-contracts/foundry
- **iExec Nox npm packages:** https://www.npmjs.com/org/iexec-nox
- **OpenZeppelin Confidential Contracts:** https://github.com/OpenZeppelin/openzeppelin-confidential-contracts
- **ERC-7984 spec:** https://eips.ethereum.org/EIPS/eip-7984
- **Next.js docs:** https://nextjs.org/docs
- **Tailwind v4 docs:** https://tailwindcss.com/docs
- **Wagmi v2 docs:** https://wagmi.sh
- **Viem v2 docs:** https://viem.sh
- **Privy docs:** https://docs.privy.io
- **Foundry book:** https://book.getfoundry.sh
- **The Graph docs:** https://thegraph.com/docs
- **ChainGPT dev docs:** https://docs.chaingpt.org
- **Recharts docs:** https://recharts.org
- **Motion (motion.dev):** https://motion.dev/docs

### 15.2 — Floor versions (install latest stable at or above)

- **Node.js:** 22 LTS
- **pnpm:** latest
- **Next.js:** latest 16.x stable, advisory-clean (NOT 14.x — CVE-2025-29927 + downstream RCE chain)
- **React:** 19.2.x or later (CVE-2025-55182 patched)
- **TypeScript:** 5.x
- **Tailwind CSS:** v4
- **Wagmi:** v2 (current)
- **Viem:** v2 (current — required by Nox SDK)
- **Ethers.js:** v6 (alternative to viem; pick one)
- **Privy:** latest react SDK
- **Solidity:** latest patch in 0.8.x line
- **Foundry:** latest nightly or stable
- **OpenZeppelin Contracts:** latest
- **OpenZeppelin Confidential Contracts:** latest
- **iExec Nox SDK:** `@iexec-nox/handle` — package is currently published as `0.1.0-beta.x` only (no stable channel). Pin exactly to the latest beta. Re-pin on every phase commit per §15.3. Verified 2026-04-25.
- **Recharts:** latest
- **Motion:** latest (the renamed Framer Motion)
- **Lucide React:** latest

### 15.3 — Install rule (repeat from §0.1)

> Before `pnpm add`, `npm install`, or `forge install`: resolve the latest stable, advisory-clean version from official source. Use exact version pins in `package.json` (no `^`, no `~`) to lock the build. Re-pin on each phase commit.

When a CVE advisory drops mid-build, stop, upgrade, log in `BUG_LOG.md`, resume.

---

## 17. END

This PRD is the source of truth for the build. Updates only by operator (Tim). Drift from PRD logs in `DRIFT_LOG.md`. Bugs log in `BUG_LOG.md`. Feedback to iExec logs in `feedback.md`. Honest trade-offs logged in `KNOWN_LIMITATIONS.md`.

Build the redaction bar lift. Build the audit page handshake. Build the ChainGPT prompt-to-market flow. Build the batch publication that turns 60s of patience into a feature. Everything else is supporting.

Ship.
