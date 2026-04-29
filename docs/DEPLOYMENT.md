# Deployment

This guide takes a stranger from "I cloned the repo" to "the app is live on a custom domain." Local dev only needs the read-only env vars; production deploys need the full server-side set. The smart contracts are already deployed on Arbitrum Sepolia — a fork doesn't redeploy them, it just points at the canonical addresses in [`contracts/deployments/arb-sepolia.json`](../contracts/deployments/arb-sepolia.json).

If you want to redeploy the contracts to a fresh chain (mainnet, a new testnet, a private rollup), see the `pnpm deploy:f2` → `f3` → `f4` → `f45` → `f5` → `f5fu` script chain in [`README.md`](../README.md). This document focuses on the frontend + API deploy path.

---

## Local dev (read-only)

Five minutes from clone to running app, assuming Node ≥ 22 and pnpm ≥ 10 are already installed.

```bash
git clone <repo-url>
cd darkodds
pnpm install

cp web/.env.example web/.env.local        # client + server vars for the Next.js app
cp .env.example .env                      # server-side vars for tools/* scripts

# Edit web/.env.local: set NEXT_PUBLIC_PRIVY_APP_ID + CHAINGPT_API_KEY
# Edit .env:           set DEPLOYER_PRIVATE_KEY (any funded Arb Sepolia wallet works)

pnpm healthcheck                          # confirms Nox infrastructure is reachable
pnpm verify:f10b                          # 24/24 — confirms env setup is correct
pnpm dev:web                              # http://localhost:3000
```

`verify:f10b` is the realistic local-setup gate. It exercises the registry, sponsored-deploy API surface, ChainGPT proxy, and adapter wiring against the live Arb Sepolia state — if the env vars are right and the deployer wallet is funded, it lands 24/24 in ~30 seconds. If you don't have a funded wallet, see [Where to get testnet ETH](#where-to-get-testnet-eth) below.

The Privy app id can be a throwaway dev app from `app.privy.io`. The ChainGPT key needs a real account from `app.chaingpt.org` (free tier covers dev usage).

---

## Required env vars

### Client-side (`web/.env.local`)

These are bundled into the client JS via Next.js's `NEXT_PUBLIC_*` prefix. **Never** put secrets here.

| Variable                          | Required | Description                                                                                                                   |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_PRIVY_APP_ID`        | yes      | Privy dashboard → app id. Drives the embedded-wallet auth flow.                                                               |
| `NEXT_PUBLIC_ARB_SEPOLIA_RPC_URL` | yes      | Arbitrum Sepolia RPC URL. Default `https://sepolia-rollup.arbitrum.io/rpc` works; rate limits are generous for hackathon use. |
| `NEXT_PUBLIC_APP_URL`             | optional | Canonical app URL for OG image generation + sitemap. Defaults to `https://darkodds.site`. Set to your prod URL.               |

### Server-side (Vercel project env, or `web/.env.local` for local dev)

These run inside the Next.js API routes only and are never bundled. **All are secrets.**

| Variable                 | Required for               | Description                                                                                                  |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `CHAINGPT_API_KEY`       | `/api/chaingpt/*`          | ChainGPT GeneralChat key. Powers `/create` market generation.                                                |
| `DEPLOYER_PRIVATE_KEY`   | `/api/admin/deploy-market` | Sponsored-deploy signer. Funds the EOA-side `createMarket` tx. Holds Safe signer #1.                         |
| `MULTISIG_SIGNER_2_PK`   | `/api/admin/deploy-market` | Safe signer #2. Co-signs `setAdapter` after `createMarket`. See note on dual-key trust below.                |
| `MULTISIG_SIGNER_3_PK`   | `tools/smoke-f45.ts`       | Safe signer #3. Used by smoke tests + admin-resolve CLI. Not needed for the deployed app's API routes.       |
| `AIRDROP_PRIVATE_KEY`    | `/api/airdrop/gas`         | Wallet that grants 0.005 ETH per fresh user. Should hold ~0.5 ETH (covers ~100 grants).                      |
| `KV_REST_API_URL`        | optional                   | Vercel KV REST URL. Auto-injected by the Vercel KV integration. Falls back to `/tmp/*-ledger.json` if unset. |
| `KV_REST_API_TOKEN`      | optional                   | Vercel KV REST token. Same auto-injection.                                                                   |
| `AIRDROP_HISTORY_PATH`   | optional                   | Override path for airdrop file-fallback ledger. Default `/tmp/airdrop-history.json`.                         |
| `CREATED_BY_LEDGER_PATH` | optional                   | Override path for created-by file-fallback ledger. Default `/tmp/created-by-ledger.json`.                    |
| `ARB_SEPOLIA_RPC_URL`    | tools/\* scripts           | Server-side RPC URL for tools/\* scripts. Mirror of the client-side var, but read by tsx without the prefix. |

### Server-side dual-key trust note

`/api/admin/deploy-market` holds two Safe signing keys (`DEPLOYER_PRIVATE_KEY` + `MULTISIG_SIGNER_2_PK`) so it can Safe-cosign `setAdapter` after the EOA `createMarket`. During the live-judging window this reduces the multisig to effectively single-sig at the Vercel layer — anyone with project access can sign as both signers. Restoration is one line: rotate signer 2's key in the Safe + remove `MULTISIG_SIGNER_2_PK` from server env. Tracked for post-judging restoration alongside the registry-ownership transfer. Full reasoning in [`KNOWN_LIMITATIONS.md`](../KNOWN_LIMITATIONS.md).

---

## Vercel deploy

DarkOdds runs on Vercel out of the box. The repo is a pnpm workspace with `web/` as the deployable Next.js app.

### Project setup

1. Sign in to [vercel.com](https://vercel.com) and import the GitHub repo.
2. **Framework preset:** Next.js. Vercel auto-detects.
3. **Root directory:** `web` (NOT the repo root — the workspace lives one level deep).
4. **Build command:** `pnpm --filter web run build` (or use the default `pnpm run build`, which Vercel routes correctly when root is `web/`).
5. **Install command:** `pnpm install` from the repo root. Vercel infers this from the workspace root if it detects `pnpm-workspace.yaml`.
6. **Output directory:** `.next` (default — leave unset).
7. **Node version:** 22 or higher. Set in project settings → General → Node.js Version.

### Env vars

In project settings → Environment Variables, add every variable from the [Required env vars](#required-env-vars) table. Mark them all `Production` + `Preview` + `Development` unless you have a reason to scope.

For the optional Vercel KV integration: project settings → Storage → connect a KV instance. Vercel auto-injects `KV_REST_API_URL` + `KV_REST_API_TOKEN` into the project env; you don't manually set these.

### Domain mapping

Project settings → Domains → Add Domain → enter your custom domain. For `darkodds.site`:

| Record type | Host                   | Value                  | TTL |
| ----------- | ---------------------- | ---------------------- | --- |
| `A`         | `darkodds.site` (apex) | `76.76.21.21`          | 300 |
| `CNAME`     | `www.darkodds.site`    | `cname.vercel-dns.com` | 300 |

Vercel will surface the exact records to set in its dashboard — copy from there if your registrar's UI differs. SSL provisioning takes 1–5 minutes after DNS propagates.

---

## Privy dashboard config

DarkOdds uses Privy v3.22 + the wagmi adapter v4.0.6. Go to [`app.privy.io`](https://app.privy.io) → your app → Settings.

### Allowed origins

Add every domain the app runs on:

- `http://localhost:3000` (local dev)
- `https://your-vercel-preview.vercel.app` (preview deploys)
- `https://darkodds.site` (or your prod domain)

Without these, Privy modals fail to open with a CORS error in console.

### Embedded wallets

- **Create on login:** `Users without wallets`. Privy spins up an embedded wallet on first sign-in for users who don't connect an external one.
- **Default chain:** Arbitrum Sepolia (chainId `421614`). Add it in Settings → Networks → Custom Network if it's not in the preset list.

### Login methods

- Enable: Email, Google, Wallet (external).
- Disable everything else unless you have product reason to add SMS or Apple.

### Branding

- **App name:** DarkOdds
- **Logo URL:** `https://darkodds.site/icon.svg` (or whatever `/icon.svg` resolves to on your deploy)
- **Theme:** Auto. The dashboard syncs Privy's modal theme to the user's site theme via `useTheme()` at the PrivyProvider level.

---

## Post-deploy validation

Before announcing, hit every surface:

| Check                                                                                 | Why it catches things                                                               |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `https://your-domain/` loads                                                          | Sanity. If this fails the deploy itself broke.                                      |
| `https://your-domain/markets` loads + shows DarkOdds + Polymarket markets             | Confirms RPC + Polymarket Gamma proxy both work in prod env.                        |
| `https://your-domain/sitemap.xml` returns 200 + valid XML                             | Confirms the sitemap route prerendered. Includes static + dynamic market URLs.      |
| `https://your-domain/robots.txt` returns 200                                          | Confirms App Router metadata routes work.                                           |
| Privy email-auth flow on `/portfolio` end-to-end                                      | Confirms `NEXT_PUBLIC_PRIVY_APP_ID` is set, allowed-origins includes your domain.   |
| Connect wallet → Faucet modal → claim 1k tUSDC                                        | Confirms wagmi tx flow + Privy embedded wallet hydration.                           |
| `/airdrop` / first-bet flow grants 0.005 ETH                                          | Confirms `AIRDROP_PRIVATE_KEY` is funded + KV ledger persists across requests.      |
| `/create` deploys a market via ChainGPT                                               | Confirms `CHAINGPT_API_KEY` + `DEPLOYER_PRIVATE_KEY` + `MULTISIG_SIGNER_2_PK` work. |
| OG card preview via [`opengraph.xyz`](https://www.opengraph.xyz)                      | Confirms `app/opengraph-image.tsx` renders with embedded fonts.                     |
| OG card preview via [Twitter Card Validator](https://cards-dev.twitter.com/validator) | Same, but X-specific (caches separately).                                           |
| `pnpm verify:f10b` against the prod env (mainnet only after redeploy)                 | End-to-end sanity if you've forked + redeployed contracts.                          |

If `/api/admin/deploy-market` returns 500, the most common causes are:

- `DEPLOYER_PRIVATE_KEY` is set but the wallet has < 0.001 ETH for gas
- `MULTISIG_SIGNER_2_PK` is set but doesn't match a current Safe signer (rotated keys)
- `CHAINGPT_API_KEY` rate-limited (free tier is generous but not infinite)

The route's response body always includes a `code` field; grep server logs for the matching code.

---

## Where to get testnet ETH

You'll need ~0.02 ETH on Arbitrum Sepolia at the deployer wallet to run `verify:f10b` and `verify:claim-flow`. Public faucets, in approximate reliability order:

- **Alchemy Arbitrum Sepolia faucet** — [`alchemy.com/faucets/arbitrum-sepolia`](https://www.alchemy.com/faucets/arbitrum-sepolia). Requires Alchemy account; ~0.5 ETH per claim per 24h.
- **Chainlink faucet** — [`faucets.chain.link/arbitrum-sepolia`](https://faucets.chain.link/arbitrum-sepolia). Requires GitHub auth; smaller drip.
- **QuickNode faucet** — [`faucet.quicknode.com/arbitrum/sepolia`](https://faucet.quicknode.com/arbitrum/sepolia). Requires Twitter; ~0.1 ETH.
- **Bridge from Ethereum Sepolia** via [`bridge.arbitrum.io`](https://bridge.arbitrum.io) if you have Sepolia ETH already. Slower (10–15 min) but most reliable when public faucets are drained.

For TestUSDC: use the in-app `Faucet` modal (1,000 tUSDC per address per 6h) once you've connected a wallet on `/markets`. Or call `Faucet.claim()` directly via Etherscan — no allowance, no wrap, just `safeTransfer`.

---

## Forking + redeploying contracts

If you want a new deployment instead of pointing at the canonical Arb Sepolia addresses:

```bash
# Fund the deployer wallet first (~0.05 ETH on the target chain)
pnpm deploy:f2          # ConfidentialUSDC + TestUSDC
pnpm deploy:f3          # Market impl + Registry + Market[0]
pnpm deploy:f4          # Resolution + Claim suite (8 contracts)
pnpm deploy:multisig    # 2-of-3 Safe + transfer ownership of 7 Ownable
pnpm deploy:f45         # Patched MarketImpl v3
pnpm deploy:f5          # MarketImpl v4 (on-chain payout)
pnpm deploy:f5fu        # MarketImpl v5 (empty-winning-side auto-Invalid)
pnpm deploy:faucet      # 1k tUSDC / 6h faucet, Safe-owned
```

Each script writes to `contracts/deployments/<chain>.json` and emits the deployed addresses to stdout. After all phases complete, point your frontend's chain config at the new addresses (the addresses are read from the JSON; no code changes needed for an Arb Sepolia → Arb Sepolia redeploy).

For mainnet, also wire the canonical Chainlink BTC/USD aggregator into `ChainlinkPriceOracle` via `setSequencerFeed` + `setHeartbeatThreshold`. See [`README.md#oracletype1--chainlink-price-feed`](../README.md#oracletype1--chainlink-price-feed) for the addresses to use.

---

## Troubleshooting

**"Module not found: @vercel/kv" at build time.** The `@vercel/kv` package is loaded via `createRequire` so it stays optional. If your deploy environment is strict about lazy imports, install it explicitly: `pnpm --filter web add @vercel/kv`.

**Privy modal opens but reverts to "loading…" indefinitely.** Allowed origins missing your prod domain. Re-check Privy dashboard → Settings → Allowed origins.

**Wagmi `useAccount().address` returns undefined for hundreds of ms after sign-in.** Known Privy hydration race. Use `useConnectedAddress()` from `web/lib/wallet/use-connected-address.ts` instead — it reads from Privy's `useWallets()` directly and returns the typed `0x${string}` once `ready && authenticated` flips.

**`/api/admin/deploy-market` 500s with "Safe nonce in use".** A previous Safe tx is still pending. Wait for it to land or invalidate; the route doesn't queue Safe txs.

**Polymarket cards show "—" for prices.** Gamma is rate-limiting. The proxy caches 60s server-side; wait one cache window. If 429s persist, set `next: {revalidate: 300}` on the list endpoint as a temporary backoff.

**OG card preview shows blank.** Variable TTFs crash Satori during ImageResponse generation. The repo uses static TTF instances at `web/public/fonts/` — confirm those files exist after a fresh clone (some git clients skip large binaries).

For anything not listed here: open an issue with the route, the env (preview vs prod), and the response body's `code` field.
