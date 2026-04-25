# KNOWN_LIMITATIONS

Honest enumeration of v1 scope choices and accepted risks per PRD §0.5 and §16.
Read alongside `DRIFT_LOG.md` (process drift) and `BUG_LOG.md` (resolved bugs).

---

## Admin centralization (filed: F4 ChainGPT audit)

All `Ownable` contracts (MarketRegistry, ResolutionOracle, AdminOracle,
PreResolvedOracle, ChainlinkPriceOracle, FeeVault, TestUSDC) currently have
the deployer EOA `0xF97933dF45EB549a51Ce4c4e76130c61d08F1ab5` as owner.
ChainGPT auditor flagged this as HIGH-severity for production. **Accepted for
v1** as the project is hackathon-grade testnet only. Production deployment
plan: migrate ownership to a 2-of-3 admin multisig per PRD §3.4 row
"Resolution oracle wrong" mitigation. The ownership-transfer machinery
already exists via `Ownable.transferOwnership`.

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
