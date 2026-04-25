# DarkOdds

> **Confidential prediction market on Arbitrum Sepolia. Public outcomes, public odds, hidden bet sizes. Selective-disclosure payouts via iExec Nox.**

Polymarket but your bet size is hidden. Built on iExec Nox: outcomes and odds are public, your stake is encrypted. When you win, you get a cryptographic receipt you can show your accountant — or keep sealed forever. We solved the proportional payout problem that pure-FHE markets couldn't, by doing the math in TEE plaintext.

— iExec Vibe Coding Challenge × ChainGPT, DoraHacks

---

## Status

**Phase F1** — monorepo skeleton. P0 (Nox infra reachability) is GREEN. Contracts, web, and subgraph are scaffolded but empty (sanity test only). Real implementation begins in Phase F2.

| Phase | Deliverable                                  | Status |
| ----- | -------------------------------------------- | ------ |
| P0    | Nox devnet health check                      | ✅     |
| F1    | Monorepo skeleton                            | ✅     |
| F2    | `ConfidentialUSDC.sol` + tests + deploy      | ⏳     |
| F3    | `Market.sol` + `MarketRegistry.sol`          | ⏳     |
| F4    | Resolution + Claim                           | ⏳     |
| F4.5  | Security hardening                           | ⏳     |
| F5    | TEE handlers                                 | ⏳     |
| F6    | Frontend skeleton + design system            | ⏳     |
| F7–13 | Pages, bet flow, portfolio, ChainGPT, polish | ⏳     |

See [Darkodds Master PRD v1.2.md](./Darkodds%20Master%20PRD%20v1.2.md) for the full phase plan, [DRIFT_LOG.md](./DRIFT_LOG.md) for divergences, [BUG_LOG.md](./BUG_LOG.md) for bugs, [feedback.md](./feedback.md) for iExec/ChainGPT DX feedback.

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
├── Darkodds Master PRD v1.2.md     # canonical spec
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

| Command               | Action                                                     |
| --------------------- | ---------------------------------------------------------- |
| `pnpm healthcheck`    | Run P0 Nox infrastructure validation (5-step reachability) |
| `pnpm dev:web`        | Boot Next.js dev server on `localhost:3000`                |
| `pnpm build:web`      | Production build of `web/`                                 |
| `pnpm test:contracts` | `forge test` against `contracts/`                          |
| `pnpm lint`           | ESLint over `web/`                                         |
| `pnpm typecheck`      | `tsc --noEmit` for `tools/` + `web/`                       |
| `pnpm format`         | Prettier write across all workspaces (incl. Solidity)      |
| `pnpm format:check`   | Prettier check (CI-friendly)                               |

A `husky` pre-commit hook runs `lint-staged` (Prettier + ESLint on staged files).

---

## Deploy addresses

| Network          | Contract                | Address                                      |
| ---------------- | ----------------------- | -------------------------------------------- |
| Arbitrum Sepolia | `ConfidentialUSDC.sol`  | _Phase F2_                                   |
| Arbitrum Sepolia | `MarketRegistry.sol`    | _Phase F3_                                   |
| Arbitrum Sepolia | `Market.sol` (template) | _Phase F3_                                   |
| Arbitrum Sepolia | `ResolutionOracle.sol`  | _Phase F4_                                   |
| Arbitrum Sepolia | `ClaimVerifier.sol`     | _Phase F4_                                   |
| Arbitrum Sepolia | `FeeVault.sol`          | _Phase F4_                                   |
| Arbitrum Sepolia | Nox protocol            | `0xd464B198f06756a1d00be223634b85E0a731c229` |

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
