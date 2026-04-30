# DarkOdds

> **Privacy-permissionless prediction markets on Arbitrum Sepolia. Anyone deploys, anyone bets, odds are public, bet sizes are encrypted. Selective-disclosure payouts via iExec Nox.**

Polymarket without the curation gate or the public stake size. Anyone deploys a market on anything; anyone bets without revealing their position. Built on iExec Nox: outcomes and odds are public, your stake is encrypted. When you win, you get a cryptographic receipt you can show your accountant — or keep sealed forever. We solved the proportional-payout problem that pure-FHE markets couldn't, by doing the math in TEE plaintext.

— iExec Vibe Coding Challenge × ChainGPT, DoraHacks. Author: Tim ([@winsznx](https://github.com/winsznx)).

---

## Demo

> Recording in progress — link will be added before submission.

Live deployment: <https://darkodds.site>

---

## Verify it works in 60 seconds

Two end-to-end verifiers exercise every contract on real Arbitrum Sepolia. They share `45/45` checks across the full lifecycle. No mocks, no fixtures — every step is a live transaction against the deployed contracts.

```bash
git clone <repo-url>
cd darkodds
pnpm install
pnpm verify:f10b           # 24/24 — registry + adapters + sponsored deploy + ChainGPT proxy
pnpm verify:claim-flow     # 21/21 — placeBet → resolve → freezePool → claimWinnings → payout decrypt
```

| Verifier            | What it proves                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify:f10b`       | Operational delegation is live. `MarketRegistry.owner()` is the deployer EOA (one-click `/create`). All seven other Ownable contracts remain Safe-owned.    |
| `verify:claim-flow` | A real winner can place a bet, watch the market resolve, and decrypt their payout. Math ties out: proportional pari-mutuel `payout = bet × pool / winners`. |

A representative `verify:claim-flow` run against Market #26 produced a payout of `36,750,000` cUSDC base units (= `36.75 cUSDC` after the 2% protocol fee), confirmed via `nox.decrypt` on the payout handle. See [`docs/ARCHITECTURE.md#verified-end-to-end`](./docs/ARCHITECTURE.md#verified-end-to-end) for the formula derivation.

Pre-flight: the deployer wallet at `0xF97933dF45EB549a51Ce4c4e76130c61d08F1ab5` needs ≥ 0.02 ETH on Arb Sepolia. The verifier auto-funds and seeds a fresh winner wallet from the deployer.

---

## Quickstart

Prereqs:

- Node.js ≥ 22 (`node --version`)
- pnpm ≥ 10 (`corepack enable && corepack prepare pnpm@latest --activate`)
- Foundry (`forge --version`) — install via [foundryup](https://book.getfoundry.sh/getting-started/installation)

Local dev:

```bash
pnpm install
cp web/.env.example web/.env.local        # set NEXT_PUBLIC_PRIVY_APP_ID + CHAINGPT_API_KEY
cp .env.example .env                      # set DEPLOYER_PRIVATE_KEY for tools/* scripts
pnpm healthcheck                          # 5-step Nox infra reachability
pnpm dev:web                              # http://localhost:3000
```

The dev server points at the deployed Arb Sepolia contracts. You don't need to deploy anything to run the UI locally — connect a Privy wallet, hit the in-app `/airdrop` and `/faucet` flows, place a bet on an existing market.

To deploy to production, see [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

---

## Architecture

DarkOdds is three concentric layers: a Solidity protocol on Arbitrum Sepolia, a Next.js 16 App Router frontend, and a thin set of API routes that act as confidential-deploy and read-only-mirror sponsors. Encrypted handles live on iExec Nox; bet sizes never leave the TEE in plaintext until the user voluntarily decrypts their own payout.

Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for:

- The Mermaid topology diagram (frontend ↔ API routes ↔ contracts ↔ Nox handles)
- Per-component explanations of `ConfidentialUSDC` (ERC-7984), `MarketRegistry` + `Market` clones + state machine, the three resolution adapters, `ClaimVerifier` + attestation flow, and the Nox handle lifecycle (`encryptInput` → `fromExternal` → `Nox.add` / `Nox.mul` / `Nox.div` → `publicDecrypt` / `decrypt`)
- Why pari-mutuel payout is the privacy wedge (and how TDX plaintext compute solves the division problem that pure-FHE markets cannot)
- The 60-second batch-publication cadence
- Deployment topology + ownership model (2-of-3 Safe + operational-delegation override)

---

## Deployed addresses

Canonical at [`contracts/deployments/arb-sepolia.json`](./contracts/deployments/arb-sepolia.json). Current on Arbitrum Sepolia (chainId `421614`):

| Contract                                | Address                                                                                               | Notes                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `TestUSDC` (ERC-20 + Permit)            | [`0xf02c9...0f93e`](https://sepolia.arbiscan.io/address/0xf02c982d19184c11b86bc34672441c45fbf0f93e)   | Wrappable into cUSDC                                          |
| `ConfidentialUSDC` (ERC-7984, operator) | [`0xaf1ac...50c4d`](https://sepolia.arbiscan.io/address/0xaf1acdf0b031080d4fad75129e74d89ead450c4d)   | Wraps TestUSDC, holds Nox-encrypted balances                  |
| `MarketImplementation` v5               | [`0xf3aa6...27779`](https://sepolia.arbiscan.io/address/0xf3aa651f5e5c8ff51472ae2beab6ec1ed0d27779)   | Current clone target. Empty-winning-side auto-Invalid (F5-fu) |
| `MarketRegistry` v2                     | [`0xe66b2...06dd1`](https://sepolia.arbiscan.io/address/0xe66b2f638f5db738243a44f7aeb1cccc18906dd1)   | EOA-owned during judging, Safe-owned in production            |
| Gnosis Safe v1.4.1                      | [`0x042a4...fa332`](https://app.safe.global/?safe=arb-sep:0x042a49628f8A107C476B01bE8edEbB38110FA332) | 2-of-3, governs 7 of 8 Ownable contracts                      |
| `ResolutionOracle`                      | [`0x27dc5...b96c`](https://sepolia.arbiscan.io/address/0x27dc556b9e6c1a031bd779e9524936f70b66b96c)    | Routes per-market to typed adapter                            |
| `AdminOracle` (commit-reveal)           | [`0x96b6e...b103f`](https://sepolia.arbiscan.io/address/0x96b6ecc138a231ddff9e8ea856fb8869b4be103f)   | 60s reveal-delay window                                       |
| `PreResolvedOracle` (demo path)         | [`0x76147...1cc893`](https://sepolia.arbiscan.io/address/0x76147d3c1e241b4bb746002763991789661cc893)  | Outcome fixed at deploy                                       |
| `ChainlinkPriceOracle`                  | [`0x316dc...c3cb2`](https://sepolia.arbiscan.io/address/0x316dc924697406af553c7276c285b11b83cc3cb2)   | Mainnet-ready; Arb Sepolia has no Chainlink feeds             |
| `ClaimVerifier`                         | [`0x5cc49...2b82a`](https://sepolia.arbiscan.io/address/0x5cc49763703656fec4be672e254f7f024de2b82a)   | EIP-191 attestation verifier                                  |
| `FeeVault`                              | [`0x4fc72...fa351`](https://sepolia.arbiscan.io/address/0x4fc729a98824bf2e6da4bba903ead73432afa351)   | Accumulates 2% protocol fee handles                           |
| `Faucet` (1k tUSDC / 6h)                | [`0xcb8e2...c359a5`](https://sepolia.arbiscan.io/address/0xcb8e251cd6eb0bb797c0721cab84f41c8cd359a5)  | Safe-owned, dispenses test USDC                               |
| `Nox` protocol (iExec)                  | [`0xd464b...c229`](https://sepolia.arbiscan.io/address/0xd464b198f06756a1d00be223634b85e0a731c229)    | Foreign — iExec-operated TDX runner                           |

Legacy `MarketImplementation` versions (v3 — `0x73167…cc7ea`, v4 — `0x5dd7b…4615a`) are pinned by older market clones; both are still queryable. F2 cUSDC v1 (`0xf9f3a…12372`) is superseded but wrap/unwrap continues to work on the legacy address.

---

## Governance

All eight `Ownable` contracts are owned by a **2-of-3 Gnosis Safe v1.4.1** at [`0x042a4…fa332`](https://app.safe.global/?safe=arb-sep:0x042a49628f8A107C476B01bE8edEbB38110FA332), with one operational delegation:

- `MarketRegistry.owner()` is **temporarily** the deployer EOA (`0xF97933…F1ab5`) for the live-judging window, so the one-click `/create` flow works without a second Safe co-signer in the loop. Restoration is a single EOA tx via `tools/transfer-registry-ownership.ts --to-safe`.
- All other seven Ownable contracts (`TestUSDC`, `ResolutionOracle`, `AdminOracle`, `PreResolvedOracle`, `ChainlinkPriceOracle`, `FeeVault`, `Faucet`) remain Safe-governed. Owner-side ops (`mint`, `setAdapter`, `setMarketImplementation`) require two co-signatures; see `tools/smoke-f45.ts` for the canonical Safe-mediated execution pattern.

The dashboard topbar carries a `GOVERNANCE STATE` badge that reads `MarketRegistry.owner()` on every page load and renders DEMO MODE (amber) or PRODUCTION MODE (green) with a click-through explaining the current state and the restoration plan. Full reasoning + restoration script in [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md#registry-ownership-temporary-delegation).

---

## Resolution

Each DarkOdds market is created with one of three `oracleType` values, routed through `ResolutionOracle.setAdapter(marketId, adapter)` to a typed adapter. After F10b's auto-wire patch, `/api/admin/deploy-market` cosigns `setAdapter` immediately after `createMarket` so adapters are pre-routed without operator intervention. End-to-end inventory at [`docs/RESOLUTION_AUDIT_2026-04-29.md`](./docs/RESOLUTION_AUDIT_2026-04-29.md).

### `oracleType=1` — Chainlink price feed

On **Arbitrum One mainnet**, configure with the canonical aggregator (e.g. BTC/USD at `0x6ce185860a4963106506C203335A2910413708e9` — verify via [Chainlink's Arbitrum docs](https://docs.chain.link/data-feeds/price-feeds/addresses?network=arbitrum) before deploy). The adapter performs the full safety chain: sequencer uptime check (`SequencerUptimeFeed` at `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`), heartbeat freshness, round completeness, non-negative answer guard, then the threshold comparison.

On **Arbitrum Sepolia**, no price feed exists (verified against the [smartcontractkit/hardhat-chainlink registry](https://github.com/smartcontractkit/hardhat-chainlink)). The contract was deployed with `sequencerFeed = address(0)` so the sequencer check is bypassed; markets with `oracleType=1` auto-invalidate at expiry and refund all bettors. This is intentional per PRD §0.5 "no mocks."

### `oracleType=0` — Admin commit-reveal

Resolution flow:

```bash
pnpm tsx tools/admin-resolve.ts --market=<N> --outcome=YES|NO|INVALID
```

The CLI handles the full sequence in one run:

1. **Preflight `setAdapter`** — if `ResolutionOracle.adapterOf(marketId)` is unwired (zero address), Safe-cosigns the adapter wiring before commit. Recovers markets deployed before the auto-wire patch.
2. **Commit** — Safe-cosigned `AdminOracle.commit(marketId, keccak256(abi.encode(outcome, salt)))`. Salt is auto-generated and printed to stdout (or operator-supplied via `--salt=`).
3. **REVEAL_DELAY** — visible 60s countdown (PRD §3.4 MEV-mitigation window).
4. **Reveal** — Safe-cosigned `AdminOracle.reveal(marketId, outcome, salt)`.
5. **Resolve** — direct EOA `Market.resolveOracle()`.
6. **freezePool** if outcome is YES/NO — Nox SDK `publicDecrypt` of the published pool handles, then `Market.freezePool(yesProof, noProof)` lands the market in `ClaimWindow`.
7. **Audit trail** — `{marketId, outcome, salt, commit/reveal/resolve/freeze tx hashes, finalState}` appended to `tools/admin-resolve-history.json`.

Web UI for commit-reveal is roadmapped to v1.1 at `/admin/resolve/[marketId]`.

### `oracleType=2` — PreResolved (demo path)

Used for testnet demo markets and historical questions with deterministic outcomes. The outcome is set at oracle deployment via `PreResolvedOracle.configure(marketId, outcome)` and `resolve()` returns it immediately. Suitable for demo recording — `tools/seed-claimable-market.ts --stage=claimable` walks a complete lifecycle in ~3 minutes. Not suitable for user-facing prediction questions; the YES/NO answer is hard-coded at deploy.

---

## Stack

| Layer         | Choice                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Chain         | Arbitrum Sepolia (chainId `421614`), 25 blocks/sec                                                        |
| Contracts     | Solidity `0.8.34`, Foundry, OpenZeppelin v5, ERC-7984 (Confidential Token)                                |
| TEE           | iExec Nox (Intel TDX) — `@iexec-nox/handle@0.1.0-beta.10`, `nox-protocol-contracts` Solidity library      |
| Frontend      | Next.js 16 (App Router), React 19, Tailwind v4, TypeScript 5.9                                            |
| Wallet        | Privy v3.22 + wagmi v4 (embedded wallets default; injected fallback)                                      |
| AI            | ChainGPT GeneralChat (market-spec generation) + Smart Contract Auditor (CI gate on every contract change) |
| Data side-arm | Polymarket Gamma read APIs (display-only, no proxied trades)                                              |
| Multisig      | Gnosis Safe v1.4.1 + `@safe-global/protocol-kit@7.1.0`                                                    |
| Persistence   | Vercel KV when `KV_REST_API_URL` is set; `/tmp/*-ledger.json` fallback for local dev                      |

---

## Audit reports

- **Slither 0.11.5** (2026-04-25) — 0 High, 0 real Medium. All 16 raw Mediums are `reentrancy-no-eth` false positives mitigated by `nonReentrant`. Full triage: [`contracts/audits/slither-2026-04-25/summary.md`](./contracts/audits/slither-2026-04-25/summary.md).
- **ChainGPT Smart Contract Auditor** (2026-04-28) — clean pass on all 8 deployed contracts. Run via `pnpm tsx tools/chaingpt-audit.ts`. Per-file findings: [`contracts/audits/chaingpt-2026-04-28.md`](./contracts/audits/chaingpt-2026-04-28.md).
- **ChainGPT Generator + Auditor loop** — natural-language → Solidity → audit roundtrip. [`contracts/audits/chaingpt-generated-2026-04-28.md`](./contracts/audits/chaingpt-generated-2026-04-28.md).
- **Honest enumeration of accepted v1 risks** — [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md). Includes the dust-bet spam vector, Privy hydration race, the operational-delegation rationale, and the FHE-vs-TEE pari-mutuel discussion.

---

## Roadmap (v1.1 → v2)

- **Web UI for AdminOracle commit-reveal** at `/admin/resolve/[marketId]` (CLI lives in `tools/admin-resolve.ts` today).
- **Liquidity-bootstrapping subsidy** — `FeeVault`-funded balancing pool that seeds both sides at market open and gradually unwinds as bets arrive. Bounds the pari-mutuel imbalance footgun documented in `KNOWN_LIMITATIONS`.
- **3-of-5 hardware-signer multisig** with timelock module wrapping `setMarketImplementation` + `setResolutionOracle` (24-48h delay). Restores `MarketRegistry` to Safe-owned post-judging.
- **Mainnet deploy** with the canonical Arbitrum One Chainlink aggregator + sequencer-uptime feed wired into `ChainlinkPriceOracle` (already mainnet-ready, just needs the feed addresses set).
- **Mirror-on-DarkOdds clone flow** for Polymarket markets (data layer is already populated; UI CTA is currently disabled with an F11 tooltip).
- **Synchronous-encrypted minimum-bet enforcement** once Nox ships same-tx `Nox.ge` decryption — closes the dust-spam event-pollution surface.

Full follow-on inventory at [`Darkodds Master PRD v1.3.md`](./Darkodds%20Master%20PRD%20v1.3.md) §16.

---

## Repository layout

```
darkodds/
├── README.md                          # this file
├── DRIFT_LOG.md                       # process drift from PRD
├── BUG_LOG.md                         # resolved bugs
├── KNOWN_LIMITATIONS.md               # accepted v1 risks
├── feedback.md                        # iExec/ChainGPT DX notes
├── Darkodds Master PRD v1.3.md        # canonical spec
├── docs/
│   ├── ARCHITECTURE.md                # system topology + Nox handle lifecycle
│   ├── DEPLOYMENT.md                  # production-deploy guide for forks
│   ├── DEMO_SCRIPT.md                 # operator-authored demo screenplay
│   ├── POLYMARKET_INTEGRATION.md      # Gamma read-API quirks
│   └── RESOLUTION_AUDIT_2026-04-29.md # end-to-end resolution inventory
├── contracts/                         # Foundry workspace
│   ├── src/                           # 8 contracts (Market, Registry, oracles, cUSDC, etc.)
│   ├── audits/                        # Slither + ChainGPT artifacts
│   ├── deployments/arb-sepolia.json   # canonical addresses
│   └── test/
├── web/                               # Next.js 16 + Tailwind v4 + App Router
│   ├── app/
│   │   ├── (dashboard)/               # /markets, /portfolio, /audit, /create
│   │   ├── (legal)/                   # /terms, /privacy, /disclaimer
│   │   └── api/                       # admin/deploy-market, airdrop/gas, attestation, etc.
│   ├── components/                    # primitives, market, bet, portfolio, audit
│   └── lib/                           # darkodds, nox, polymarket, markets, airdrop, wallet
├── tools/                             # tsx scripts: deploy-*, smoke-*, verify-*, admin-resolve
├── tee-handlers/RUNTIME_DISCOVERY.md  # F5 finding: Nox runner is fixed, all compute is library calls
└── subgraph/                          # roadmapped F11 datasource wiring
```

---

## Hard rules (from PRD §0.5)

- No mocked data anywhere — demo runs against real Arbitrum Sepolia and real Nox handles
- No grids in primary content layout (single or two-column flex / list rows)
- No generic AI fonts (Inter, Roboto, Arial, Helvetica, Space Grotesk banned)
- No purple gradients, no glassmorphism, no bento boxes
- Latest stable versions only, exact pins (no `^`, no `~`)
- ERC-7984 implemented in full per OpenZeppelin reference

---

## Scope of work

DarkOdds was conceived and built end-to-end during the iExec Vibe Coding Challenge × ChainGPT hackathon period (April 2026). Every commit in this repository is from that window — see `git log` for the full timeline (`P0` through `F10b` plus the submission polish pass).

**Authored during the hackathon:**

- All eight Solidity contracts: `ConfidentialUSDC` (ERC-7984 native to Nox), `Market` (with on-chain proportional pari-mutuel payout via `Nox.mul / div / sub`), `MarketRegistry` (EIP-1167 clone factory), the three resolution adapters (`AdminOracle` / `ChainlinkPriceOracle` / `PreResolvedOracle`) routed through `ResolutionOracle`, `ClaimVerifier` (EIP-191 attestation gate), `FeeVault`, `Faucet`, `TestUSDC`
- The entire Next.js 16 frontend (10 routes, 7 API routes, dashboard primitives, landing page, OG image generators)
- The verifier suite (`verify:f10b` 24/24 + `verify:claim-flow` 21/21 = 45/45 end-to-end checks against live Arb Sepolia state)
- All tooling: deploy scripts (`deploy:f2` through `deploy:f5fu`), smoke tests, `admin-resolve.ts` CLI, `seed-claimable-market.ts`, healthcheck, ChainGPT auditor integration
- Brand, copy, illustrations, the case-file visual language, OG cards

**Pre-existing components we integrate against (not authored here):**

- The iExec Nox protocol contract at [`0xd464…c229`](https://sepolia.arbiscan.io/address/0xd464b198f06756a1d00be223634b85e0a731c229), operated by iExec — the TEE runtime our contracts call into
- `@iexec-nox/handle@0.1.0-beta.10` — the client-side TypeScript SDK for `encryptInput` / `publicDecrypt` / `decrypt`
- `@iexec-nox/nox-protocol-contracts` — the Solidity library that defines `Nox.add / mul / div / publicDecrypt` etc.
- ChainGPT GeneralChat + Smart Contract Auditor APIs — used at runtime for `/create` market generation and in CI for contract review
- Standard-issue dependencies: OpenZeppelin v5 (used as ERC-7984 reference), wagmi v4, viem v2, Privy v3.22, Next.js 16, Tailwind v4, Foundry, Gnosis Safe SDK
- Polymarket Gamma read APIs (display-only mirror, no proxied trading)

There is no fork of an existing project, no copy-pasted prediction-market codebase, no inherited frontend. The TEE-plaintext proportional payout (the technical wedge documented in `docs/ARCHITECTURE.md#verified-end-to-end`) is original protocol design — it solves the encrypted-by-encrypted division problem that pure-FHE prediction markets sidestep.

---

## License

MIT. See [`LICENSE`](./LICENSE) — the contracts and frontend are open for fork; the brand `DarkOdds`, the wordmark, and the case-file visual language are reserved.
