# ChainGPT audit — F4 vs F4.5 cross-reference

Both audit passes are preserved as part of the project audit trail per
PRD §11 F4.5 deliverable.

| Pass | Path                                            | Contracts                                                 | Date       |
| ---- | ----------------------------------------------- | --------------------------------------------------------- | ---------- |
| F4   | `contracts/audits/chaingpt-2026-04-25-f4.md`    | 10 (full suite)                                           | 2026-04-25 |
| F4.5 | `contracts/audits/chaingpt-2026-04-25-f45/*.md` | 2 (Market, MarketRegistry — only F4.5-modified contracts) | 2026-04-25 |

## F4 findings status after F4.5

### Admin centralization (HIGH)

- **F4 finding:** All Ownable contracts owned by deployer EOA.
- **F4.5 resolution:** Migrated ownership of all 7 Ownable contracts
  (TestUSDC, MarketRegistry, ResolutionOracle, AdminOracle,
  PreResolvedOracle, ChainlinkPriceOracle, FeeVault) to a 2-of-3 Gnosis
  Safe v1.4.1. Safe address recorded in `deployments/arb-sepolia.json`
  under `safe.address`. Ownership transfer audit trail in
  `ownership.contracts.<name>.transferTx`.
- **Status:** RESOLVED.

### Reentrancy / CEI

- **F4 finding:** Already mitigated by `nonReentrant` on every entry point.
- **F4.5 update:** Slither flags 13 `reentrancy-no-eth` results — all
  false positives behind ReentrancyGuard. See
  `audits/slither-2026-04-25/summary.md`.
- **Status:** UNCHANGED (already mitigated).

### Cross-contract ACL (handle authorization)

- **F4 finding:** Documented as known by-design pattern requiring
  `Nox.allowTransient` before delegating handle use to cUSDC.
- **F4.5 update:** F4.5 hardens placeBet to use the cUSDC-returned
  `transferred` handle for downstream pool/bet accounting (instead of
  the gateway-issued `betAmount`). Closes ERC-7984 silent-failure gap.
- **Status:** STRENGTHENED.

## New F4.5 findings

See per-contract reports in this directory for the latest LOW / MEDIUM /
HIGH / CRITICAL summaries on Market.sol + MarketRegistry.sol.
