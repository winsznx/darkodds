# F9 — Bet flow state machine + decryption sub-spec

_Drafted 2026-04-27 during F9 HALT 0._
_Ground truth: `tools/verify-backend.ts` (the F5-final operator flow) + `contracts/src/Market.sol::placeBet` + `contracts/src/ConfidentialUSDC.sol`._

## Two corrections to the F9 prompt

The F9 prompt sketches a 5-step UI flow as:

> 1. APPROVE TESTUSDC, 2. WRAP, 3. ENCRYPT BET, 4. AUTHORIZE MARKET (`ConfidentialUSDC.allowTransient(cUSDCHandle, marketAddress)`), 5. PLACE BET

The actual on-chain truth, verified by reading `verify-backend.ts:451-617` and `Market.sol:212-289`:

1. **Step 4 is `cUSDC.setOperator(market, until)`, NOT `allowTransient`.** `Nox.allowTransient` happens _inside_ `Market.placeBet` (`Market.sol:243`), not from the user's wallet. The user's wallet sets the cUSDC operator pattern (EIP-7984-style); Market then uses operator status to pull funds and internally grants Nox transient ACL on the bet handle.
2. **Wrap requires its own `encryptInput`.** `cUSDC.wrap(amount, encryptedAmount, inputProof)` takes a Nox-encrypted handle for the wrap amount with `applicationContract = cUSDC`. Step 2 is therefore an off-chain encryptInput + an on-chain wrap tx — counts as one user-facing step but two operations.

The corrected user-facing 5-step flow:

| #   | Label            | Operation                                                             | Tx?                | Idempotent?                                         |
| --- | ---------------- | --------------------------------------------------------------------- | ------------------ | --------------------------------------------------- |
| 1   | APPROVE TESTUSDC | `TestUSDC.approve(cUSDC, amount)`                                     | yes                | ✓ (allowance comparison)                            |
| 2   | WRAP TO CUSDC    | `encryptInput(amount, "uint256", cUSDC)` → `cUSDC.wrap(amount, h, p)` | yes (1 sdk + 1 tx) | partial — re-checks cUSDC balance, skips if ≥ bet   |
| 3   | ENCRYPT BET      | `encryptInput(amount, "uint256", marketAddress)`                      | no (off-chain)     | ✓ (re-runnable)                                     |
| 4   | AUTHORIZE MARKET | `cUSDC.setOperator(market, until)`                                    | yes                | ✓ (`isOperator` + `until` check)                    |
| 5   | PLACE BET        | `Market.placeBet(side, betHandle, betProof)`                          | yes                | ❌ — re-running creates `AlreadyBetThisSide` revert |

Net: 4 wallet-prompted txs in the worst case (steps 1, 2, 4, 5) + 2 SDK calls (steps 2, 3).

For repeat bettors who already have cUSDC and have set the operator on this market, the worst case collapses to just step 3 + step 5 — 1 tx + 1 SDK call. The state machine's pre-flight stage detects this and reduces visible steps in the UI.

## Pre-flight (gate before showing the BetModal flow)

A single `wagmi/server.readContracts` batch:

```ts
const [tusdcBal, allowance, isOp, opUntil, mState] = await readContracts([
  {address: TestUSDC, fn: "balanceOf", args: [user]},
  {address: TestUSDC, fn: "allowance", args: [user, cUSDC]},
  {address: cUSDC, fn: "isOperator", args: [user, market, until]},
  {address: cUSDC, fn: "operatorExpiry", args: [user, market]},
  {address: market, fn: "state"},
]);
```

(The exact ABI names will need confirming — `isOperator` vs `operators`, etc. — but the shape is one round-trip multicall.)

From this we derive:

- `needsApprove`: `allowance < amount`
- `needsWrap`: pre-bet cUSDC balance < amount (fall-back: assume true if Nox ACL doesn't grant us viewer to read decrypt)
- `needsSetOperator`: `!isOp || opUntil <= now + 60s`
- `marketOpenable`: `mState == Open && now < expiryTs`

Steps not needed are visually marked complete from the start with a "✓ skipped — already set" sub-label, so users who've bet before see exactly which 1-2 steps actually need their signature.

## State machine

```
                                     ┌────────────────────┐
   user opens modal ───►   IDLE ──►  PREFLIGHT (read chain)
                                     └─────────┬──────────┘
                                               ▼
                                     ┌────────────────────┐
                                     │  REVIEW            │  user sees: outcome,
                                     │  (summary card)    │  amount, est. payout,
                                     └─────────┬──────────┘  fee disclosure, list
                                               │            of needed steps
                                       user clicks CONFIRM
                                               ▼
                ┌──────────────── PROCESSING (5-step orchestration) ─────────────────┐
                │                                                                    │
                │   step 1: APPROVE_TUSDC ──► step 2: WRAP_CUSDC ──► step 3: ENCRYPT  │
                │   (skip if alwc OK)         (skip if bal OK)       (always)        │
                │       │                          │                       │         │
                │       └─ user reject ──► ERROR_USER_REJECT (retry/cancel)          │
                │       └─ tx revert    ──► ERROR_TX_REVERT  (surface reason)        │
                │       └─ network drop ──► ERROR_NETWORK    (auto-retry once)       │
                │       └─ encrypt fail ──► ERROR_ENCRYPT    (retry CTA)             │
                │                                                                    │
                │       step 3 ──► step 4: SETOPERATOR (skip if op live) ──► step 5  │
                │                                                              │     │
                │                                                              ▼     │
                │                                                  step 5: PLACE_BET │
                │                                                              │     │
                │                                                  receipt success?  │
                └──────────────────────────────────────────────────────────────┼─────┘
                                                                               ▼
                                                              ┌──────────────────┐
                                                              │  SUCCESS         │  show tx,
                                                              │  (auto-close 8s) │  Arbiscan,
                                                              └──────────────────┘  decrypt
                                                                                    new pos
```

### Recovery: which steps are safely re-runnable

| Step          | After failure → re-run?              | Why                                                                                                                                                            |
| ------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APPROVE_TUSDC | ✓ Always                             | Idempotent. Re-reads allowance pre-flight.                                                                                                                     |
| WRAP_CUSDC    | ✓ Skip if cUSDC balance now ≥ amount | The encrypt+wrap is logically idempotent in _outcome_: if it landed, balance reflects it; we re-check balance, not state.                                      |
| ENCRYPT_BET   | ✓ Always                             | Off-chain only. Reusing a cached betHandle from sessionStorage is the recovery path on PLACE_BET retry.                                                        |
| SETOPERATOR   | ✓ Skip if operator still authorized  | Idempotent — the call updates `until`, no harm in re-doing.                                                                                                    |
| PLACE_BET     | ❌ Once per side                     | Reverts with `AlreadyBetThisSide` if user already has a non-zero bet on that side. Recovery is "you already placed this bet — view your position" not "retry". |

### Abort & user-rejection paths

| Failure mode                                        | UI response                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Wallet popup canceled (any step)                    | Friendly "Bet canceled" banner, modal returns to REVIEW.                                                                           |
| Insufficient TestUSDC balance (pre-flight detect)   | "Get TestUSDC from the faucet first" → opens FaucetModal.                                                                          |
| Insufficient ETH for gas                            | "Get Arb Sepolia ETH" → Chainlink-faucet link.                                                                                     |
| Market closed mid-flow (resolved during user dwell) | Stamp "MARKET RESOLVED — refresh to see outcome". CTA disabled.                                                                    |
| Nox encrypt 5xx / timeout                           | "Encryption service unavailable — retry" CTA, surfaces gateway error. Retry only the encrypt step.                                 |
| placeBet revert on chain                            | Surface `error.shortMessage` from viem (e.g. "AlreadyBetThisSide"). Log full error to console. No auto-retry.                      |
| Network drop mid-tx                                 | Tx already broadcast; switch to "WAITING FOR RECEIPT (you can close — we'll resume on next visit)". sessionStorage holds the hash. |

### sessionStorage persistence

`sessionStorage["darkodds.bet-flow"]` schema:

```jsonc
{
  "marketAddress": "0x6076e9…8Da6",
  "outcomeIndex": 1, // 0 = NO, 1 = YES
  "amountUsdc": "50000000", // base units, 6 dp
  "currentStep": "WRAP_CUSDC",
  "stepData": {
    "approveTx": "0x9cfa…403f", // hash from step 1
    "wrapTx": null, // pending
    "betHandle": null, // not encrypted yet
    "betProof": null,
    "setOperatorTx": null,
    "placeBetTx": null,
  },
  "startedAt": 1761570000,
}
```

If user closes the modal mid-flow, on next mount of `/markets/[id]` we detect this entry and surface a banner: "Bet in progress on this market — RESUME?" Two CTAs: RESUME (re-mount the modal at the saved step), CANCEL (clear sessionStorage). RESUME re-runs pre-flight to see what's still needed; if everything's now satisfied (e.g. user manually completed via Etherscan), it skips to SUCCESS.

## Decryption sub-spec — User's own bets

### Where the data lives

`Market.sol` exposes per-user bet handles as public view functions (`Market.sol:196-202`):

```solidity
function yesBet(address user) external view returns (euint256);
function noBet(address user) external view returns (euint256);
```

`euint256` is `bytes32` at the wire level. A non-zero return means the user has a bet on that side.

### The flow

1. `/markets/[id]` server-renders public market state. `MarketDetail` (client) receives the connected user's address from Privy.
2. `<UserPositions>` reads `yesBet(user)` and `noBet(user)` via wagmi `useReadContracts` (parallel single-tx multicall).
3. For each non-zero handle:
   - Pass to `noxClient.decrypt(handle)` (client-side via the user's signed wallet — viewer ACL is granted to the user when their handle was registered).
   - Render row: outcome label, plaintext amount in tUSDC, market state, settle time.
4. If user is not connected, render the section with "CONNECT WALLET TO VIEW POSITIONS" CTA.
5. If user is connected but has no bets, render "NO POSITIONS — PLACE A BET" empty state.
6. If `decrypt` fails (user not in ACL, network, gateway 5xx), render a redaction bar with inline "DECRYPT FAILED — RETRY" button. Never crashes the page.

### Decryption is best-effort, never blocks render

The page must paint without waiting for decrypt. Implementation: render redaction bars first, kick off `decrypt()` in a `useEffect`, swap in the plaintext when resolved. Loading state is a redaction-bar pulse (the brand element).

### Public state we don't need to decrypt

- `yesPoolPublishedHandle` / `noPoolPublishedHandle` — already public-decryptable per spec. F8 ships card-level "—" placeholder for Open markets to avoid adding `@iexec-nox/handle` to web/. F9 adds the SDK for user-bet decryption — once it's in, calling `publicDecrypt` on these in `lib/darkodds/markets.ts:deriveOutcomes` becomes free. **F9 RESOLVES the F12-HOOK from F8.**
- `totalBetCount`, `batchCount`, `pendingBatchBetCount`, `state`, `outcome` (post-resolve), `expiryTs`, `yesPoolFrozen`, `noPoolFrozen`, `claimWindowOpensAt`, `protocolFeeBps` — all public storage, no decrypt needed.
- `Market.yesBet(otherUser)` returns a handle that we can read but cannot decrypt — only `otherUser` has viewer ACL. So the bet _count_ is public (handle existence/non-zero), bet _size_ is private. The wedge holds.

## Latency budget

Empirical from F5/F7 verification-output, Arb Sepolia ~250ms block time:

| Step                               | Operation                           | P50     | P95     | Notes                                                                                                        |
| ---------------------------------- | ----------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| Pre-flight                         | `useReadContracts` batch (5 calls)  | 250ms   | 800ms   | One multicall round-trip                                                                                     |
| 1                                  | `TestUSDC.approve`                  | 3s      | 6s      | Wallet sign latency dominates                                                                                |
| 2                                  | `encryptInput(wrap)` + `cUSDC.wrap` | 5s      | 10s     | Gateway encrypt 2-3s + chain confirm 3s                                                                      |
| 3                                  | `encryptInput(bet)`                 | 2s      | 5s      | Gateway only — no on-chain                                                                                   |
| 4                                  | `cUSDC.setOperator`                 | 3s      | 6s      | Light tx                                                                                                     |
| 5                                  | `Market.placeBet`                   | 5s      | 10s     | Heavier — internal `Nox.allowTransient` + `cUSDC.confidentialTransferFrom` + batch handle accumulator update |
| **Worst-case happy path**          | all 5 steps                         | **18s** | **37s** | Fits operator's 18-25s P50 budget; P95 wider                                                                 |
| **Cached path** (returning bettor) | steps 3 + 5                         | **7s**  | **15s** | Encrypt bet + placeBet only                                                                                  |

UI must show progress visibly the entire time. NO single 18s spinner. Each step shows: label + state icon (idle = empty box, active = redaction-bar pulse, complete = filled square with checkmark, failed = red X) + live elapsed timer per step. Current step has redacted-red border accent.

## Files coming in HALT 1+

```
HALT 1 — Read-only detail page:
  web/lib/nox/client.ts                                 SDK wrapper, single source of truth
  web/lib/darkodds/single-market.ts                    extends F8 reader for single-market detail + user-bet handles
  web/app/(dashboard)/markets/[id]/page.tsx            server component
  web/components/market-detail/MarketDetail.tsx        orchestrator (client)
  web/components/market-detail/MarketHeader.tsx
  web/components/market-detail/OutcomesPanel.tsx
  web/components/market-detail/MarketMeta.tsx
  web/components/market-detail/UserPositions.tsx       decryption-best-effort
  web/components/market-detail/EventLog.tsx            anonymized recent placeBet events
  web/components/market-detail/BetPanel.tsx            stub CTA (modal lands HALT 2)
  web/components/market-detail/market-detail.css

HALT 2 — Modal shell + state machine:
  web/lib/bet/state-machine.ts                         hand-rolled FSM (no XState dep)
  web/lib/bet/quote.ts                                 simulateContract pre-flight
  web/components/bet/BetModal.tsx
  web/components/bet/BetProgress.tsx
  web/components/bet/bet-modal.css

HALT 3 — Real chain wiring:
  web/lib/bet/place-bet.ts                             orchestrator
  web/lib/bet/preflight.ts                             readContracts batch + diff
  Update DarkOddsMarketCard "PLACE BET →" disabled CTA → enabled link to /markets/[id]
  ProtocolStats sidebar — wire batchCount + totalBetCount on the active market (optional polish)

HALT 4 — Verify + commit:
  tools/verify-f9.ts                                   end-to-end real bet on Arb Sepolia
  Updates: DRIFT_LOG (Nox SDK in web/, F12-HOOK resolved), KNOWN_LIMITATIONS (no real-time odds, no claim, no refund), feedback.md (browser-Nox DX), README
```

## Bundle size impact note

`@iexec-nox/handle@0.1.0-beta.10` is 351 KB unpacked. Tree-shaken in production it's smaller (the SDK is mostly methods + types; we only call `encryptInput` + `decrypt` + `publicDecrypt` + `viewACL`), but it's still material — somewhere on the order of 100-200 KB after gzip into the dashboard route group's client bundle. To be measured at HALT 4 build sweep and documented in DRIFT_LOG.

The SDK loads ONLY in the dashboard route group (`(dashboard)`) — the F6 landing stays untouched. Anyone who never visits `/markets/[id]` never downloads it. Verified via the route boundary already established in F7.
