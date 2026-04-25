# DarkOdds

> **Confidential prediction market on Arbitrum Sepolia. Public outcomes, public odds, hidden bet sizes. Selective-disclosure payouts via iExec Nox.**

Polymarket but your bet size is hidden. Built on iExec Nox: outcomes and odds are public, your stake is encrypted. When you win, you get a cryptographic receipt you can show your accountant — or keep sealed forever. We solved the proportional payout problem that pure-FHE markets couldn't, by doing the math in TEE plaintext.

— iExec Vibe Coding Challenge × ChainGPT, DoraHacks

---

## Status

**Phase F3** — Market core live. P0 + F1 + F2 + F3 all GREEN. ConfidentialUSDC v2 (with EIP-7984 operator pattern), Market implementation, MarketRegistry, and one test market are deployed and verified on Arbitrum Sepolia. The full bet → batch publish round-trip works against real Nox infra (see [feedback.md](./feedback.md) for the latency table). Frontend, oracle, claim flow are still ahead.

| Phase | Deliverable                                  | Status |
| ----- | -------------------------------------------- | ------ |
| P0    | Nox devnet health check                      | ✅     |
| F1    | Monorepo skeleton                            | ✅     |
| F2    | `ConfidentialUSDC.sol` + tests + deploy      | ✅     |
| F3    | `Market.sol` + `MarketRegistry.sol`          | ✅     |
| F4    | Resolution + Claim                           | ⏳     |
| F4.5  | Security hardening                           | ⏳     |
| F5    | TEE handlers                                 | ⏳     |
| F6    | Frontend skeleton + design system            | ⏳     |
| F7–13 | Pages, bet flow, portfolio, ChainGPT, polish | ⏳     |

See [Darkodds Master PRD v1.3.md](./Darkodds%20Master%20PRD%20v1.3.md) for the full phase plan (active: v1.3, the Nox-native architecture), [DRIFT_LOG.md](./DRIFT_LOG.md) for divergences, [BUG_LOG.md](./BUG_LOG.md) for bugs, [feedback.md](./feedback.md) for iExec/ChainGPT DX feedback.

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

| Command                    | Action                                                            |
| -------------------------- | ----------------------------------------------------------------- |
| `pnpm healthcheck`         | Run P0 Nox infrastructure validation (5-step reachability)        |
| `pnpm dev:web`             | Boot Next.js dev server on `localhost:3000`                       |
| `pnpm build:web`           | Production build of `web/`                                        |
| `pnpm test:contracts`      | `forge test` against `contracts/`                                 |
| `pnpm test:contracts:fork` | Fork test against live Arb Sepolia (`FORK_TEST=1`)                |
| `pnpm deploy:f2`           | Deploy F2 contracts via viem + verify on Arbiscan                 |
| `pnpm smoke:f2`            | F2 smoke test: real wrap → decrypt round-trip on Arb Sepolia      |
| `pnpm deploy:f3`           | Deploy F3 (cUSDC v2 + Market impl + Registry + market 0)          |
| `pnpm smoke:f3`            | F3 smoke test: real bet → batch publish round-trip on Arb Sepolia |
| `pnpm lint`                | ESLint over `web/`                                                |
| `pnpm typecheck`           | `tsc --noEmit` for `tools/` + `web/`                              |
| `pnpm format`              | Prettier write across all workspaces (incl. Solidity)             |
| `pnpm format:check`        | Prettier check (CI-friendly)                                      |

A `husky` pre-commit hook runs `lint-staged` (Prettier + ESLint on staged files).

---

## Deploy addresses

| Network          | Contract                              | Address                                                                                                                                                                    |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbitrum Sepolia | `TestUSDC.sol`                        | [`0xf02C982D19184c11b86BC34672441C45fBF0f93E`](https://sepolia.arbiscan.io/address/0xf02c982d19184c11b86bc34672441c45fbf0f93e) ✅                                          |
| Arbitrum Sepolia | `ConfidentialUSDC.sol` (v2, operator) | [`0xaF1ACDf0B031080D4fAd75129E74d89eaD450c4D`](https://sepolia.arbiscan.io/address/0xaf1acdf0b031080d4fad75129e74d89ead450c4d) ✅                                          |
| Arbitrum Sepolia | `Market.sol` (implementation)         | [`0x8F16021bf370eCA1Bd94210a318416b9116F0a2E`](https://sepolia.arbiscan.io/address/0x8f16021bf370eca1bd94210a318416b9116f0a2e) ✅                                          |
| Arbitrum Sepolia | `MarketRegistry.sol`                  | [`0xeC13c614f817A97462ca669473f28A3E6aAcaAFB`](https://sepolia.arbiscan.io/address/0xec13c614f817a97462ca669473f28a3e6aacaafb) ✅                                          |
| Arbitrum Sepolia | Market[0] (test, EIP-1167 clone)      | [`0x60A1E4f30B02E78c0DC9bD28Ac468052dA01279E`](https://sepolia.arbiscan.io/address/0x60a1e4f30b02e78c0dc9bd28ac468052da01279e) ✅                                          |
| Arbitrum Sepolia | `ResolutionOracle.sol`                | _Phase F4_                                                                                                                                                                 |
| Arbitrum Sepolia | `ClaimVerifier.sol`                   | _Phase F4_                                                                                                                                                                 |
| Arbitrum Sepolia | `FeeVault.sol`                        | _Phase F4_                                                                                                                                                                 |
| Arbitrum Sepolia | Nox protocol (iExec)                  | `0xd464B198f06756a1d00be223634b85E0a731c229`                                                                                                                               |
| Arbitrum Sepolia | `ConfidentialUSDC` v1 (legacy F2)     | [`0xf9f3A9F5F3a2F4138FB680D5cDfa635FD4312372`](https://sepolia.arbiscan.io/address/0xf9f3a9f5f3a2f4138fb680d5cdfa635fd4312372) — superseded by v2; wrap/unwrap still works |

Verified addresses canonical at [`contracts/deployments/arb-sepolia.json`](./contracts/deployments/arb-sepolia.json).

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
