# KNOWN_LIMITATIONS

Honest enumeration of v1 scope choices and accepted risks per PRD §0.5 and §16.
Read alongside `DRIFT_LOG.md` (process drift) and `BUG_LOG.md` (resolved bugs).

---

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

## Per-user, per-side, per-market bet cardinality cap

A user may have at most one bet on YES and one on NO per market. Cumulative
same-side bets via `Nox.add(existing, new)` are technically possible but
complicate the F5 claim accounting. v1 keeps the simpler one-per-side cap;
F5 may relax once the claim path is live and the merge semantic is decided.

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
