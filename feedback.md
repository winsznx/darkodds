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

---

## Phase F2 — ConfidentialUSDC live on Arbitrum Sepolia

### Deployment

| Contract                           | Address                                                                                                                        | Verified    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| TestUSDC                           | [`0xf02C982D19184c11b86BC34672441C45fBF0f93E`](https://sepolia.arbiscan.io/address/0xf02c982d19184c11b86bc34672441c45fbf0f93e) | ✅ Arbiscan |
| ConfidentialUSDC                   | [`0xf9f3A9F5F3a2F4138FB680D5cDfa635FD4312372`](https://sepolia.arbiscan.io/address/0xf9f3a9f5f3a2f4138fb680d5cdfa635fd4312372) | ✅ Arbiscan |
| Nox protocol (iExec, pre-existing) | `0xd464B198f06756a1d00be223634b85E0a731c229`                                                                                   | n/a         |

Smoke wrap tx: [`0x27b7b4a6...8365bf`](https://sepolia.arbiscan.io/tx/0x27b7b4a6abc3912ed30f2f57492997518d457da72e73ba723535de0fbd8365bf).

### Smoke run — wrap → decrypt round-trip

| step                       | latency     |
| -------------------------- | ----------- |
| load deployment json       | 0ms         |
| ETH balance check          | 241ms       |
| TestUSDC.mint              | 2486ms      |
| TestUSDC.approve           | 2601ms      |
| Nox encryptInput           | 1930ms      |
| ConfidentialUSDC.wrap      | 2180ms      |
| read confidentialBalanceOf | 240ms       |
| Nox decrypt                | 1164ms      |
| **total round-trip**       | **11441ms** |

Decrypted balance was `100_000_000` (= 100 tUSDC at 6 decimals), matching the deposit exactly. **First decrypt that ever succeeded in the project's lifetime** — proves the Nox-native architecture works end-to-end.

### Architecture: Nox-native, NOT inheriting OpenZeppelin Confidential Contracts

Single biggest decision in F2. OZCC v0.4.0 imports `@fhevm/solidity/lib/FHE.sol` throughout — every wrapper is built for Zama FHEVM, not Nox. Inheriting it would have deployed a contract bound to FHEVM's on-chain ACL, disconnected from the Nox foundation we already validated in P0.

We built directly on `@iexec-nox/nox-protocol-contracts@0.2.2` using the `Nox` SDK library. Result: **the first published Nox-native ERC-7984-shape ERC-20 wrapper.** Closest reference iExec ships is `ConfidentialTokenMock.sol` (a non-wrapper token).

**Suggestion to OpenZeppelin / iExec:** ship a Nox-flavored fork of `ERC7984ERC20Wrapper`. The OZ FHEVM equivalent exists; the absence of a Nox version forces every Nox prediction-market / private-DeFi project to author its own wrap pattern.

### What worked beautifully in `@iexec-nox/nox-protocol-contracts`

1. **`TestHelper.deploy(owner, gateway)`.** vm.etches the real `NoxCompute` proxy bytecode at the chain-resolved address for local chain 31337. Our 28 unit tests run against the **exact same on-chain logic** that lives at `0xd464...` on Arb Sepolia — not a hand-rolled mock. **Saved us writing a custom `MockNox.sol`** (originally a F2 prompt deliverable). Excellent DX.

2. **`TestHelper.buildInputProof(...)` + `buildDecryptionProof(...)`.** Generate valid EIP-712 gateway proofs in tests. Lets us exercise the full proof-validation path (`InvalidProof("App mismatch")`, `Owner mismatch`, `Proof expired`) without hand-rolling EIP-712 signing.

3. **`Nox.mint(balance, amount, totalSupply)` atomic primitive.** Returns `(success, newBalance, newSupply)` in a single TEE call. Cleaner than the iExec mock's `_update` (which does manual `safeAdd` + supply update). We use mint/burn for both wrap and unwrap.

4. **`isPubliclyDecryptable(handle)` + `validateDecryptionProof(handle, proof)`.** Lets us implement the OZ FHEVM 2-tx unwrap (request → finalize) using only Nox primitives. The success-bool ebool from `Nox.burn` becomes the request id.

### What was friction in `@iexec-nox/nox-protocol-contracts`

1. **No published wrapped-ERC20 reference.** Deep source-evidence search confirmed: nothing in iExec-Nox's GitHub org wraps a plaintext ERC-20 into a confidential token. Closest is `ConfidentialTokenMock.sol`, which is a from-scratch token, not a wrapper. We're authoring the canonical pattern.

2. **`forge-std/src/Vm.sol` import path in TestHelper.** iExec's TestHelper imports `forge-std/src/Vm.sol` (with `src/` prefix). Standard Foundry remapping `forge-std/=lib/forge-std/src/` resolves this to `lib/forge-std/src/src/Vm.sol` — wrong. Foundry deduplicates same-target remappings, so listing both `forge-std/=...` and `forge-std/src/=...` collapses. Workaround: contextual remapping `lib/nox-protocol-contracts/:forge-std/src/=lib/forge-std/src/`. Compiles fine but logs noisy `[ERROR]` on every build before the contextual fallback succeeds. **Suggestion:** TestHelper should import `forge-std/Vm.sol` (the conventional path).

3. **License boundary fragility.** `sdk/Nox.sol`, `interfaces/INoxCompute.sol`, `shared/*` are MIT — safe to import in production. Everything else (the `NoxCompute.sol` implementation, all mocks) is BUSL-1.1. The boundary is correct but easy to mis-cross. **Suggestion:** document this loudly in the README.

4. **`encryptInput` solidityType menu is constrained.** Nox SDK supports `bool`, `uint16`, `uint256`, `int16`, `int256`. No `uint64` or `uint128`. For F3 pool accumulators we'll be using `uint256` because it's the only large-enough option. Would benefit from `uint128` (bet sizes never need 256 bits) and `uint64` (gas-cheaper for small counters).

### What was friction at the Foundry 1.6 / Arbitrum RPC interop layer

5. **`forge script` and `forge create` both fail against the public Arb Sepolia RPC** with `deserialization error: missing field timestampMillis`. Foundry 1.6.0's alloy expects `timestampMillis` in `eth_getBlockByNumber` responses, which Arbitrum's RPC doesn't return. Workaround: deploy via viem in `tools/deploy-f2.ts`. We retain `DeployF2.s.sol` for documentation. **Suggestion to Foundry:** make `timestampMillis` optional in alloy's block deserialization (it's an Alchemy-flavored extension, not a core EIP field).

6. **`forge verify-contract` requires `ETHERSCAN_API_KEY` env var even for Blockscout.** Workaround: set it to any non-empty string. **Suggestion:** make the env var optional when `--verifier blockscout` is used.

7. **Public Arb Sepolia RPC is non-archive.** `forge test --fork-url ... --fork-block-number 0` fails with `missing trie node`. Workaround: pin the fork to current head (resolved via `eth_blockNumber` at run time). Documented in `pnpm test:contracts:fork`.

8. **Arbiscan migrated to Etherscan V2 API.** Old V1 endpoint (`https://api-sepolia.arbiscan.io/api`) returns "deprecated, switch to V2". V2 endpoint is `https://api.etherscan.io/v2/api?chainid=421614` with the unified Etherscan API key. Worked first try once switched.

### Test coverage

`forge coverage` on `src/`:

| File                 | Lines      | Statements | Branches   | Funcs      |
| -------------------- | ---------- | ---------- | ---------- | ---------- |
| ConfidentialUSDC.sol | 94.79%     | 93.68%     | 75.00%     | 92.86%     |
| TestUSDC.sol         | 100.00%    | 100.00%    | n/a        | 100.00%    |
| **Total**            | **95.00%** | **93.81%** | **75.00%** | **93.75%** |

Above the PRD's ≥85% bar on lines/statements/functions. 28 unit tests + 1 fork test pass; fuzz on `wrap` runs 256 iterations across `uint128` deposits with no failures.

### Suggestions to iExec (prioritized)

1. **Ship `ERC7984ERC20Wrapper` for Nox** in `@iexec-nox/nox-protocol-contracts/contracts/extensions/`. The OZ FHEVM equivalent exists; the Nox version doesn't. Every Nox prediction-market / private-DeFi project will eventually want this — and absent a canonical reference, every project will design slightly differently and get the ACL details slightly wrong.
2. **Update `ConfidentialTokenMock._update` to use `Nox.mint`/`Nox.burn`** atomic primitives instead of manual `safeAdd`/`safeSub` + supply update. Demonstrates the canonical token pattern.
3. **Fix `TestHelper.sol` import path** from `forge-std/src/Vm.sol` to `forge-std/Vm.sol`.
4. **Document the license boundary** loudly. Easy mistake to import from `mock/` thinking it's safe for production.
5. **Wider `encryptInput` solidityType menu** — at minimum `uint64` and `uint128`.

---

## Phase F3 — Market core live on Arbitrum Sepolia

### Deployment

| Contract                                | Address                                                                                                                        | Verified                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| TestUSDC (reused from F2)               | [`0xf02C982D19184c11b86BC34672441C45fBF0f93E`](https://sepolia.arbiscan.io/address/0xf02c982d19184c11b86bc34672441c45fbf0f93e) | ✅                        |
| ConfidentialUSDC v2 (operator pattern)  | [`0xaF1ACDf0B031080D4fAd75129E74d89eaD450c4D`](https://sepolia.arbiscan.io/address/0xaf1acdf0b031080d4fad75129e74d89ead450c4d) | ✅                        |
| Market implementation                   | [`0x8F16021bf370eCA1Bd94210a318416b9116F0a2E`](https://sepolia.arbiscan.io/address/0x8f16021bf370eca1bd94210a318416b9116f0a2e) | ✅                        |
| MarketRegistry                          | [`0xeC13c614f817A97462ca669473f28A3E6aAcaAFB`](https://sepolia.arbiscan.io/address/0xec13c614f817a97462ca669473f28a3e6aacaafb) | ✅                        |
| Market[0] (test market, EIP-1167 clone) | [`0x60A1E4f30B02E78c0DC9bD28Ac468052dA01279E`](https://sepolia.arbiscan.io/address/0x60a1e4f30b02e78c0dc9bd28ac468052da01279e) | ✅ (auto, bytecode match) |

Market[0] question: "Will the next iExec mainnet announcement happen before June 15, 2026?" — admin-resolved, expires +14d.

### Smoke run — bet → batch → publish round-trip

| step                                      | latency     |
| ----------------------------------------- | ----------- |
| load deployment json                      | 0ms         |
| ETH balance                               | 281ms       |
| TestUSDC.mint                             | 3435ms      |
| TestUSDC.approve                          | 2671ms      |
| Nox encryptInput (wrap)                   | 1754ms      |
| ConfidentialUSDC.wrap                     | 2909ms      |
| cUSDC.setOperator                         | 2874ms      |
| Nox encryptInput (bet)                    | 1349ms      |
| Market.placeBet                           | 2694ms      |
| **wait 60s batch interval**               | **65002ms** |
| Market.publishBatch                       | 3073ms      |
| Nox publicDecrypt(yesPoolPublishedHandle) | 1750ms      |
| Nox decrypt(yesBet[user])                 | 1150ms      |
| **total**                                 | **89661ms** |

`yesPoolPublishedHandle` decrypted publicly to **`50_000_000`** (the bet, in 6-decimal tUSDC units). `yesBet[user]` decrypted to the same value via the user's persistent ACL. Both handles are different bytes32 — the user's bet handle is the original from `encryptInput`, while the public total is a fresh `Nox.add` result.

### Architecture: lazy public decryption (PRD §6.2) is real

The privacy primitive — bets accumulate in TEE-only batch handles, public running totals only update every 60s — is not just spec poetry, it's implemented and verified end-to-end:

- `_yesPoolBatch` / `_noPoolBatch`: encrypted accumulators, ACL'd to Market only. `Nox.add(batch, bet)` per `placeBet`.
- `_yesPoolPublished` / `_noPoolPublished`: encrypted running totals, made publicly decryptable on every `publishBatch`. The public's view of pool sizes lags individual bets by up to 60 seconds.
- `BatchPublished(batchId, betsInBatch, timestamp)` event: count revealed, sizes never. Selective disclosure in action.

### What worked beautifully in `@iexec-nox/nox-protocol-contracts` (continued from F2)

1. **`Nox.add` preserves ACL inheritance.** Adding a public handle (initial zero) to a private handle (the bet amount) returns a private handle. After enough bets in a batch, the running batch handle is private. `publishBatch` then folds it into the public total via another `Nox.add`. Behavior was intuitive once we traced it.
2. **`HandleUtils.isPublicHandle` is the right abstraction.** Lets the contract conditionally call `allowPublicDecryption` only when the handle is actually private — clean defensive guard against `PublicHandleACLForbidden` reverts.
3. **EIP-1167 minimal proxies + Nox handles compose without surprises.** Each cloned Market has its own storage slots for encrypted handles; the `applicationContract` field in handle proofs binds correctly to the clone's address (not the implementation's). `Nox.allowThis` inside an initialized clone grants ACL to the clone.

### What was friction in `@iexec-nox/nox-protocol-contracts` (F3-specific)

1. **Cross-contract handle ACL is silent.** When Market calls `cUSDC.confidentialTransferFrom(user, market, betHandle)`, cUSDC's internal `Nox.safeSub(userBalance, betHandle)` reverts with `NotAllowed(betHandle, cUSDC)` — even though Market had transient ACL on `betHandle` from the upstream `Nox.fromExternal` call. The reason: NoxCompute's ACL check uses `msg.sender` from _its own_ call frame, which is cUSDC during the inner safeSub, not Market. The fix is `Nox.allowTransient(betHandle, address(cUSDC))` before delegating. **Suggestion:** the Nox docs should explicitly cover the cross-contract handle-passing pattern with a code snippet — every multi-contract dApp on Nox will hit this.
2. **`allowPublicDecryption` reverts on already-public handles.** `Nox.toEuint256(0)` produces a public-by-construction handle (per `wrapAsPublicHandle` semantics — see F2 librarian research). Calling `allowPublicDecryption` on it throws `PublicHandleACLForbidden`. The Nox SDK already has `_allowIfNotPublic` (silent skip on public for `allow` / `allowThis` / `allowTransient`); a parallel `_allowPublicDecryptionIfNotPublic` would be a one-line addition that makes initialization patterns trivial. **Suggestion:** add it.
3. **EIP-7984 operator surface absent from `ConfidentialTokenMock`.** iExec's reference token doesn't include `setOperator` / `confidentialTransferFrom`. Anyone building a real DeFi integration over Nox will need this and will roll their own. We added it to our cUSDC; would be cleaner upstream. **Suggestion:** include the operator pattern in the next iExec reference token.

### Test coverage

`forge coverage` on `src/`:

| File                 | Lines      | Statements | Branches   | Funcs      |
| -------------------- | ---------- | ---------- | ---------- | ---------- |
| ConfidentialUSDC.sol | 94.64%     | 93.91%     | 75.00%     | 94.44%     |
| Market.sol           | 97.22%     | 95.65%     | 82.61%     | 94.12%     |
| MarketRegistry.sol   | 100.00%    | 100.00%    | 100.00%    | 100.00%    |
| TestUSDC.sol         | 100.00%    | 100.00%    | n/a        | 100.00%    |
| **Total**            | **91.02%** | **88.85%** | **81.40%** | **92.68%** |

40/40 local tests + 2/2 fork tests pass. All four files clear the PRD's ≥85% bar on lines/statements/funcs.

### MarketRegistry clone pattern: did handle-rebinding cause friction?

No. EIP-1167 minimal proxies delegate every call to the implementation, including the storage slot writes for encrypted handles. Each clone gets its own storage. The `applicationContract` field encoded in Nox handle proofs is always the clone's address (since `msg.sender` during `Nox.fromExternal` is the clone, not the implementation). All ACL grants and proof validations are clone-scoped.

The only initialization quirk: the Market template itself is initialised once during deploy (in our `Market.t.sol::test_Initialize_RawImplCanBeInitialized` test), which means a second call to `initialize` on the implementation reverts. This is fine — the implementation is never used as a proxy target by users. The clones are.

### Encrypted-types arithmetic ergonomics from Solidity

Adding two encrypted values is `Nox.add(handleA, handleB)` — looks like a regular library call, returns a new handle. Subtraction with the success bool is `Nox.safeSub(...)` returning `(ebool, euint256)`. Multiplication, comparison, conditional select — all single-line library calls.

The only meaningful friction is mental: every TEE-output handle needs an explicit `Nox.allowThis(handle)` to keep using it later. Forgetting this leads to `NotAllowed` reverts on the next op. It's the encrypted-state equivalent of forgetting to free memory in C — annoying but learnable. Once the pattern is internalised, the code reads cleanly.

The `confidentialTransferFrom` DX is identical to plain ERC-20 `transferFrom` modulo the encrypted amount handle — operator approval is a one-shot `setOperator(spender, until)` call (timestamp-based) instead of per-amount `approve`. We prefer this; it's cleaner for repeated bets in the same market session.

---

## Phase F4 — Resolution + Claim live on Arbitrum Sepolia

### Deployment

| Contract                                               | Address                                                                                             | Verified |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------- |
| Market implementation v2                               | [`0x297ddb...b8c4`](https://sepolia.arbiscan.io/address/0x297ddb129f87b37e4b28cd1c1c6457ed0c7bb8c4) | ✅       |
| MarketRegistry v2                                      | [`0xe66b2f...6dd1`](https://sepolia.arbiscan.io/address/0xe66b2f638f5db738243a44f7aeb1cccc18906dd1) | ✅       |
| ResolutionOracle                                       | [`0x27dc55...b96c`](https://sepolia.arbiscan.io/address/0x27dc556b9e6c1a031bd779e9524936f70b66b96c) | ✅       |
| AdminOracle                                            | [`0x96b6ec...103f`](https://sepolia.arbiscan.io/address/0x96b6ecc138a231ddff9e8ea856fb8869b4be103f) | ✅       |
| PreResolvedOracle                                      | [`0x76147d...c893`](https://sepolia.arbiscan.io/address/0x76147d3c1e241b4bb746002763991789661cc893) | ✅       |
| ChainlinkPriceOracle (mainnet-ready, testnet-no-feeds) | [`0x316dc9...3cb2`](https://sepolia.arbiscan.io/address/0x316dc924697406af553c7276c285b11b83cc3cb2) | ✅       |
| ClaimVerifier (placeholder TDX)                        | [`0x5cc497...b82a`](https://sepolia.arbiscan.io/address/0x5cc49763703656fec4be672e254f7f024de2b82a) | ✅       |
| FeeVault                                               | [`0x4fc729...a351`](https://sepolia.arbiscan.io/address/0x4fc729a98824bf2e6da4bba903ead73432afa351) | ✅       |
| Market[1] (admin-resolved, +14d)                       | [`0x98ae59...53f7`](https://sepolia.arbiscan.io/address/0x98ae591d6d5f31fc6840d9124e58963cc2ec53f7) | ✅       |
| Market[2] (pre-resolved YES)                           | [`0xec3b47...3297`](https://sepolia.arbiscan.io/address/0xec3b47c7eaaf601a32cdfde37aa078ebbc1c3297) | ✅       |

### Smoke run — two full lifecycles, ~4:48 min total

**Lifecycle A** — PreResolved YES, full claim path:

| step                                            | latency    |
| ----------------------------------------------- | ---------- |
| deploy fresh PreOracle (smoke isolation)        | 3239ms     |
| mint + approve + wrap A + wrap B                | 14.2s      |
| create market + configure adapter + setOperator | 9.6s       |
| encryptInput + placeBet                         | 3.5s       |
| **wait 65s batch interval**                     | 65s        |
| publishBatch                                    | 2.7s       |
| **wait 13s for market expiry**                  | 13.3s      |
| resolveOracle (state → Resolving)               | 3.0s       |
| publicDecrypt YES pool = 50_000_000 ✓           | 5.0s       |
| freezePool (state → ClaimWindow)                | (in above) |
| **wait 61s claim-open delay**                   | 61.3s      |
| claimWinnings → hasClaimed = true ✓             | 4.6s       |

**Lifecycle B** — PreResolved INVALID, refund path:

| step                                          | latency |
| --------------------------------------------- | ------- |
| create market + configure + setOperator + bet | 11.6s   |
| **wait 82s for market expiry**                | 82.3s   |
| resolveOracle (state → Invalid)               | 3.1s    |
| refundIfInvalid → yesBet handle cleared ✓     | 3.3s    |

Total: 287519ms (~4:48). 219s of that is mandatory privacy-primitive waits (60s batch + 13s + 61s + 82s).

### What worked beautifully

1. **The lazy public decryption pattern composed cleanly with resolution.** `freezePool(yesProof, noProof)` consumes off-chain `publicDecrypt` proofs that the smoke test fetches from the Nox gateway in real-time. The proofs are gateway-signed EIP-712 over `keccak256(handle, plaintext)`; `Nox.publicDecrypt` validates them on-chain. Nice clean handoff between off-chain decryption and on-chain plaintext snapshot. No TEE handler involvement needed at this stage — F5 will do the proportional payout math with the same primitives.

2. **`AdminOracle` commit-reveal** on top of `IResolutionAdapter` is a 30-line addition that makes the orchestrator MEV-safe without complicating Market.sol. Market just calls `oracle.resolve()`; commit-reveal is an adapter-internal concern.

3. **EIP-1167 clones survived the resolveOracle/claim/refund extension** without storage layout migrations. The new state fields (`yesPoolFrozen`, `noPoolFrozen`, `resolutionTs`, `poolFrozenTs`, `claimWindowOpensAt`, `resolutionOracle`) appended cleanly. Proof: the deploy spec's "old Market[0] still works for placeBet/publishBatch but its F4 surface reverts PhaseNotImplemented" is exactly right; the clone delegatecalls into the OLD implementation which has the F3 layout and stub reverts.

4. **`Nox.allowTransient` cross-contract pattern** ported from F3 to refundIfInvalid without surprises. Same idiom: market grants cUSDC transient ACL on the bet handle before delegating `confidentialTransfer`.

### What was friction (Chainlink + Arbitrum Sepolia)

The big one: **Chainlink has no data feeds on Arb Sepolia.** Verified against `smartcontractkit/hardhat-chainlink`'s authoritative registry. The PRD's BTC/USD aggregator address `0x942d00...` is mainnet (Arbitrum One); using it on testnet would either revert (no contract) or silently read stale/wrong data. There's also no L2 sequencer uptime feed on Sepolia ([Issue #10699](https://github.com/smartcontractkit/chainlink/issues/10699) requesting it has been open since Sept 2023, status `investigating`).

Practical impact: the Chainlink-resolved demo market gets dropped from testnet per PRD §0.5 ("if something can't be live, the demo skips it — never fakes it"). `ChainlinkPriceOracle.sol` ships to spec, deploys for audit visibility, but isn't wired into any market on testnet. Production deployment on Arb mainnet would use the real BTC/USD feed (`0x6ce185860a4963106506C203335A2910413708e9` proxy) + the real sequencer feed (`0xFdB631F5EE196F0ed6FAa767959853A9F217697D`).

**Suggestion to Chainlink:** the absence of testnet feeds blocks every L2 prediction-market / DeFi project from doing realistic testnet integration. A minimal subset (BTC/USD + ETH/USD + sequencer uptime) on Arb Sepolia would unblock a lot of projects.

### Friction in our own design — caught + fixed

1. **The deploy script's market-id labeling drifted off-by-one.** I labeled them `Market_1` and `Market_2` in the deployments JSON but their actual `Market.id()` values are 0 and 1 (the new MarketRegistry counter starts at 0). Then the deploy's `PreResolvedOracle.configure(2, 1)` registered a phantom configuration for a market id that didn't exist. The smoke test then tried to configure id=2 (its first-created fresh market) and reverted `AlreadyConfigured`. Fixed by having the smoke deploy a fresh PreResolvedOracle of its own to avoid the phantom-config conflict. Also a lesson: **always cross-check label-vs-id alignment when a registry assigns ids by counter.** Better deploy scripts would assert `id == expected`.

2. **viem nonce race on rapid-fire writeContract.** When the deploy script fired 6 `writeContract` calls back-to-back without awaiting receipts, viem's automatic nonce inference saw the same nonce twice and submitted a tx with `nonce too low` after the first one mined. Fixed by wrapping each writeContract in an `await waitForTransactionReceipt`. **Suggestion to viem:** explicit pending-nonce tracking via the wallet client would prevent this — currently you have to either await every receipt or manage nonce manually with `nonceManager`.

3. **`vm.prank(OWNER)` consumed by an arg-evaluation contract call.** When test code wrote `oracle.method(market.id(), ...)`, the `market.id()` static call fired the prank one frame too early. Fix: cache `market.id()` to a state field and use it in the args. Foundry's prank semantics are correct; this is a test-author trap. Worth a one-line note in the Foundry docs ("prank is consumed by the next external call, including arg evaluation").

### ChainGPT auditor pass

Ran across all 10 contracts. Report: `contracts/audits/chaingpt-2026-04-25-f4.md`. All HIGH-severity findings reduce to "owner is a single EOA — consider multisig + time-lock", which is standard hackathon-grade hardening. Filed in `KNOWN_LIMITATIONS.md` as accepted v1 risk. No exploitable vulnerabilities surfaced.

The ChainGPT auditor's tone is generic-LLM, but it caught real architectural concerns (admin centralization, missing event emissions, gas optimization opportunities). It missed some subtler points the human review would catch — for example, the cross-contract Nox ACL pattern (F3 BUG_LOG) wasn't flagged anywhere. Reasonable bar for "first-pass automated review", not a substitute for human auditing.

### Test coverage

`forge coverage` on `src/`:

| File                     | Lines      | Statements | Branches   | Funcs      |
| ------------------------ | ---------- | ---------- | ---------- | ---------- |
| ConfidentialUSDC.sol     | 94.64%     | 93.91%     | 75.00%     | 94.44%     |
| Market.sol               | 97.62%     | 95.26%     | 82.22%     | 95.24%     |
| MarketRegistry.sol       | 100.00%    | 100.00%    | 100.00%    | 100.00%    |
| ResolutionOracle.sol     | 100.00%    | 100.00%    | 100.00%    | 100.00%    |
| AdminOracle.sol          | 100.00%    | 100.00%    | 100.00%    | 100.00%    |
| PreResolvedOracle.sol    | 100.00%    | 100.00%    | 100.00%    | 100.00%    |
| ChainlinkPriceOracle.sol | 97.56%     | 96.23%     | 90.91%     | 100.00%    |
| TestUSDC.sol             | 100.00%    | 100.00%    | n/a        | 100.00%    |
| **Total**                | **97.07%** | **96.07%** | **90.65%** | **97.14%** |

148 unit tests + 2 fork tests pass. Coverage well above PRD's ≥85% bar across every file.

---

## Phase F4.5 — Slither & Safe SDK DX

### Slither (`slither-analyzer 0.11.5`)

**What worked:**

- Auto-detection of foundry projects via `crytic-compile` is seamless — no `solc-remaps` config needed when `slither .` is run from a foundry root.
- `--filter-paths "lib|test|script"` works as expected for project-only analysis.
- The detector taxonomy is sensible: `reentrancy-no-eth` for state-after-external-call, `reentrancy-benign`/`reentrancy-events` for ordering nits, `timestamp` for `block.timestamp` reliance — all clearly named and mappable to remediation patterns.

**What hurt:**

- **UDVT line-mapping bug.** Slither's source-position resolver does NOT correctly handle user-defined-value-type variable declarations. The Nox SDK's `euint256` / `ebool` are UDVTs — exactly the right Solidity primitive for typed encrypted handles. After F4.5 hardening:
  - `Market.refundIfInvalid` `euint256 betHandle = euint256.wrap(bytes32(0));` → flagged uninitialized.
  - `Market.placeBet` `euint256 transferred = cUSDC.confidentialTransferFrom(...)` → flagged unused-return.
  - `MarketRegistry` `address public immutable confidentialUSDC` → flagged "should be immutable".
  - All three are syntactically and semantically correct; the forge-produced AST `initialValue`/`mutability` fields are populated. Slither just doesn't read them right. We documented as false positives in `audits/slither-2026-04-25/summary.md` after burning ~30 min trying every cache-clear / config permutation.
- **`--checklist` mode produces inconsistent aggregations.** Running `slither . --checklist` produced 51 findings while `slither .` produced 47 — the extra 4 were the same UDVT phantoms but counted twice. The `--checklist` markdown output appears to merge stale + fresh detector runs in some race-y way. Workaround: always run `forge build --build-info --force` first, then `slither . --ignore-compile`.
- **Exit code 255 is not "error"** — slither exits non-zero whenever it finds anything ≥informational, even on a clean run with all-low/info findings. CI integrators must check the JSON, not the exit code, to gate on severity.

**Suggestions for crytic team:**

- Add UDVT to slither's variable-init / return-capture / mutability detectors. The Nox SDK's `euint256` and OpenZeppelin Confidential's encrypted types are both UDVTs — this gap will hit every confidential-compute project on Solidity 0.8.34+.
- Make `--checklist` re-run detectors fresh, or document the build-info ordering requirement.
- Consider `--severity-threshold` flag for CI.

### Safe Protocol Kit (`@safe-global/protocol-kit 7.1.0`)

**What worked:**

- `Safe.init({provider, signer, predictedSafe})` flow is clean: pass owners + threshold + saltNonce, get a kit pointed at the to-be-deployed address.
- `createSafeDeploymentTransaction()` returns `{to, value, data}` ready to forward to viem's `walletClient.sendTransaction`. Decoupling tx construction from execution is the right move.
- `getSafeAddressFromDeploymentTx` and `predictSafeAddress` give both pre- and post-deploy address resolution.
- After deploy, `Safe.init({safeAddress})` is symmetric — same SDK, just connected mode.
- Deployment cost was modest: Safe v1.4.1 + 7 ownership transfers (transferOwnership × 7) cost ~0.0003 ETH on Arb Sepolia at 0.1 gwei.

**What hurt:**

- **No "execute as N owners" helper.** To execute a tx with 2 signatures, you must:
  1. `sdk1.createTransaction(...)` from owner #1's POV.
  2. `sdk1.signTransaction(tx)` to add signature #1.
  3. `await Safe.init({signer: PK2, safeAddress})` — re-init from owner #2's POV.
  4. `sdk2.signTransaction(tx)` to add signature #2.
  5. `sdk1.executeTransaction(tx)` to broadcast (any signer can execute).

  This is verbose for the "operator co-signs with self" testnet pattern (where one operator holds all keys for expedience). A `safe.executeWithSigners([pk1, pk2], tx)` shorthand would shave 5 lines per call.

- **GS013 swallows the inner revert reason.** When the wrapped tx reverts, Safe v1.4.1 propagates as the opaque `GS013`, not the inner reason. To debug, you have to manually `eth_call` the same target/data from the Safe address's perspective. A `Safe.simulateTransaction(tx)` helper that exposes the underlying revert would help (especially since the SDK already has `estimateContractGas` machinery).
- **`executeTransaction` return shape is provider-dependent.** Sometimes `{hash}`, sometimes `{transactionResponse: {hash}}`. The TS types should narrow this; currently we have to cast through `unknown` to support both.

**DX overall: 7/10.** The Protocol Kit is the cleanest Solidity-side multisig SDK we've used. The 5-line "execute with two signatures" boilerplate is the main UX rough edge.

### Multisig migration cost

| Operation                                                                  | Gas                | ETH @ 0.1 gwei    |
| -------------------------------------------------------------------------- | ------------------ | ----------------- |
| Safe v1.4.1 deploy via SafeProxyFactory                                    | ~615k              | 0.000061 ETH      |
| 7 × `transferOwnership(safe)`                                              | ~30k each = 210k   | 0.000021 ETH      |
| Safe execTransaction × 5 in smoke (mint, createMarket × 2, setAdapter × 2) | ~250k each = 1.25M | 0.000125 ETH      |
| MarketImpl v3 deploy + Safe-set-impl                                       | 2.4M + 90k         | 0.000249 ETH      |
| **Total F4.5 chain ops**                                                   | **~4.5M gas**      | **~0.000456 ETH** |

Slither install + run was free.

---

## F5-followup — DX gap: synchronous `require()` on encrypted comparison

Caught while implementing a bet-floor concern in `Market.placeBet`. The intuitive
guard for "reject dust amounts" is

```solidity
ebool isAboveFloor = Nox.ge(betAmount, Nox.toEuint256(MIN_BET));
require(_revealSync(isAboveFloor), "BetTooSmall");
```

…but `_revealSync` does not exist. `Nox.publicDecrypt(ebool, bytes)` ([Nox.sol:1222](contracts/lib/nox-protocol-contracts/contracts/sdk/Nox.sol#L1222))
needs a gateway-issued decryption proof, which is a same-transaction
chicken-and-egg: the proof is produced off-chain _after_ the comparison handle
exists on-chain, so it cannot ride in the same transaction as the
comparison.

### Concrete impact in our build

We could not enforce a minimum bet amount in `placeBet`. The two workable
alternatives both have material downsides:

- **Silent clamp via `Nox.select`** (zero out dust before `confidentialTransferFrom`):
  closes economic griefing but leaves event-spam open AND introduces a per-side
  lockout footgun (initializing `_yesBet[user]` to encrypted-zero blocks any
  subsequent real bet on that side via `AlreadyBetThisSide`).
- **Plaintext minimum argument** in the function signature: defeats the entire
  privacy thesis on every transaction. Non-starter for a confidential market.

We documented this as a known limitation rather than half-fixing. See
`KNOWN_LIMITATIONS.md` "Dust-bet spam not synchronously prevented (F5-followup)"
and `DRIFT_LOG.md` "F5-followup ... MIN_BET enforcement infeasible".

### Proposal: same-transaction `ebool` reveal for `require()` patterns

A protocol primitive that lets a contract synchronously reveal a _boolean_
comparison result for the express purpose of access control / input
validation. Sketch of the API:

```solidity
// Reverts on false. Implementation: TEE-side fast-path that processes the
// comparison handle inline against the calling tx's state. Bool-only — no
// integer reveals — preserves privacy of operands.
function requireTrue(ebool handle) internal;

// Or, if a sync-revealing op fits the model better:
function decryptBoolImmediate(ebool handle) internal returns (bool);
```

The privacy property to preserve: only a **boolean** is revealed (not the
operands). For comparison-against-public-constant cases like `bet >= MIN_BET`,
the only secret being protected is whether the _user's specific input_ passed
the threshold — which is far less sensitive than the input value itself, and
revealing it is exactly the access control the contract author wants.

Concrete use cases in confidential apps:

- bet floors / spend limits in confidential markets and DeFi
- per-user transfer caps (`require(transferred <= dailyLimit)`)
- confidential rate-limiting (`require(callsThisHour < N)`)
- KYC tier enforcement against encrypted score (`require(kycScore >= TIER_2)`)

zama/fhEVM solves the analogous problem with `FHE.decrypt()` against a
decryption oracle, which their docs frame as the canonical pattern for
"reverting on encrypted preconditions." Nox's async-only model is a strict
subset of that capability, and the gap shows up immediately the first time a
contract author wants `require(encryptedThing)`.

DX rating, this specific issue: 4/10 — the workaround is to write a known
limitation. The thing the developer wants to write doesn't compile in a way
that maps to their mental model.

---

## F7 — Safe UI Transaction Service indexer doesn't surface our Safe on Arb Sepolia

Caught during F7 Faucet funding. `app.safe.global` loads the Safe shell page but
the Transaction Service indexer never returns our Safe's data — the "Queue" and
"History" tabs stay empty even for txs that landed on-chain. This isn't a
signing failure or a contract issue: the Safe v1.4.1 deployment at
`0x042a49628f8A107C476B01bE8edEbB38110FA332` is on-chain, owns 8 of our
contracts, and execTransaction txs land normally — the UI just can't see them.

We hit this trying to do the simplest possible op (the F7 multisig-mediated
TestUSDC.mint(faucet, 10M)) and immediately gave up on the UI as the operator
path.

### Working alternative: scripts as the source of truth

Since F4.5 we've been Safe-cosigning multisig ops via TS scripts using
`@safe-global/protocol-kit`'s `Safe.init` → `createTransaction` →
`signTransaction` (×N signers) → `executeTransaction` flow. The SDK handles
the EIP-712 SafeTx hashing and signature concatenation internally, so the
script stays terse:

```typescript
const sdk1 = await Safe.init({provider, signer: PK1, safeAddress});
let tx = await sdk1.createTransaction({transactions: [{to, value: "0", data}]});
tx = await sdk1.signTransaction(tx);
const sdk2 = await Safe.init({provider, signer: PK2, safeAddress});
tx = await sdk2.signTransaction(tx);
const exec = await sdk1.executeTransaction(tx);
```

This pattern now lives in:

- `tools/deploy-multisig.ts` (Safe deployment + initial ownership transfer)
- `tools/deploy-f45.ts` (MarketImpl v3 swap)
- `tools/deploy-f5-followup.ts` (MarketImpl v5 swap)
- `tools/deploy-faucet.ts` (Faucet ownership transfer)
- `tools/multisig-mint-faucet.ts` (this F7 mint, ~50 lines)

DX is solid. The SDK is well-typed, the API is small, and the script makes
multisig ops auditable + repeatable in CI. We've reached for it for every
multisig op in this project; the UI hasn't successfully completed a single
one for us on Arb Sepolia.

### Suggested fixes upstream

1. **Document Arb Sepolia indexer status** — Safe's official infra docs don't
   mention which testnets have a working Transaction Service. A "Supported
   Networks" table on the docs site listing `[mainnet, sepolia, arb-sep, ...]`
   with current indexer health (▮▮▮▮▯) would have saved us 30 min.
2. **Surface a "no indexer" notice in the UI** — if Transaction Service can't
   resolve the Safe, render "Indexer unavailable for this network — use the SDK
   or a script. [Docs link]" instead of an empty Queue. Currently the UI looks
   broken; it's actually a known indexer gap.
3. **Ship a `safe-cli`-equivalent in @safe-global/protocol-kit** — we
   re-implement the same `safeExecAs2of3` helper across every deploy script.
   A first-class `Safe.execTransaction({signers: [pk1, pk2], to, data})` that
   bundles the multi-signer flow into one call would remove the boilerplate.

---

## F7 — Privy + wagmi + viem + @tanstack/react-query integration

The full client-stack install for F7's dashboard. Versions at install:

| Package                 | Version   | Notes                                                         |
| ----------------------- | --------- | ------------------------------------------------------------- |
| `@privy-io/react-auth`  | `3.22.2`  | peer `react: ^18 \|\| ^19` ✓                                  |
| `@privy-io/wagmi`       | `4.0.6`   | peer `viem: 2.47.12` (exact pin), `wagmi: >=2`                |
| `wagmi`                 | `3.6.5`   | peer `viem: 2.x`, `@tanstack/react-query: >=5`, `react: >=18` |
| `viem`                  | `2.47.12` | matched to Privy/wagmi exact-peer                             |
| `@tanstack/react-query` | `5.100.5` |                                                               |
| `lucide-react`          | `1.11.0`  | sidebar/topbar icons                                          |
| `@wagmi/cli` (dev)      | `2.10.0`  | ABI codegen from Foundry artifacts                            |

### What worked

- The `@privy-io/wagmi` README's provider snippet is verbatim copy-pasteable
  and correct. `PrivyProvider → QueryClientProvider → WagmiProvider` is
  documented and shipped working on first try.
- `createConfig` re-export from `@privy-io/wagmi` (instead of upstream wagmi's)
  is a small but smart abstraction — it makes the connector wiring invisible
  to the consumer. We didn't have to think about it.
- `embeddedWallets.ethereum.createOnLogin: 'users-without-wallets'` does
  exactly what it says. Email login → embedded wallet auto-provisioned →
  immediate wagmi access. Zero extra glue. Best embedded-wallet UX we've used.
- `appearance.theme: 'light' | 'dark' | HexColor` accepts our `useTheme()`
  output directly. No transform layer needed.
- `@wagmi/cli` Foundry plugin generates clean `*Abi` + `*Address` exports from
  `contracts/out/*.json`. Single `pnpm generate:contracts` command, types flow
  through to every wagmi hook. Codegen is unambiguous about which contracts
  it indexed (one terse line per resolved file).

### Friction we accepted

- **Exact-version peer pin on viem (`@privy-io/wagmi` ⇒ `viem: 2.47.12`).**
  Higher minor of viem will just warn at install time (not block), but pinning
  exactly to Privy's expected version sidesteps subtle ABI/type drift in their
  connector. Privy could probably loosen this to `^2.47.0` without harm.
- **`useChainId()` type narrowing.** Once wagmi knows the configured chain set
  is `[arbitrumSepolia]`, `useChainId()` returns the literal `421614` — a
  comparison to any other chainId is unreachable per type. To detect a wallet
  on a non-config chain you need `useAccount().chainId` (typed `number |
undefined`). The docs don't surface this distinction prominently. Filed in
  BUG_LOG.
- **React 19 `react-hooks/set-state-in-effect` rule fights wagmi result-effect
  patterns.** The natural pattern of "on tx confirm, fire UI feedback" via
  `useEffect(..., [receipt.isSuccess])` calling `setSomething(true)` is now a
  lint error. Defer via `setTimeout(..., 0)` or `useSyncExternalStore`. Worth
  documenting in wagmi's "common patterns" docs because it's going to bite
  every wagmi user moving to React 19.
- **Privy's modal palette is captured at provider mount.** Our theme toggle
  re-renders the PrivyProvider with a new `appearance.theme` prop, which
  works _for the next-opened modal_ — but if the modal is already open at
  the moment of toggle, it doesn't re-style live. Acceptable; users don't
  typically toggle theme mid-modal. A reactive theme prop would be a polish
  win for Privy.

### Suggested fixes upstream (Privy)

1. **Loosen the viem peer to `^2.47.0`** — exact pin causes monorepo
   version-skew headaches when other parts of the stack ship a newer 2.x.
2. **Document the `'users-without-wallets'` flow more loudly.** It's the
   killer feature of Privy for hackathon UX (login = wallet, no seed-phrase
   modal), but the option is buried in the embedded-wallets type. A "Quickstart
   for hackathons" page that leads with this would convert.
3. **Live appearance prop.** Make Privy's open modal observe its `appearance`
   prop reactively so theme toggles take effect immediately.
4. **First-class `useEmbeddedWallet()` getter.** We're inferring "is this an
   embedded wallet?" from `wallets[0]?.walletClientType === "privy"`, which
   works but feels like internal API. A typed `useEmbeddedWalletStatus()`
   hook would be clearer.

### Suggested fixes upstream (wagmi)

1. **Document the `useChainId()` vs `useAccount().chainId` distinction.** A
   "How do I detect wrong-network?" entry in the FAQ would save every wagmi
   user 10 minutes of typecheck-error confusion.
2. **`react-hooks/set-state-in-effect` collision pattern doc.** wagmi's
   "useWaitForTransactionReceipt" page should include a React 19 note showing
   the canonical "post-confirm feedback" pattern that doesn't cascade.

DX overall, F7 stack: 8.5/10. Privy is the highlight — embedded-wallet
auto-provisioning is the right shape for hackathon judges. wagmi v3 + viem
2.47 + Tanstack Query 5 is mature, fast (Turbopack build hit 9s cold), and
the type system surfaces real bugs (the `useChainId()` issue caught in
typecheck, not at runtime).

---

## F8 — Polymarket Gamma API DX, the JSON-stringified-array footgun

Caught while scoping the F8 data layer for `/markets`. We hit the `/markets`
list endpoint at `https://gamma-api.polymarket.com/markets` (no auth, instant
HTTP 200) and inspected the response. Two of the most-read fields on every
market record are typed in the OpenAPI spec as plain `string`:

```yaml
outcomes:
  type: string
  nullable: true
outcomePrices:
  type: string
  nullable: true
```

…but at runtime they are **JSON-stringified arrays of strings**:

```json
{
  "id": "2036399",
  "outcomes": "[\"Yes\", \"No\"]",
  "outcomePrices": "[\"0.0015\", \"0.9985\"]"
}
```

Every consumer has to remember to call `JSON.parse()` on these two fields and
then `parseFloat()` each element of `outcomePrices`. The OpenAPI declaration
is technically correct (yes, the wire value is a string), but it gives type
generators and IDE autocomplete zero help. A consumer following the spec
literally will end up with `outcomePrices.length === 16` (string length of
`"[\"0.0015\", \"0.9985\"]"`) before catching the issue at runtime. We
caught it during HALT 0 live verification — an agent or human reading the
spec without running it would not.

### Why this matters more than it looks

This is the highest-traffic field shape in the entire Polymarket data model:
`outcomes` × `outcomePrices` is what every prediction-market client renders.
The cost of the foot-gun multiplied by the number of clients is non-trivial.

### Cleanest upstream fixes

1. **OpenAPI: declare them as JSON-encoded inline schemas.**

   ```yaml
   outcomes:
     type: string
     description: "JSON-encoded array of outcome labels"
     x-json-schema:
       type: array
       items: {type: string}
   outcomePrices:
     type: string
     description: "JSON-encoded array of probability strings 0..1, sums to ~1.0"
     x-json-schema:
       type: array
       items: {type: string, pattern: "^[01](\\.[0-9]+)?$"}
   ```

   The `x-json-schema` extension is a community convention; the description
   alone — even without the extension — would prevent half the surprise.

2. **At the API layer: parse them server-side and return real arrays.**

   ```jsonc
   {
     "outcomes": ["Yes", "No"],
     "outcomePrices": [0.0015, 0.9985],
   }
   ```

   The serialization-as-string smells like an artifact of an older internal
   storage model. New consumers shouldn't have to know about it.

3. **Document loudly in the API reference.** Right now the
   `/markets` reference page lists them next to other plain-string fields
   (`slug`, `question`) with no visual distinction. A "⚠ JSON-encoded"
   callout on those two fields would catch every consumer.

### Other Gamma observations

- **No documented Gamma rate limit.** 20 list calls in ~2s without auth all
  returned 200. The dedicated rate-limits docs page covers CLOB, not Gamma.
  We're caching server-side at 60s revalidate which is conservative; would
  be helpful to know whether that's overkill or under-budget.
- **`marketType` and `formatType` are typed as nullable strings but
  consistently return `null`** on the markets we sampled. If they're not
  in active use, removing them from the spec would reduce noise. If they
  are, surfacing what values they take would help.
- **Categorical/multi-outcome markets aren't a schema variant — they're
  events with N binary sub-markets.** Documented well enough on the
  /events page once we found it, but a single-line cross-reference on the
  `/markets` reference page ("multi-outcome scenarios are modeled as
  events with multiple binary sub-markets — see `/events`") would have
  saved 10 minutes of "where are the categorical markets in the schema?"

### What we did about it in DarkOdds

`web/lib/polymarket/client.ts` is the **single** site in the entire codebase
that calls `JSON.parse(market.outcomes)` / `JSON.parse(market.outcomePrices)`.
The exposed `PolymarketMarket` type carries `outcomes: PolymarketOutcome[]`
with a `probability: number` already parsed. Components and the F11 clone
flow never touch the raw stringified shape. Documented in client.ts source
comments and enforced by `lib/polymarket/types.ts` not exporting the raw
`GammaMarketRaw` shape.

DX rating, this specific issue: 5/10. Once you know about the parse, the
rest of the API is clean and well-shaped. Until you know, it's a real
"why is `outcomePrices.length` 16?" stumble.
