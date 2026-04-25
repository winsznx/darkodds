# feedback.md

iExec Vibe Coding Challenge — DarkOdds developer feedback on the Nox SDK and surrounding infra.
Written as the build progresses; concrete and specific only (per PRD §0.4).

---

## P0 — Day 0 infrastructure validation gate

### Setup choices

- Package manager: **pnpm** (per PRD §15.2).
- Runner: **tsx** (project-type `module`, ESNext target, `Bundler` resolution). Bun considered but tsx kept for closer parity with the Next.js/web subproject that lands in Phase F1.
- TypeScript: pinned to `5.9.3`. npm `dist-tags.latest` for `typescript` is `6.0.3`; we are intentionally on the 5.x line per the P0 prompt's explicit constraint.
- Viem: `2.48.4` (latest stable, peer-compatible with `@iexec-nox/handle`'s `viem ^2.0.0` peer range).
- Nox SDK: `@iexec-nox/handle@0.1.0-beta.10`. See DRIFT_LOG: there is no stable channel; the package is beta-only.
- RPC: `https://sepolia-rollup.arbitrum.io/rpc` — public Arbitrum-operated endpoint. Returned `0x66eee` (chainId 421614) on a cold `eth_chainId` POST. No fallbacks needed.

### Install experience

- `npm view @iexec-nox/handle` resolves cleanly. The README points at `https://github.com/iExec-Nox/nox-handle-sdk` which is helpful for confirming the org migration (the PRD §15.1 link `https://www.npmjs.com/org/iexec-nox` is still correct — same scope).
- The package self-describes as "TypeScript SDK for NOX Handle" and ships pre-built (351.6 kB unpacked). No native deps. Single runtime dep on `graphql-request` for the gateway/subgraph.
- Peer deps include both `ethers ^6.0.0` and `viem ^2.0.0`. The Viem-only consumer pays a peer-warning tax on install. Suggestion: split this into two packages (`@iexec-nox/handle-viem` and `@iexec-nox/handle-ethers`) or move both to `peerDependenciesMeta` with `optional: true`. Today, an `ethers`-free pnpm install logs a `WARN missing peer ethers` even though Viem is sufficient.

### API ergonomics — `createViemHandleClient`

- **Positive:** the doc page at `/nox-protocol/references/js-sdk/getting-started` shows the exact 4-line setup (`privateKeyToAccount` → `createWalletClient` → `createViemHandleClient`) that we copy-pasted into `tools/healthcheck.ts`. Worked first try.
- **Friction:** the getting-started snippet does NOT pass `chain: arbitrumSepolia` to `createWalletClient`, but the `chain` field is conventional for any non-trivial Viem wallet client. We added it defensively. Worth a one-line note in the doc clarifying whether the SDK reads `walletClient.chain.id` or hardcodes Arbitrum Sepolia.
- **Friction:** the advanced-configuration page explicitly says "only Arbitrum Sepolia (chainId 421614) is listed as a supported network with automatic configuration" and "to use an unsupported chain, you must provide all three settings (`gatewayUrl`, `smartContractAddress`, `subgraphUrl`)". This is fine — but the docs do not surface the _current_ default values for those three settings, so a user who wants to e.g. log them or talk to the gateway directly via `fetch` has no documented path.

### API ergonomics — `encryptInput`

- The PRD's shorthand `encryptInput(42)` is misleading; the actual signature is `encryptInput(value, solidityType, applicationContract)`. This is documented clearly on the methods page and is the correct shape — the PRD just paraphrased.
- **Positive:** `solidityType` as a literal string union (`'uint256' | 'uint16' | 'int256' | 'int16' | 'bool'`) is more JS-idiomatic than the `externalEuint64`/`externalEbool` zoo from the FHEVM ecosystem. JS-side authors don't have to think in encrypted-typed enums.
- **Constraint to flag:** `bytes32` and arbitrary `bytesN` are not in the supported `SolidityType` list. For markets we will need at minimum `uint64`, ideally `uint128` for cumulative pool accumulators. We pinned the health check on `uint256` (the largest documented type) so this isn't a blocker today, but the F2/F3 contracts may have to widen-then-narrow if they were to use `uint64`. Worth checking whether `uint64` is actually unsupported or just undocumented.
- **Constraint to flag:** the handle is bound to a specific `applicationContract`. For the health check we bound it to the EOA — fine for an SDK round-trip — but it means _any_ schema where one contract creates handles and another contract consumes them needs explicit ACL grants. The doc page should call this out more loudly.

### API ergonomics — `decrypt`

- `decrypt` is **gasless** (the doc explicitly says EIP-712 signature, no on-chain tx). This was the single most important confirmation for the P0 gate, because it means the health check does NOT need a funded wallet — we generate a fresh ephemeral key per run. Excellent DX.
- Return shape `{ value, solidityType }` with `value` typed as `boolean | string | bigint` is correct but slightly unergonomic: the consumer has to widen-narrow the discriminated union by branching on `solidityType`. A generic `decrypt<T extends SolidityType>(handle, expectedType: T): { value: SolidityValue<T> }` would be cleaner.

### API ergonomics — `viewACL`

- Clean, exactly the right shape: `{ isPublic, admins, viewers }`. No friction.
- Suggestion: include `granters` (the EOA that originally created the handle / granted access) in the response. Today there is no documented way to ask "who created this handle?" off-chain.

### Latency observations

**First run (PRD v1.1 gate, RED — kept for context):** 2026-04-25 against `https://sepolia-rollup.arbitrum.io/rpc`, `@iexec-nox/handle@0.1.0-beta.10`, ephemeral key, value `42n` as `uint256`:

| step    | status | latency |
| ------- | ------ | ------- |
| rpc     | PASS   | 654ms   |
| client  | PASS   | 279ms   |
| encrypt | PASS   | 1606ms  |
| decrypt | FAIL   | 567ms   |

Total to RED: 3106ms. Decrypt failure was structural (see BUG_LOG entry "decrypt fails because handle was never committed on-chain"), not transient.

**Retry (PRD v1.2 gate, GREEN):** same setup, ephemeral key per run, value `42n` as `uint256`:

| step     | status | latency |
| -------- | ------ | ------- |
| rpc      | PASS   | 666ms   |
| client   | PASS   | 296ms   |
| encrypt  | PASS   | 1048ms  |
| nox-code | PASS   | 271ms   |
| subgraph | PASS   | 771ms   |

Total: 3052ms. The encrypt round-trip improved from 1606ms → 1048ms across the two runs (no code change in between, so attribute to gateway-side variance / cold-cache effects on the first run).

`createViemHandleClient` reliably costs ~280–300ms — this is real and worth noting. We instrumented it as a discrete step rather than folding it into "setup time" because users who construct a client per request would feel that.

### What the GREEN run proves

- Arbitrum Sepolia RPC is reachable and returns the expected chainId.
- The `@iexec-nox/handle` Viem factory constructs cleanly against a fresh ephemeral EOA, no funding required.
- The Nox Handle Gateway accepts EIP-712-authenticated `/v0/secrets` POSTs and returns well-formed handles. The handle's bytes 1–4 decode to chainId `0x66eee` (421614), matching the SDK's `handleToChainId` layout (`utils/types.ts:293-299`) — we validate this in the script.
- The Nox protocol contract at `0xd464B198f06756a1d00be223634b85E0a731c229` has on-chain bytecode (180 hex chars / 89 bytes — consistent with an EIP-1167 minimal proxy or similar small router; either way, **deployed and reachable**).
- The Nox subgraph at `thegraph.arbitrum-sepolia-testnet.noxprotocol.io` responds to GraphQL introspection with `queryType.name = "Query"` — the indexer that powers `viewACL` is alive.

### What this run does NOT prove

The full encrypt → decrypt round-trip. That is intentional and correct per the v1.2 gate redesign: decrypt requires the handle's bound `applicationContract` to have called `fromExternal(handle, proof)` on-chain, and we have no contract deployed yet. Phase F2's `ConfidentialUSDC.wrap()` will be the first place this round-trip naturally exercises end-to-end.

### Observations from the v1.2 gate steps

**`nox-code` step.** The Nox protocol contract on Arb Sepolia is a _small_ contract — 89 bytes of bytecode. This is either a minimal proxy (EIP-1167 = 45 bytes, so 89 is slightly larger but in the same family) or a small router. The implementation it delegates to is invisible from `eth_getCode`. For our infra-reachability gate this is sufficient — bytecode > 2 means the address is not an EOA / not a `selfdestruct` casualty. But integrators trying to verify "the right contract is here" cannot do so via bytecode alone; they would need to make a `read` call against an expected interface. A documented `getVersion()` or `getProtocolMetadata()` view function would be a very small DX upgrade.

**`subgraph` step.** The introspection query `{ __schema { queryType { name } } }` returns 200 in ~770ms cold. That's slower than a typical hosted subgraph but acceptable. Worth flagging that the Nox subgraph URL embeds a deployment-id (`BjQAX2HpmsSAzURJimKDhjZZnkSJtaczA8RPumggrStb`) — these change when subgraphs are redeployed, which is why pinning the URL is fragile. See DRIFT_LOG.

### DX implications surfaced by this gate

1. **Network config introspection is missing.** The SDK has no public way to ask "what gateway / contract / subgraph URL does the auto-config use for chain X?". Internal `NETWORK_CONFIGS` and `resolveNetworkConfig` are not exported. We had to source-inspect `src/config/networks.ts` to get the values for the `nox-code` and `subgraph` steps. Suggestion: export `getNetworkConfig(chainId): { gatewayUrl, smartContractAddress, subgraphUrl }` (or expose it on the `HandleClient` instance) so consumers can drive infra checks programmatically without source diving. This also future-proofs against the SDK changing addresses behind the consumer's back.

2. **Documentation gap on the handle lifecycle (still the most important).** The cleanest single-line addition that would prevent every new integrator from hitting the v1.1 P0 wall:

   > "**A handle's ACL lives on-chain.** `encryptInput` writes ciphertext to the gateway and returns a binding proof, but the handle is not authorized for `decrypt` or `viewACL` until your `applicationContract` consumes the proof on-chain via `fromExternal()`."

3. **Ship a public test-committer contract.** A tiny pre-deployed contract on Arb Sepolia whose only job is `function commit(bytes32 handle, bytes proof) external { Nox.fromExternal(handle, proof); }` would unblock SDK-only hello-worlds without forcing every integrator to deploy Solidity. Today, the documented quickstart sets you up to call `decrypt` two pages later — and that call cannot succeed without infrastructure the quickstart doesn't tell you to build.

4. **Subgraph URL durability.** Pinning the subgraph URL by deployment-id means upstream redeploys will break consumers. A stable alias (subgraph `name` in The Graph studio) would be safer for the SDK's auto-config.

### DX gaps worth raising upstream

1. No stable release. Beta-only SDKs in challenge-grade documentation force every project's `package.json` to pin a beta tag. A `0.1.0` proper would unblock standard `latest` resolution.
2. The peer-dep warning for `ethers` on a Viem-only consumer is noisy and avoidable.
3. `createViemHandleClient` returns a Promise (it's `await`-ed in the docs), but the docs never explicitly state _why_ — does it perform a network round-trip during construction, or is it just future-proofing? A one-line note would prevent users from putting it inside a hot loop.
4. There is no documented way to introspect the gateway URL, contract address, and subgraph URL that the auto-configured Arbitrum Sepolia client uses. Useful for debugging and for writing fallback fetches.
5. No documented retry/back-off policy for the gateway. If `encryptInput` 503s under load, what's the expected client behavior?

### Comparisons with adjacent confidential-compute SDKs

- **vs. fhevmjs (Zama):** Zama's SDK exposes `createInstance({ chainId, publicKey })` synchronously and lets you encrypt without a wallet. Nox requires a wallet client up-front because the EIP-712 signature is part of the encrypt path. Nox's choice is sound for the ACL-grant model but worth flagging: simple "encrypt for public consumption" use cases are over-engineered if you don't need ACL.
- **vs. Inco/Lit ACL primitives:** Nox `viewACL` returning a flat `{ admins, viewers }` is simpler than Lit's condition-based access control. For our DarkOdds use case (per-user grant, no condition trees) this is the right shape.

---

## What worked

- Package install was uneventful (after pinning the beta).
- The `getting-started` snippet copy-pastes into a working client.
- `decrypt` being gasless made the health check trivially robust — no faucet step, no halt-on-empty-balance branch.

## What didn't

- The PRD v1.1 `encryptInput(42)` paraphrase doesn't match the real 3-arg signature. Verified against docs and reconciled.
- npm `latest` for `@iexec-nox/handle` points at a beta. This is not the SDK's fault but it is a real install-time hazard.
- The PRD v1.1 §11 P0 gate was structurally impossible against this SDK — see BUG_LOG. The operator's v1.2 PRD revision (path 1 from the previous BUG_LOG) redefined the gate to validate infrastructure reachability (RPC, gateway, contract bytecode, subgraph) instead of demanding an off-chain decrypt round-trip. **Retry under v1.2 gate landed at GREEN.**
- SDK does not expose its network-config map. Had to source-inspect `src/config/networks.ts` to drive the `nox-code` and `subgraph` steps.

---

## Phase F1 — monorepo skeleton

### Setup choices

- **pnpm workspaces:** `web` + `subgraph` only. `contracts/` is a Foundry project, not a Node workspace — Foundry has its own dep system via `forge install` (git submodules under the parent darkodds repo via `--use-parent-git`). See DRIFT_LOG.
- **Foundry 1.6.0**, Solidity 0.8.34 (latest stable in 0.8.x line per release feed), forge-std 1.16.0, OpenZeppelin Contracts 5.6.1, OpenZeppelin Confidential Contracts 0.4.0.
- **Next.js 16.2.4** (latest stable; `dist-tags.latest`), Tailwind v4.2.4, React 19.2.4, TypeScript 5.9.3, ESLint 9.39.4 (see DRIFT_LOG re: 10 vs 9). Exact pins on every dep — no carets, no tildes.
- **Local fonts** at `web/public/fonts/`: Geist-Variable.woff2 (69 KB), GeistMono-Variable.woff2 (72 KB), Fraunces-Variable.woff2 (67 KB, latin subset), SpecialElite-Regular.woff2 (53 KB). All wired via `@font-face` in `globals.css`. Zero usage of `next/font/google`.

### What worked

- `forge install OpenZeppelin/openzeppelin-confidential-contracts@v0.4.0` resolved cleanly — official tagged release, no special remappings beyond what `remappings.txt` already pins.
- `create-next-app@16.2.4` with `--use-pnpm --skip-install --disable-git --yes` was zero-friction for the basic scaffold.
- The P0 healthcheck survived the move with no code changes — `pnpm install` from cold + `pnpm healthcheck` returns the same five-step GREEN.
- Tailwind v4's `@theme inline` directive made it natural to bridge PRD §7.1 CSS variables into Tailwind utilities (`var(--bg)` → `bg-bg`) without a JS config duplicate.

### What was friction

1. **`forge init` flag drift.** Foundry 1.6 has `--commit` (opt-in) and `--no-git` but does NOT have `--no-commit`. The PRD prompt asked for `--no-commit --no-git`; the actual fix was `--use-parent-git` so `contracts/` participates in the parent darkodds git tree without spawning a nested repo. Logged in DRIFT_LOG.

2. **`create-next-app` injects assumptions.** It writes `pnpm-workspace.yaml` _inside_ `web/` even when the parent already has one (had to delete), drops a `CLAUDE.md`, an `AGENTS.md`, and its own `README.md` under `web/`, and uses `next/font/google` in the generated `app/layout.tsx`. None of these are configurable away — you scaffold and then prune. Worth flagging that the "agents-md" default landed in 16.2 quietly.

3. **`shadcn init` is the biggest DX trap and the most worth documenting.** When run with `--defaults`, shadcn 4.4.0:
   - Re-injects `next/font/google` into `app/layout.tsx`, which directly violates our "no Google Fonts CDN — local woff2 only" rule. This was particularly insidious because it overrode the layout we'd just written.
   - Imports `tw-animate-css` and `shadcn/tailwind.css` into `globals.css`, polluting it with ~40 oklch tokens we don't use, a `--radius: 0.625rem` default (we want 0), and a `.dark` class block that competes with our `[data-theme="dark"]` selector.
   - Adds 7 runtime deps with caret ranges, including `shadcn` itself listed as a `dependencies` (not `devDependencies`) entry.
   - Writes `components/ui/button.tsx` ahead of the design pass.

   We reconciled by undoing all of the above and keeping only `components.json` as a zero-cost marker so `shadcn add <component>` remains a one-command path if F6 decides to use any specific shadcn primitive. **Suggestion to shadcn:** offer a `--minimal` or `--config-only` mode that writes `components.json` and nothing else, leaving the `globals.css`, `layout.tsx`, and dep-installation untouched. The current `--defaults` path is opinionated to a degree that fights any project with strong existing design conventions.

4. **eslint version peer-dep cap.** `eslint-config-next@16.2.4` peer-deps are bounded at `^9` for `eslint-plugin-import`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react`. Installing eslint 10 (the actual `dist-tags.latest`) produced three peer-warnings; pinned to 9.39.4 (latest 9.x, npm `dist-tags.maintenance`) to satisfy. Track upstream for a 10-compatible release of next's eslint plugins.

5. **Foundry `assertEq(1+1, 2)` ambiguity.** Solidity 0.8.34 + forge-std 1.16.0 cannot resolve the overload because `1` is an `int_const` and the function has bool/uint256/int256/address/bytes32/string/bytes overloads. Tiny papercut — `assertEq(uint256(1) + uint256(1), uint256(2))` works. Worth a one-line note in forge-std's quickstart.

### Latency observations (for reference)

- Cold `pnpm install` across the new workspace: 20.5s first run, 14s second run (after eslint pin fix).
- `pnpm healthcheck`: 4096ms total, all 5 steps PASS — same as P0-retry latency profile.
- `pnpm test:contracts`: forge compile 672ms (cold) / 0ms (cached), test 7.95ms, total well under 1s.
- `pnpm typecheck`: ~1s combined for `tools/` + `web/`.
- `pnpm dev:web`: `▲ Next.js 16.2.4 (Turbopack)`, `Ready in 262ms`. `GET / 200` in 2.2s on first request.

### DX implications worth raising upstream

1. **shadcn init defaults are too opinionated for projects with strong design rules.** A `--config-only` mode would solve this cleanly.
2. **`create-next-app` should respect existing `pnpm-workspace.yaml` in the parent.** Today it writes one in the new app's directory regardless.
3. **Foundry's `forge init` flag changes between minor versions** (e.g. removing `--no-commit`) need a deprecation note in release notes. We caught it via `--help`; users with stale tutorials would hit a hard error.
4. **OpenZeppelin Confidential Contracts v0.4.0** install was uneventful. The library is small (47 objects in the install) and pre-dated the Nox SDK rename; remappings worked first try with `@openzeppelin/contracts-confidential/=lib/openzeppelin-confidential-contracts/contracts/`.
