# DarkOdds

> **Privacy-permissionless prediction markets on Arbitrum Sepolia. Anyone deploys, anyone bets, odds are public, bet sizes are encrypted. Selective-disclosure payouts via iExec Nox.**

Polymarket without the curation gate or the public stake size. Anyone deploys a market on anything; anyone bets without revealing their position. Built on iExec Nox: outcomes and odds are public, your stake is encrypted. When you win, you get a cryptographic receipt you can show your accountant — or keep sealed forever. We solved the proportional payout problem that pure-FHE markets couldn't, by doing the math in TEE plaintext.

— iExec Vibe Coding Challenge × ChainGPT, DoraHacks

---

## Status

**Phase F5** — On-chain payout complete. `Market.claimWinnings` now computes the full proportional pari-mutuel payout on-chain via Nox encrypted arithmetic (`Nox.mul` / `Nox.div` / `Nox.sub`) and confidentially transfers winnings to the caller. TEE handler images are not needed — the Nox Runner is a protocol-managed TDX service; all application compute uses Solidity library calls (see `tee-handlers/RUNTIME_DISCOVERY.md`). `MarketImplementation v4` deployed and wired via the Safe multisig. smoke-f5 GREEN (30 steps, 294s) with `ClaimSettled` event confirmed on Arb Sepolia.

**Phase F4.5** — Security hardening. Slither 0 High / 0 real Medium. Governance migrated to 2-of-3 Gnosis Safe v1.4.1. `MarketImplementation v3` patched for ERC-7984 invariant. smoke-f45 GREEN.

| Phase | Deliverable                                        | Status |
| ----- | -------------------------------------------------- | ------ |
| P0    | Nox devnet health check                            | ✅     |
| F1    | Monorepo skeleton                                  | ✅     |
| F2    | `ConfidentialUSDC.sol` + tests + deploy            | ✅     |
| F3    | `Market.sol` + `MarketRegistry.sol`                | ✅     |
| F4    | Resolution + Claim                                 | ✅     |
| F4.5  | Security hardening + multisig governance           | ✅     |
| F5    | On-chain payout (Nox arithmetic)                   | ✅     |
| F6    | Landing (hero + sidebyside + howitworks + stack)   | ✅     |
| F7    | Dashboard shell + Privy + faucet                   | ✅     |
| F8    | /markets parallel feed (DarkOdds + Polymarket)     | ✅     |
| F9–13 | Detail page, bet flow, portfolio, ChainGPT, polish | ⏳     |

See [Darkodds Master PRD v1.3.md](./Darkodds%20Master%20PRD%20v1.3.md) for the full phase plan (active: v1.3, the Nox-native architecture), [DRIFT_LOG.md](./DRIFT_LOG.md) for divergences, [BUG_LOG.md](./BUG_LOG.md) for bugs, [feedback.md](./feedback.md) for iExec/ChainGPT DX feedback, [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) for v1 scope choices.

---

## Governance (post-F4.5)

All seven `Ownable` contracts are owned by a **2-of-3 Gnosis Safe v1.4.1** at
[`0x042a49628f8A107C476B01bE8edEbB38110FA332`](https://app.safe.global/?safe=arb-sep:0x042a49628f8A107C476B01bE8edEbB38110FA332)
(Safe UI). Migration tx audit trail in `deployments/arb-sepolia.json`
under `safe.deploymentTx` and `ownership.contracts.<name>.transferTx`.

| Field           | Value                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Safe address    | `0x042a49628f8A107C476B01bE8edEbB38110FA332`                                                               |
| Version         | Safe v1.4.1 (canonical)                                                                                    |
| Threshold       | 2-of-3                                                                                                     |
| Signers         | deployer + 2 fresh EOAs                                                                                    |
| Owned contracts | TestUSDC, MarketRegistry, ResolutionOracle, AdminOracle, PreResolvedOracle, ChainlinkPriceOracle, FeeVault |

Owner-side ops (`createMarket`, `setAdapter`, `setMarketImplementation`,
`mint TestUSDC`, etc.) require two co-signatures; see `tools/smoke-f45.ts`
for the canonical Safe-mediated execution pattern.

---

## Quickstart

Prereqs:

- Node.js ≥ 22 (`node --version`)
- pnpm ≥ 10 (`pnpm --version` or `corepack enable && corepack prepare pnpm@latest --activate`)
- Foundry (`forge --version`) — install via [foundryup](https://book.getfoundry.sh/getting-started/installation)

```bash
git clone <repo-url>
cd darkodds
pnpm install
pnpm healthcheck
```

Expected output: a five-row `PASS` table ending with `GREEN — Nox infra validated, ready for Phase F1`.

To run the sanity contract test:

```bash
pnpm test:contracts
# Suite result: ok. 1 passed; 0 failed; 0 skipped
```

### End-to-end backend verification

```bash
pnpm verify:backend
```

9-step interactive walkthrough that exercises every contract on real Arbitrum
Sepolia: wrap → bet → batch → resolve → claim → attest → verify → unwrap. The
script pauses between each step so you can confirm txs on Arbiscan in real
time. Takes ~5 minutes including the 60s batch wait and the 60s claim-window
delay. Output is saved to `verification-output/<timestamp>/` — transcript,
generated attestation JSON, Arbiscan link index, and final balance assertions.

Pre-flight requires the deployer wallet to hold ≥ 0.02 ETH; the script funds a
fresh test wallet from the deployer for the run (recommended) or reuses the
deployer wallet directly (faster, but mixes state).

To boot the placeholder frontend:

```bash
pnpm dev:web
# → http://localhost:3000 — "DarkOdds / Phase F1 skeleton"
```

---

## Repository layout

```
darkodds/
├── README.md
├── DRIFT_LOG.md
├── BUG_LOG.md
├── feedback.md
├── Darkodds Master PRD v1.3.md     # canonical spec (v1.3)
├── package.json                    # workspace root
├── pnpm-workspace.yaml             # web + subgraph workspaces
├── tsconfig.json                   # tools/ typecheck
├── tools/
│   └── healthcheck.ts              # P0 Nox infra gate
├── contracts/                      # Foundry — NOT a pnpm workspace
│   ├── foundry.toml
│   ├── remappings.txt
│   ├── lib/                        # forge install (gitsubmodules)
│   ├── src/
│   ├── script/
│   ├── test/
│   │   └── Sanity.t.sol            # 1 + 1 == 2
│   └── deployments/
├── web/                            # Next.js 16 + Tailwind v4 + App Router
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css             # PRD §7.1 design tokens
│   │   └── page.tsx                # placeholder
│   ├── components/                 # primitives/ market/ bet/ portfolio/ audit/
│   ├── lib/
│   ├── hooks/
│   └── public/
│       └── fonts/                  # Geist, Geist Mono, Fraunces, Special Elite (woff2)
└── subgraph/                       # The Graph — Phase F11 wires datasources
    ├── subgraph.yaml
    ├── schema.graphql
    ├── src/mappings.ts
    └── package.json
```

---

## Root scripts

| Command                    | Action                                                                 |
| -------------------------- | ---------------------------------------------------------------------- |
| `pnpm healthcheck`         | Run P0 Nox infrastructure validation (5-step reachability)             |
| `pnpm dev:web`             | Boot Next.js dev server on `localhost:3000`                            |
| `pnpm build:web`           | Production build of `web/`                                             |
| `pnpm test:contracts`      | `forge test` against `contracts/`                                      |
| `pnpm test:contracts:fork` | Fork test against live Arb Sepolia (`FORK_TEST=1`)                     |
| `pnpm deploy:f2`           | Deploy F2 contracts via viem + verify on Arbiscan                      |
| `pnpm smoke:f2`            | F2 smoke test: real wrap → decrypt round-trip on Arb Sepolia           |
| `pnpm deploy:f3`           | Deploy F3 (cUSDC v2 + Market impl + Registry + market 0)               |
| `pnpm smoke:f3`            | F3 smoke test: real bet → batch publish round-trip on Arb Sepolia      |
| `pnpm deploy:f4`           | Deploy F4 (resolution + claim suite: 8 contracts + 2 markets)          |
| `pnpm smoke:f4`            | F4 smoke test: full lifecycle (claim + INVALID refund), ~5 min         |
| `pnpm deploy:multisig`     | F4.5 — deploy 2-of-3 Safe + transfer ownership of 7 Ownable            |
| `pnpm deploy:f45`          | F4.5 — deploy patched MarketImpl v3 + Safe-set on registry             |
| `pnpm smoke:f45`           | F4.5 — full lifecycle smoke with Safe-mediated owner ops, ~5 min       |
| `pnpm deploy:f5`           | F5 — deploy MarketImpl v4 + Safe-set on registry (payout live)         |
| `pnpm smoke:f5`            | F5 — full lifecycle smoke verifying ClaimSettled payout, ~5 min        |
| `pnpm deploy:f5fu`         | F5-followup — deploy MarketImpl v5 (empty-winning-side auto-Invalid)   |
| `pnpm verify:backend`      | F5-final — interactive 9-step end-to-end backend verification (~5 min) |
| `pnpm lint`                | ESLint over `web/`                                                     |
| `pnpm typecheck`           | `tsc --noEmit` for `tools/` + `web/`                                   |
| `pnpm format`              | Prettier write across all workspaces (incl. Solidity)                  |
| `pnpm format:check`        | Prettier check (CI-friendly)                                           |

A `husky` pre-commit hook runs `lint-staged` (Prettier + ESLint on staged files).

---

## Deploy addresses

| Network          | Contract                              | Address                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbitrum Sepolia | `TestUSDC.sol`                        | [`0xf02C982D19184c11b86BC34672441C45fBF0f93E`](https://sepolia.arbiscan.io/address/0xf02c982d19184c11b86bc34672441c45fbf0f93e) ✅                                                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | `ConfidentialUSDC.sol` (v2, operator) | [`0xaF1ACDf0B031080D4fAd75129E74d89eaD450c4D`](https://sepolia.arbiscan.io/address/0xaf1acdf0b031080d4fad75129e74d89ead450c4d) ✅                                                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | `Market.sol` v5 (impl, F5-fu fix)     | [`0xf3aa651f5e5c8ff51472ae2beab6ec1ed0d27779`](https://sepolia.arbiscan.io/address/0xf3aa651f5e5c8ff51472ae2beab6ec1ed0d27779) ✅ (current, registry points here)                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | `Market.sol` v4 (legacy F5 impl)      | [`0x5dd7b5604419e6c35b0c7c9cf022c5adbaf4615a`](https://sepolia.arbiscan.io/address/0x5dd7b5604419e6c35b0c7c9cf022c5adbaf4615a) (Markets 7–8 pinned here)                                                                                                                                                                                                                                                                                                                                                 |
| Arbitrum Sepolia | `Market.sol` v3 (legacy F4.5 impl)    | [`0x73167B1F0e07D3D3CE24b05A90EF8b0d991Cc7eA`](https://sepolia.arbiscan.io/address/0x73167b1f0e07d3d3ce24b05a90ef8b0d991cc7ea) (Markets 3–6 pinned here)                                                                                                                                                                                                                                                                                                                                                 |
| Arbitrum Sepolia | `Market.sol` v2 (legacy F4 impl)      | [`0x297Ddb129f87B37e4B28cD1c1c6457ED0c7BB8c4`](https://sepolia.arbiscan.io/address/0x297ddb129f87b37e4b28cd1c1c6457ed0c7bb8c4) (Markets 1–2 still pinned here)                                                                                                                                                                                                                                                                                                                                           |
| Arbitrum Sepolia | `MarketRegistry.sol` v2 (Safe-owned)  | [`0xE66B2F638F5dB738243a44F7Aeb1cccc18906dD1`](https://sepolia.arbiscan.io/address/0xe66b2f638f5db738243a44f7aeb1cccc18906dd1) ✅                                                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | Gnosis Safe v1.4.1 (governance)       | [`0x042a49628f8A107C476B01bE8edEbB38110FA332`](https://app.safe.global/?safe=arb-sep:0x042a49628f8A107C476B01bE8edEbB38110FA332) ✅ 2-of-3                                                                                                                                                                                                                                                                                                                                                               |
| Arbitrum Sepolia | `ResolutionOracle.sol`                | [`0x27dC556B9e6c1A031bd779E9524936F70b66B96C`](https://sepolia.arbiscan.io/address/0x27dc556b9e6c1a031bd779e9524936f70b66b96c) ✅                                                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | `AdminOracle.sol`                     | [`0x96b6ECC138A231Ddff9e8eA856FB8869b4be103F`](https://sepolia.arbiscan.io/address/0x96b6ecc138a231ddff9e8ea856fb8869b4be103f) ✅                                                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | `PreResolvedOracle.sol`               | [`0x76147D3C1e241B4bb746002763991789661Cc893`](https://sepolia.arbiscan.io/address/0x76147d3c1e241b4bb746002763991789661cc893) ✅                                                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | `ChainlinkPriceOracle.sol`            | [`0x316dC924697406AF553C7276c285B11b83cC3CB2`](https://sepolia.arbiscan.io/address/0x316dc924697406af553c7276c285b11b83cc3cb2) ✅ (mainnet-ready; no Chainlink feeds on Arb Sepolia)                                                                                                                                                                                                                                                                                                                     |
| Arbitrum Sepolia | `ClaimVerifier.sol`                   | [`0x5cC49763703656feC4Be672e254F7F024dE2b82A`](https://sepolia.arbiscan.io/address/0x5cc49763703656fec4be672e254f7f024de2b82a) ✅ (placeholder TDX; F5 redeploys)                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | `FeeVault.sol`                        | [`0x4FC729a98824Bf2E6da4BBA903eAd73432aFa351`](https://sepolia.arbiscan.io/address/0x4fc729a98824bf2e6da4bba903ead73432afa351) ✅                                                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | `Faucet.sol`                          | [`0xcB8e251CD6EB0BB797c0721CAB84f41C8CD359A5`](https://sepolia.arbiscan.io/address/0xcb8e251cd6eb0bb797c0721cab84f41c8cd359a5) ✅ (Safe-owned, dispenses 1k tUSDC / 6h)                                                                                                                                                                                                                                                                                                                                  |
| Arbitrum Sepolia | Market[1] (admin-resolved, +14d, F4)  | [`0x98ae591D6D5f31FC6840d9124e58963cC2EC53f7`](https://sepolia.arbiscan.io/address/0x98ae591d6d5f31fc6840d9124e58963cc2ec53f7) ✅                                                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | Market[2] (pre-resolved YES, F4)      | [`0xeC3b47C7eAaF601a32cdfDe37aA078ebbc1c3297`](https://sepolia.arbiscan.io/address/0xec3b47c7eaaf601a32cdfde37aa078ebbc1c3297) ✅                                                                                                                                                                                                                                                                                                                                                                        |
| Arbitrum Sepolia | Market[5–6] (smoke-f45, MarketImplV3) | clones of v3, lifecycle witnesses for the F4.5 governance + patched-impl smoke (`smoke-f45`)                                                                                                                                                                                                                                                                                                                                                                                                             |
| Arbitrum Sepolia | Nox protocol (iExec)                  | `0xd464B198f06756a1d00be223634b85E0a731c229`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Arbitrum Sepolia | _legacy F2/F3_                        | F2 cUSDC v1 [`0xf9f3...2372`](https://sepolia.arbiscan.io/address/0xf9f3a9f5f3a2f4138fb680d5cdfa635fd4312372); F3 Market impl [`0x8F16...0a2E`](https://sepolia.arbiscan.io/address/0x8f16021bf370eca1bd94210a318416b9116f0a2e); F3 registry [`0xeC13...aAFB`](https://sepolia.arbiscan.io/address/0xec13c614f817a97462ca669473f28a3e6aacaafb); Market[0] [`0x60A1...279E`](https://sepolia.arbiscan.io/address/0x60a1e4f30b02e78c0dc9bd28ac468052da01279e). All superseded; F2 wrap/unwrap still works. |

Verified addresses canonical at [`contracts/deployments/arb-sepolia.json`](./contracts/deployments/arb-sepolia.json).

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

## Hard rules (from PRD §0.5)

- No mocked data anywhere — demo runs against real Arbitrum Sepolia and real Nox handles
- No grids in primary content layout (single or two-column flex / list rows)
- No generic AI fonts (Inter, Roboto, Arial, Helvetica, Space Grotesk banned — see `web/public/fonts/`)
- No purple gradients, no glassmorphism, no bento boxes
- Latest stable versions only, exact pins (no `^`, no `~`)
- ERC-7984 implemented in full per OpenZeppelin reference

---

## Submission

iExec Vibe Coding Challenge × ChainGPT — DoraHacks. Author: Tim (winsznx).
