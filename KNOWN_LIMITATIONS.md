# KNOWN_LIMITATIONS

Honest enumeration of v1 scope choices and accepted risks per PRD §0.5 and §16.
Read alongside `DRIFT_LOG.md` (process drift) and `BUG_LOG.md` (resolved bugs).

---

## Faucet rate limit: 1,000 tUSDC per 6h per address (F7)

`Faucet.claim()` dispenses exactly 1,000 TestUSDC and locks the caller for 6
hours. Per-address basis only — no global rate limit, no per-IP gate.

### Why this number

- 1,000 tUSDC = 10× the `verify-backend` wrap default (100 tUSDC). A demo
  viewer can run the full lifecycle once and still have headroom to bet again.
- 6h cooldown × 10K claim cap (10M faucet seed ÷ 1,000) = a single bot
  attacking continuously needs 60K hours to drain the pool, which gives the
  Safe ample time to `pause()` before it matters.
- The cooldown is per-address; an attacker spinning up new wallets pays the gas
  for every wrap. On Arb Sepolia that's <$0.001/claim — annoying, not
  economically motivating.

### What it doesn't protect against

- Sybil-style multi-wallet drains. Each fresh address claims once. If a
  dedicated attacker spins up 10K wallets and gas costs are $10, they can drain
  the faucet for $10,000-equivalent of test funds. We accept this as a testnet
  hackathon risk: the tUSDC has no production value, and the Safe's `pause()`
  is one Safe-cosigned tx away.
- Flash-loan-style abuse. Faucet doesn't wrap, doesn't approve, doesn't grant
  any allowance — just `safeTransfer`. No reentry surface (also locked behind
  `nonReentrant`).

### Production roadmap

- Privy ID gate: `claim()` could check a Privy `userId` signature so each
  authenticated identity can claim once per cooldown, regardless of how many
  wallets they spin up. Not in F7 scope; would couple the contract to Privy's
  auth shape.
- Captcha gate via on-chain ZK proof of human-ness (e.g. Worldcoin-style).

## Privy embedded wallet UX rough edges accepted in v1 (F7)

Privy's React SDK 3.22.2 and wagmi adapter 4.0.6 ship the headline path
cleanly: email/Google login → embedded wallet auto-provisioned → wagmi hooks
work without further glue. Two rough edges we noted but accept for v1:

- **`createOnLogin: 'users-without-wallets'` + first-tx wallet bootstrap
  latency.** When a user signs in and immediately tries to claim from the
  faucet, the embedded wallet sometimes isn't fully initialized when the click
  fires — the wagmi hooks return `address: undefined` for ~200-500ms. The UI
  handles this gracefully (CONNECT button stays visible until `ready` flips),
  but a "your wallet is initializing…" toast would be nicer.
- **Theme prop reactivity.** Privy's modal palette is set at PrivyProvider mount
  via the `appearance.theme` prop. We sync it through `useTheme()` so a theme
  toggle re-renders the provider with the new theme — but Privy's modal, if
  already open at the moment of toggle, doesn't re-style live; it picks up the
  new theme on next open. Acceptable; documented in feedback.md as a Privy DX
  ask.

## Pari-mutuel imbalance accepted in v1

## Pari-mutuel imbalance accepted in v1

DarkOdds uses a pari-mutuel payout: `payout = userBet * totalPool / winningSide`.
When the YES and NO pools are imbalanced, the overweight side gets a bad payout
because the same total pool is split across more bettors. Concrete shape:

- Pool ratio 95/5 (YES:NO) and YES wins → each YES winner gets ~1.05× their bet.
- Pool ratio 5/95 (YES:NO) and YES wins → each YES winner gets ~20× their bet.

The math is correct (no funds lost, no surplus generated) — it's just that the
"odds" implied by a small minority are extreme, and the majority side only
recovers a thin margin over their stake. This is intrinsic to pari-mutuel, not
a contract bug.

### Why we accept this for v1

- **Privacy is the wedge.** Confidential bet sizes is what differentiates
  DarkOdds from Polymarket / Kalshi. Liquidity efficiency is the v2 problem.
- **Demo markets are small.** Hackathon judges interact with markets that have
  3–5 manually-funded bettors; imbalance is artificial, not a real liquidity
  gap users would experience.
- **No mid-market price feed exists yet.** Polymarket fixes imbalance via CPMM
  AMM curves; that adds price discovery surface that we haven't designed. Out
  of scope for the privacy-MVP.

### Comparison to existing markets

| Protocol     | Mechanism               | Imbalance behavior                  | Cold-start cost        |
| ------------ | ----------------------- | ----------------------------------- | ---------------------- |
| **DarkOdds** | Pari-mutuel             | Implicit odds drift to extremes     | Zero — first bet works |
| Polymarket   | CPMM (LMSR-derived)     | Smooth — slippage absorbs imbalance | LP must seed liquidity |
| Kalshi       | Central limit orderbook | None — only matched bets clear      | Need a counterparty    |

Pari-mutuel + zero cold-start matches our hackathon constraint better than
either competitor's mechanism.

### v2 roadmap fix

A liquidity-bootstrapping subsidy where the protocol deposits a balancing pool
funded by `FeeVault` accumulation. When a market opens, the subsidy seeds both
sides equally; as bets arrive, the subsidy gets gradually refunded back to the
vault. This converges to pari-mutuel as the market matures while keeping the
imbalance bounded. Documented in PRD §16 follow-on work.

## Dust-bet spam not synchronously prevented (F5-followup)

`Market.placeBet` does not enforce a minimum bet amount. Nox v0.1.0's `Nox.ge`
returns an `ebool` whose decryption requires an off-chain-issued gateway proof
— that proof cannot be produced inside the same transaction as the comparison,
so a synchronous `require(amount >= MIN_BET)` against an encrypted bet is
structurally impossible in this protocol version.

Attack surface: an adversary can submit dust-amount bets that pass through
`confidentialTransferFrom` and inflate `BetPlaced` events / `totalBetCount`.
Cost to attacker on Arbitrum: <$0.001/tx. Cost to bettors: zero (their pools
and payouts are unaffected — dust contributes to the side it's bet on at
face value).

### Why we accept rather than partially fix

A "silent clamp" patch (`Nox.select` zeroing dust amounts) closes the economic
vector but leaves event-spam open and introduces a per-side lockout footgun
where a user who attempts a dust bet by accident initializes their side to
zero and can't place a real bet on that side later. The half-fix is worse
than the documented honesty.

A "plaintext minimum" via an extra plaintext bet-amount argument breaks the
privacy thesis on every transaction — bet sizes become public. Non-starter.

### Production roadmap

When Nox ships synchronous encrypted comparison or a same-transaction
`publicDecrypt` fast-path, this becomes a one-line `require`. Until then,
off-chain rate-limit on the frontend (debounce, minimum-amount client
validation) is the realistic mitigation, with the contract behavior
documented as best-effort. The dust attacker still pays gas with no
economic upside.

See `iexec-feedback.md` for the proposal forwarded to the iExec/Nox team.

## Multisig governance migrated from EOA in F4.5

All seven Ownable contracts (TestUSDC, MarketRegistry, ResolutionOracle,
AdminOracle, PreResolvedOracle, ChainlinkPriceOracle, FeeVault) are now
owned by a 2-of-3 Gnosis Safe v1.4.1 at
`0x042a49628f8A107C476B01bE8edEbB38110FA332`
(see `https://app.safe.global/?safe=arb-sep:0x042a49628f8A107C476B01bE8edEbB38110FA332`).

Signers (recorded in `deployments/arb-sepolia.json` under `safe.signers`):

| #   | Address                                      | Role                 |
| --- | -------------------------------------------- | -------------------- |
| 1   | `0xF97933dF45EB549a51Ce4c4e76130c61d08F1ab5` | deployer EOA         |
| 2   | `0xB20499998D3C3773941969a89d398416DE828eA1` | fresh, operator-held |
| 3   | `0x4e29bBeB01b11E2FA71828D3BdA3F933e49a5c73` | fresh, operator-held |

Threshold: **2-of-3** (any two of the three signers execute).

### Why 2-of-3 not 3-of-3

- 2-of-3 preserves operator liveness during the demo: a single operator
  holding all three keys can co-sign without external coordination, while
  losing one key (e.g. signer #2 corrupted) does not lock the project.
- 3-of-3 is too brittle for hackathon scope; 2-of-3 is the standard
  "multisig with one safety key" pattern.
- Resolves the F4 ChainGPT auditor's HIGH "admin centralization" finding
  and matches PRD §3.4 row "Resolution oracle wrong" → "Admin override via
  2/3 multisig".

### Production roadmap

- **3-of-5 with hardware signers** (Ledger / Trezor) for production.
- **Timelock module** wrapping sensitive ops (setMarketImplementation,
  setResolutionOracle) with a 24-48h delay.
- **Module-gated emergency pause** so a single hardware key can freeze
  bets without unwinding state.
- All current testnet Safe signers can be rotated via the Safe UI without
  redeploying any project contracts.

## Slither tool false positives accepted

`Slither 0.11.5` reports 13 `reentrancy-no-eth` Medium findings on the
F4.5 patched source. All are mitigated by `nonReentrant` from
`@openzeppelin/contracts/utils/ReentrancyGuard.sol`, which slither does
not model semantically. Documented in
`contracts/audits/slither-2026-04-25/summary.md`. Re-test under
slither ≥ 0.11.6 once available.

Slither also retains stale phantom findings on user-defined-value-type
declarations (`uninitialized-local`, `unused-return`, `immutable-states`)
even though the source has been corrected. These are slither tool bugs,
not contract issues — verified against the forge-produced AST.

## ClaimVerifier TDX measurement is a placeholder until F5

`ClaimVerifier.pinnedTdxMeasurement` is set to
`keccak256("DARKODDS_F4_DEMO_MEASUREMENT")`. The real TDX measurement of the
TEE handler image is computed during F5 deployment. F5 will REDEPLOY
ClaimVerifier (trust-anchor migration pattern per §5.5) with the production
measurement. Old verifier address remains queryable but should not be relied
on by the F6 frontend.

## claimWinnings is intent-only in F4; payout transfer arrives in F5

The proportional-payout math
`payout = userBet * (totalPool / winningSideTotal)` runs in the TEE handler
`computePayout(marketId, user)` (PRD §6.1). F4 records the claim intent
on-chain via `ClaimRecorded(user, outcome, ts)`; F5's TEE handler reads
those events, computes the payout in plaintext, and triggers the
confidential transfer back to the user. Until F5 ships, winners see
`hasClaimed[user] == true` but receive no actual payout.

## No Chainlink data feeds on Arbitrum Sepolia

Chainlink has not deployed price feeds or the L2 sequencer uptime feed to
Arbitrum Sepolia (chainId 421614). Verified via the official
`smartcontractkit/hardhat-chainlink` registry. The BTC-resolved demo market
described in PRD §5.4.1 is therefore omitted from testnet deployment per
PRD §0.5 ("if something can't be live, the demo skips it — never fakes it").
`ChainlinkPriceOracle.sol` is built to spec and deployed for completeness;
production usage would require Arbitrum One mainnet with sequencer feed
`0xFdB631F5EE196F0ed6FAa767959853A9F217697D`.

## ACL pinned to wallet, not Privy account ID

PRD §3.4 row "ACL key rotation on Privy social recovery" notes that if a
user loses their email and recovers via a different signer, their cUSDC ACL
remains pinned to the original wallet address. v1 acceptance: this is an
edge case for non-crypto-native users on testnet. Production fix is to
pin ACLs against Privy account IDs via signature, not raw signer
addresses — out of scope for v1.

## FeeVault fee collection deferred (F5)

`Market.claimWinnings` computes an encrypted fee handle via Nox arithmetic but does
not call `FeeVault.receiveFee(amount)` directly. `FeeVault.receiveFee` takes a
plaintext `uint256`; converting the encrypted fee to plaintext requires a Nox
`publicDecrypt` round-trip (async — two transactions per claim). Adding that would
split the claim UX across two transactions for a testnet demo.

v1 acceptance: fee handle is ACL-granted to the market contract and stays in the
market's cUSDC balance. `ClaimSettled` emits the encrypted fee handle for off-chain
accounting. Post-demo, the Safe-owned admin can drain accumulated fees via
`cUSDC.confidentialTransfer(feeVault, feeHandle)` once publicDecrypt proofs are
available. See DRIFT_LOG.md F5 entry.

## Nox has no custom handler runtime — F5 scope revised (F5)

PRD §11 F5 planned four TEE handlers as deployable worker images. The Nox protocol
v0.1.0 does not support custom handler deployment — the Runner is a fixed Rust service
in Intel TDX managed by the protocol infrastructure. All encrypted computation uses
Solidity library calls that the Runner processes as events.

v1 acceptance: `claimWinnings` payout is fully correct using on-chain Nox arithmetic.
TEE attestation is at the protocol level. See `tee-handlers/RUNTIME_DISCOVERY.md`.

## Per-user, per-side, per-market bet cardinality cap

A user may have at most one bet on YES and one on NO per market. Cumulative
same-side bets via `Nox.add(existing, new)` are technically possible but
the F5 claim accounting is live and correct for the one-per-side model.
v1 keeps the cap; additive same-side bets are post-MVP scope.

## Single deployer for testnet wallet

The deployer EOA is a freshly-generated, manually-funded testnet wallet.
The private key lives in `.env` (gitignored, mode 0600) on the operator's
local machine. Loss of the key means re-running deploy-f3 / deploy-f4 from
scratch with a new wallet — recoverable but not free. Production would use
hardware-backed signing or a managed signer (Defender Relay, etc.).

## TestUSDC is permitted; production USDC is not

`TestUSDC.sol` includes `ERC20Permit` for one-signature wrap UX in the
demo. Real USDC on Arbitrum is non-permitted (no EIP-2612). The F8 web
flow's permit-then-wrap pattern will need to fall back to two-tx approve +
wrap on mainnet. Documented honestly so the demo doesn't oversell the UX
relative to production.
