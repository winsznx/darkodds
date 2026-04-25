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
