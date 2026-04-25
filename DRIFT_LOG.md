# DRIFT_LOG

Append-only log of every divergence between the implementation and the active PRD.
Source-of-truth: `Darkodds Master PRD v1.3.md` (was v1.2 → v1.1 → v1.0).
Format per §0.2.

---

## [2026-04-25 F2] Active PRD bumped v1.2 → v1.3 — ConfidentialUSDC is Nox-native, not OZCC

**Expected (per PRD v1.2 §5.1):** Wrap OpenZeppelin Confidential Contracts' `ERC7984ERC20Wrapper` as the base.
**Actual (implementation):** Built Nox-native on `@iexec-nox/nox-protocol-contracts@0.2.2`. Concretely: `ConfidentialUSDC.sol` imports only `Nox` from `sdk/Nox.sol` + `encrypted-types` types, uses `Nox.fromExternal` / `Nox.mint` / `Nox.burn` / `Nox.allow` / `Nox.allowThis` / `Nox.allowPublicDecryption` / `Nox.publicDecrypt`. ERC-7984 spec compliance preserved at function-shape level via our own `IERC7984` interface re-typed to `euint256` / `externalEuint256`.
**Reason:** OZCC v0.4.0 imports `@fhevm/solidity/lib/FHE.sol` throughout — built for Zama FHEVM, not Nox. Inheriting it would deploy a contract bound to Zama's on-chain ACL (different protocol, different chain). Per §0.1 "docs win", and confirmed by deep source-evidence research (no published iExec wrapped-ERC20 reference exists; we author the canonical pattern). Operator confirmed in v1.3 prompt.
**Impact:** Single largest architecture decision in the project. We give up OZCC's `euint64` interface compat in exchange for Nox's `euint256` (more headroom for F3 pool accumulators). Full rationale captured in PRD v1.3 §5.1.1.
**Decision:** Proceed Nox-native. Cited iExec's own published `ConfidentialTokenMock.sol` as the closest reference for the Nox `_update`/ACL idiom we follow.

---

## [2026-04-25 F2] §11 F2 — `INox.sol` interface dropped; `INoxCompute` already published

**Expected (per F2 prompt):** Author `contracts/src/interfaces/INox.sol` exposing `fromExternal(...)`.
**Actual (implementation):** Did not author. `@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol` is the published interface for the on-chain Nox protocol contract. Our contract uses the high-level `Nox` SDK library which internally calls `INoxCompute`; we never need to declare the interface ourselves.
**Reason:** Avoid duplication. The library's interface is canonical and tracks upstream changes automatically.
**Impact:** None — the integration is identical, with one fewer file to maintain.
**Decision:** Proceed without `INox.sol`. PRD v1.3 §5.1.2 is consistent with this.

---

## [2026-04-25 F2] §11 F2 — Custom `MockNox.sol` dropped; iExec's `TestHelper` used instead

**Expected (per F2 prompt step 5):** Build `contracts/test/mocks/MockNox.sol` that implements `INox` with permissive proof verification.
**Actual (implementation):** Did not author. iExec ships `lib/nox-protocol-contracts/test/utils/TestHelper.sol` (BUSL-1.1, test-only) which `vm.etches` the **real** `NoxCompute` proxy bytecode at the chain-resolved address, generates valid EIP-712 gateway-signed input proofs, builds public-decryption proofs, and creates correctly-formatted handles. We import it directly and run our tests against the **real** on-chain Nox logic (just etched onto local chain 31337). Higher fidelity than a hand-rolled mock — every ACL grant, proof validation, and atomic compute primitive runs against the exact same code that's deployed on Arb Sepolia.
**Reason:** Don't reinvent. iExec's testing infrastructure is canonical.
**Impact:** Skipped ~150-300 lines of mock code. 28 unit tests + 1 fork test pass. 95% line coverage on `src/`.
**Decision:** Proceed with `TestHelper`. Logged in `feedback.md` as a positive iExec DX win.

---

## [2026-04-25 F2] §11 F2 — Foundry contextual remapping for TestHelper's `forge-std/src/...` imports

**Expected:** Standard `forge-std/=lib/forge-std/src/` remapping handles all forge-std imports.
**Actual:** iExec's `TestHelper.sol` imports `forge-std/src/Vm.sol` (with the `src/` prefix), which our standard remapping resolves to `lib/forge-std/src/src/Vm.sol` — wrong path. Foundry deduplicates same-target remappings if both are listed at the top level (`forge-std/=...` and `forge-std/src/=...` collapse).
**Workaround:** Foundry contextual remapping syntax `lib/nox-protocol-contracts/:forge-std/src/=lib/forge-std/src/` — kicks in only for imports originating from inside the Nox lib's directory.
**Impact:** Compile noise (resolver logs an [ERROR] for the first attempt before the contextual fallback succeeds), but functional. Contextual remapping is a real Foundry feature, not a hack.
**Decision:** Proceed.

---

## [2026-04-25 F2] §11 F2 — ChainGPT auditor pass deferred to F4.5

**Expected (per F2 prompt step 8):** Run ChainGPT Smart Contract Auditor on TestUSDC + ConfidentialUSDC, save report.
**Actual (implementation):** Deferred to Phase F4.5 per operator's standing secrets policy. F4.5 is the explicit security-hardening phase; running the auditor there gives it more surface to cover (Market, Resolution, Claim) instead of two F2-only contracts in isolation.
**Impact:** None on F2 deliverable. F4.5 will audit ALL contracts including F2 ones.
**Decision:** Defer.

---

## [2026-04-25 F2] §11 F2 — Verified on Arbiscan (Etherscan V2), not Blockscout

**Expected (per F2 prompt):** Verify on Blockscout's Arbitrum Sepolia instance (no API key required).
**Actual (implementation):** Verified on Arbiscan via Etherscan V2 API (`https://api.etherscan.io/v2/api?chainid=421614`) using operator's `ARBISCAN_API_KEY` from `.env.local`. Both contracts: `Pass - Verified`. Blockscout verification was attempted but the Blockscout API returned HTTP 524 (CloudFlare timeout) — transient outage.
**Reason:** Operationally reachable, operator-supplied real API key, canonical Etherscan-family explorer for Arbitrum.
**Impact:** Judges can verify on Arbiscan today. Blockscout can be re-attempted as a free background task in a later phase.
**Decision:** Proceed with Arbiscan-only for F2 commit.

---

## [2026-04-25 F2] §11 F2 — Deploy via viem, not `forge script` / `forge create`

**Expected (per F2 prompt):** `contracts/script/DeployF2.s.sol` deploys via `forge script`.
**Actual (implementation):** Wrote `DeployF2.s.sol` (committed as documentation of the canonical broadcast pattern), but Foundry 1.6.0 fails to deploy against the public Arb Sepolia RPC: alloy expects `timestampMillis` in `eth_getBlockByNumber` responses, which Arbitrum's RPC does not return. Both `forge script` and `forge create` hit this. We deploy via `tools/deploy-f2.ts` using viem (which doesn't have this strictness), then use `forge verify-contract` post-deploy.
**Reason:** Tooling bug in Foundry 1.6.0 + Arbitrum RPC compat. Not fixable from our side.
**Impact:** None on outcome. We retain `DeployF2.s.sol` for the day Foundry catches up; viem deployer is the active path.
**Decision:** Proceed with viem deployer. Logged in `feedback.md` for upstream report.

---

## [2026-04-25 F2] §11 F2 — Encrypt → wrap → decrypt round-trip GREEN against real Nox + Arb Sepolia

**Expected (per F2 prompt step 7):** Smoke test `tools/smoke-f2.ts` MUST decrypt to plaintext == amount before commit.
**Actual:** GREEN. Latency table from the run:

| step           | latency     |
| -------------- | ----------- |
| load           | 0ms         |
| balance        | 241ms       |
| mint           | 2486ms      |
| approve        | 2601ms      |
| encrypt        | 1930ms      |
| wrap           | 2180ms      |
| balance-handle | 240ms       |
| decrypt        | 1164ms      |
| **total**      | **11441ms** |

This is the moment v1.1 PRD's P0 envisioned. v1.2 deferred decrypt to F2 (correctly — handle ACL lives on-chain via `Nox.fromExternal`). v1.3 is where it lands. Decrypt succeeds because `wrap` calls `Nox.fromExternal(handle, proof)` (committing the deposit handle to on-chain ACL with the contract as transient admin) and then `Nox.allow(newBalance, msg.sender)` (granting the user persistent viewer access). Off-chain `decrypt(balanceHandle)` succeeds via the gateway's `isViewer(handle, user)` check.
**Decision:** GREEN. Phase complete.

---

## [2026-04-25 P0-retry] Active PRD bumped v1.1 → v1.2

**Expected (per PRD v1.1):** P0 gate validates `encrypt → decrypt → viewACL` round-trip.
**Actual (implementation):** P0 gate revised in PRD v1.2 §11 to validate infrastructure reachability only — `rpc`, `client`, `encrypt`, `nox-code` (Nox protocol contract bytecode at SDK-configured address), `subgraph` (GraphQL introspection). The `decrypt` and `viewACL` steps are removed; new §6.0 explains the two-stage handle lifecycle that makes them structurally impossible at this stage.
**Reason:** Operator updated PRD in response to the previous P0 RED in `BUG_LOG.md`. Per §0.1 ("docs win"), the corrected gate is doc-aligned with the SDK's actual semantics.
**Impact:** `tools/healthcheck.ts` rewritten. Five steps now: `rpc`, `client`, `encrypt`, `nox-code`, `subgraph`. The `decrypt` round-trip naturally occurs in Phase F2 when `ConfidentialUSDC.wrap()` consumes the proof on-chain.
**Decision:** Proceed under v1.2 gate.

---

## [2026-04-25 F1] §11 F1 — `forge init --no-commit` flag does not exist in Foundry 1.6.0

**Expected (per F1 prompt):** `forge init contracts --no-commit --no-git`
**Actual (implementation):** Used `forge init contracts --use-parent-git`. Foundry 1.6.0 does not accept `--no-commit`; only `--commit` (opt-in) and `--no-git` exist. `--use-parent-git` lets the contracts project participate in the parent darkodds repo's git tracking instead of creating its own.
**Reason:** Flag drift in Foundry. Verified by inspecting `forge init --help`.
**Impact:** Functionally equivalent — no extra commit was made, no nested git repo was created.
**Decision:** Proceed with `--use-parent-git`.

---

## [2026-04-25 F1] §4.2 — `contracts/` is NOT a pnpm workspace

**Expected (per F1 prompt step 1):** `pnpm-workspace.yaml` declaring `contracts`, `web`, `subgraph`.
**Actual (implementation):** Workspaces are `web` + `subgraph`. `contracts/` is a Foundry-only project consumed by the root `pnpm test:contracts` script (`forge test --root contracts`).
**Reason:** Foundry projects do not use Node.js dependency management. Adding `contracts/` to pnpm-workspace would force creation of a `contracts/package.json` that has no real role and creates two competing dep systems for the same directory. Per §0.1, doc-correct is to keep them separate.
**Impact:** None on observable behavior. Foundry's `forge install` continues to manage `contracts/lib/` (git submodules under the parent darkodds repo via `--use-parent-git`).
**Decision:** Proceed.

---

## [2026-04-25 F1] §F1 — Tailwind v4 is CSS-first; `tailwind.config.ts` is intentionally minimal

**Expected (per F1 prompt):** "Configure `tailwind.config.ts` to extend with placeholder design tokens from §7.1".
**Actual (implementation):** Tokens live in `web/app/globals.css` under `@theme inline { ... }` per the Tailwind v4 idiom. `tailwind.config.ts` exists but only declares `content` paths — it does NOT redeclare tokens.
**Reason:** Tailwind v4's official guidance is CSS-first config; `tailwind.config.ts` is a backward-compat surface, not the primary place for tokens. Duplicating tokens in JS would create two sources of truth.
**Impact:** Phase F6 styles consume tokens via `var(--bg)` and the matching `bg-bg` Tailwind utility (auto-generated from `--color-bg`). Same DX as token-in-JS, single source.
**Decision:** Proceed.

---

## [2026-04-25 F1] §F1 — `shadcn init` defaults conflict with PRD §7.1; partially undone

**Expected (per F1 prompt):** "Configure shadcn/ui via `npx shadcn@latest init` — accept defaults that align with §7.1".
**Actual (implementation):** Ran `shadcn@4.4.0 init -y --defaults --base base --no-monorepo`. The defaults DO NOT align with §7.1:

1. shadcn injected `import { Geist } from "next/font/google"` into `app/layout.tsx` — directly violates §7.1's "locally host all fonts under `/public/fonts/`" rule.
2. shadcn imported `tw-animate-css` and `shadcn/tailwind.css`, polluting `globals.css` with conflicting oklch palette, a competing `.dark` class (we use `[data-theme="dark"]`), and `--radius: 0.625rem` (§7.1 forbids rounded corners > 2px).
3. shadcn added 7 runtime deps (`@base-ui/react`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `tw-animate-css`, `shadcn` itself) all with caret ranges — violates §15.3 exact-pin rule.
4. shadcn generated `components/ui/button.tsx` and `lib/utils.ts` ahead of the F6 design pass.

**Reason:** §0.1 ("docs win" / spec compliance) overrides the operator prompt's request. The shadcn defaults pre-impose decisions that §7.1 explicitly forbids.

**Impact:** Reconciled by:

- Restoring `app/layout.tsx` to local-fonts-only (no `next/font/google`).
- Rewriting `app/globals.css` to PRD §7.1 tokens, with `--radius: 0px` and shadcn-conflicting blocks dropped.
- Removing all shadcn-injected runtime deps from `web/package.json`.
- Deleting `components/ui/button.tsx` and `lib/utils.ts` — F6 will hand-build per §7.3.
- Keeping `web/components.json` (zero-cost marker) so `shadcn add <component>` is one command if F6 decides to use any specific shadcn component as a starting point. F6 will need to override the radius/font/palette before keeping anything shadcn outputs.
  **Decision:** Proceed with reconciled state. F6 starts with no shadcn components in tree.

---

## [2026-04-25 F1] §15.2 — eslint pinned to 9.39.4 instead of latest 10.2.1

**Expected (per §0.1):** "Latest stable, advisory-clean version".
**Actual (implementation):** `eslint@9.39.4` (latest 9.x; npm `dist-tags.maintenance`). npm `dist-tags.latest` is 10.2.1.
**Reason:** `eslint-config-next@16.2.4` and its bundled plugins (`eslint-plugin-import@2.32.0`, `eslint-plugin-jsx-a11y@6.10.2`, `eslint-plugin-react@7.37.5`) declare peer-dep ranges that cap at `^9`. Installing eslint 10 produces three `unmet peer eslint` warnings. Per §15.3 "advisory-clean", peer-mismatch is a real signal — pinning to 9.39.4 satisfies all peers cleanly.
**Impact:** None on linting behavior. Re-evaluate when `eslint-config-next` ships a 10-compatible release (track upstream).
**Decision:** Proceed on 9.39.4.

---

## [2026-04-25 F1] §F1 — Foundry `assertEq(1+1, 2)` ambiguity required explicit uint256 coercion

**Expected (per F1 prompt step 2):** "trivial `test/Sanity.t.sol` that asserts `1 + 1 == 2`"
**Actual (implementation):** Test reads `assertEq(uint256(1) + uint256(1), uint256(2))`. The literal `1` is `int_const` and forge-std's `assertEq` has overloads for `bool`, `uint256`, `int256`, `address`, `bytes32`, `string`, `bytes` — Solidity's argument-dependent lookup cannot pick a unique candidate.
**Reason:** Solidity 0.8.34 + forge-std 1.16.0 overload resolution. Documented and well-known.
**Impact:** None — test passes in 7.95ms.
**Decision:** Proceed.

---

## [2026-04-25 P0-retry] §11 P0 step 4/5 — SDK has no public network-config introspection

**Expected (per PRD v1.2 §11 P0):** "Read the smart contract address used by the SDK's auto-config for Arbitrum Sepolia. Consult ... advanced-configuration for the documented introspection path. If the SDK doesn't expose this directly, log to BUG_LOG and infer from the SDK source."
**Actual (implementation):** `@iexec-nox/handle@0.1.0-beta.10`'s `src/index.ts` only re-exports the three factory functions (`createHandleClient`, `createEthersHandleClient`, `createViemHandleClient`). `NETWORK_CONFIGS` and `resolveNetworkConfig` from `src/config/networks.ts:8-15` are internal. The constructed `HandleClient` does not surface the resolved config either. We extract the values by source-inspection and pin them as constants in `tools/healthcheck.ts`.
**Reason:** Documented introspection path does not exist; source inspection is the prompt's documented fallback.
**Impact:** If the SDK changes the Arb Sepolia auto-config addresses in a future patch, our hardcoded constants will drift. The script's `nox-code` and `subgraph` steps will catch that drift loudly (bytecode missing or 4xx) rather than silently. Logged in BUG_LOG too.
**Decision:** Proceed with hardcoded values. Re-verify on every SDK pin bump.

---

## [2026-04-25 P0] §11 P0 — `@iexec-nox/handle` is beta-only

**Expected (per PRD §0.1, §15.2):** Latest **stable** `@iexec-nox/handle` (advisory-clean).
**Actual (implementation):** `@iexec-nox/handle@0.1.0-beta.10` — the package has no stable release; the entire publish history is `0.1.0-beta` through `0.1.0-beta.10` (latest dist-tag points at the beta).
**Reason:** SDK is pre-1.0. There is no stable channel to install from. Verified via `npm view @iexec-nox/handle versions`.
**Impact:** None for P0 — the API surface used here (`createViemHandleClient`, `encryptInput`, `decrypt`, `viewACL`) is documented and stable enough to round-trip. Phase F2+ should re-pin against the latest beta on each phase commit per §15.3.
**Decision:** Proceed. Pinned exactly to `0.1.0-beta.10`.

---

## [2026-04-25 P0] §11 P0 — `encryptInput(42)` shorthand is wrong; real signature is 3-arg

**Expected (per PRD §11 P0 step 4):** `encryptInput(42)` returns a handle.
**Actual (implementation):** Per `https://docs.iex.ec/nox-protocol/references/js-sdk/methods/encryptInput`, the documented signature is:

```ts
await handleClient.encryptInput(value, solidityType, applicationContract);
// → { handle, handleProof }
```

`encryptInput` is a 3-argument method. The PRD's `encryptInput(42)` is shorthand, not the real surface.
**Reason:** Docs win per §0.1. `value` must be paired with an explicit `SolidityType` ("uint256" used here) and an `applicationContract` address that the handle is bound to for on-chain proof verification.
**Impact:** Health check binds the handle to the ephemeral EOA address (no on-chain validation occurs in this gate, so any address that the wallet can sign for is sufficient for the round-trip). Phase F2+ markets must pass the deployed `Market.sol` address as the `applicationContract` — this is now load-bearing for `placeBet` proof verification.
**Decision:** Proceed with documented 3-arg signature.

---

## [2026-04-25 P0] §11 P0 — encrypt → decrypt round-trip is structurally impossible without an on-chain commit

**Expected (per PRD §11 P0):** `encryptInput(42)` followed by `decrypt(handle)` returns 42.
**Actual (implementation):** `decrypt` performs an on-chain `isViewer(handle, user)` call against the Nox protocol contract. The handle is only authorized after the bound `applicationContract` calls `fromExternal(handle, proof)` on-chain. `encryptInput` alone never triggers that write, so `decrypt` always fails on a never-committed handle. Same goes for `viewACL`, which queries a subgraph populated only by on-chain ACL events.
**Reason:** The Nox SDK's ACL model is on-chain by design (see `decrypt.ts:56-65`, `viewACL.ts:32-43`). The PRD assumes off-chain symmetry between encrypt and decrypt — that is not how Nox is built.
**Impact:** **Blocks P0 success as currently specified.** Health check exits RED. See `BUG_LOG.md` for full root-cause and remediation paths. Phase F2 must be aware: every test that wants to round-trip a handle through decrypt must first land a `fromExternal` tx via `ConfidentialUSDC` or a similar Nox-aware contract.
**Decision:** Halt. Operator must pick one of the three paths in BUG_LOG before P0 can move to GREEN.

---

## [2026-04-25 P0] §11 P0 — TypeScript pinned to 5.9.3, not 6.x

**Expected (per PRD §15.2):** "TypeScript: 5.x" floor.
**Actual (implementation):** Pinned `typescript@5.9.3`. Note that npm `dist-tags.latest` for `typescript` is now `6.0.3`, so "latest stable" technically means TS 6.
**Reason:** P0 prompt explicitly mandated "Latest stable TypeScript 5.x" — the prompt overrides the §0.1 floor-not-ceiling rule for this prompt.
**Impact:** None at P0. Phase F1 should reassess whether to bump to TS 6 or stay on 5.9.x for the monorepo.
**Decision:** Proceed on 5.9.3.
