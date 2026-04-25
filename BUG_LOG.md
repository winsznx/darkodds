# BUG_LOG

Append-only log of every bug encountered, with reproduction and fix.
Format per PRD §0.3.

---

## [2026-04-25 P0] healthcheck — decrypt fails because handle was never committed on-chain (PRD misspec, not a Nox infra failure)

**Repro:**

```bash
cd /Users/mac/darkodds
pnpm install
pnpm run healthcheck
```

With:

- `@iexec-nox/handle@0.1.0-beta.10`
- `viem@2.48.4`
- RPC `https://sepolia-rollup.arbitrum.io/rpc` (chainId 421614 confirmed via `eth_chainId`)
- Ephemeral private key, value `42n`, solidityType `'uint256'`, `applicationContract = ephemeral EOA address`.

**Symptom:**
Steps `rpc`, `client`, `encrypt` PASS. Step `decrypt` FAILS with:

```
Error: Handle (0x0000066eee2301552d4c3a1cd7deebc8ea1b5c9f8db437cdba1a4157d7a9841c) does not exist or user (0x51c4454336b29a0E4c148658816b3A81d9767e9b) is not authorized to decrypt it
    at decrypt (.../@iexec-nox/handle/src/methods/decrypt.ts:62:11)
```

Latency table from the failed run:
| step | status | latency |
|---------|--------|---------|
| rpc | PASS | 654ms |
| client | PASS | 279ms |
| encrypt | PASS | 1606ms |
| decrypt | FAIL | 567ms |

The encrypt call produced a well-formed `0x`-prefixed 32-byte handle and a proof. The handle's leading 6 nibbles (`0x000006`) decode to chainId `66eee` = 421614 — confirming the gateway issued an Arbitrum-Sepolia-bound handle correctly.

**Root cause:**
By design, the Nox handle ACL lives **on-chain** in the Nox protocol contract pointed at by `config.smartContractAddress`. The decrypt path performs an on-chain `eth_call` to `isViewer(handle, userAddress)` (see `decrypt.ts:56-65`); if the handle has never been written to that contract's storage, `isViewer` returns false and the SDK throws.

`encryptInput` only POSTs to the Handle Gateway's `/v0/secrets` endpoint (see `encryptInput.ts:146-154`). That call:

1. Stores the ciphertext at the gateway.
2. Returns a `handle` and an EIP-712 `handleProof`.
3. Does **NOT** write anything on-chain.

The on-chain commit happens later, when the `applicationContract` (the address bound at encrypt time) calls Nox's `fromExternal(handle, proof)`. That call validates the proof and registers the handle in the on-chain ACL with the appropriate viewer/admin grants — and only after that point does decrypt succeed and viewACL return non-empty results.

The PRD §11 P0 expects a pure SDK round-trip — encrypt → decrypt → viewACL — without deploying any contract. Per the SDK architecture, **that round-trip is not possible**. The PRD is misspecified for this gate.

**Fix:**
NOT applied per prompt rules ("DO NOT invent a workaround. DO NOT mock the response. Stop. Wait for operator decision.").

Three viable operator paths, ranked by alignment with PRD intent:

1. **Redefine the gate (recommended).** Change P0's success criterion from "encrypt → decrypt → viewACL round-trip" to "encrypt produces a chainId-bound handle + valid proof" + "RPC and Nox protocol contract reachable on chain". This is what Nox actually offers off-chain. The encrypt + RPC + client steps already validate the entire off-chain path; full decrypt round-trip should belong to a Phase F2 integration test that runs against a deployed `ConfidentialUSDC` (which calls `fromExternal` in `wrap()`).

2. **Deploy a minimal Nox-aware committer contract for the gate.** Deploy a 30-line contract whose only purpose is to take a handle+proof, call `fromExternal`, and grant the EOA viewer/admin. This costs Foundry setup that the prompt explicitly forbids ("Do not initialize Foundry. Do not touch contracts").

3. **Use a pre-deployed Nox example contract on Arbitrum Sepolia, if one exists, and submit the proof to it.** Requires the operator to confirm such a public test contract exists and provide its address.

Path (1) is the doc-correct adjustment per §0.1 ("docs win") and unblocks P0 cleanly. Path (2) violates the prompt's hard-stop on Foundry. Path (3) requires external info this agent does not have.

**Time to fix:** Resolved by operator with PRD v1.2 §11 P0 rewrite (path 1 — redefine the gate). See `DRIFT_LOG.md` "Active PRD bumped v1.1 → v1.2".
**Tags:** #sdk #infra #tee

---

## [2026-04-25 F2] forge create / forge script fail against public Arb Sepolia RPC

**Repro:**

```bash
cd /Users/mac/darkodds/contracts
forge create src/TestUSDC.sol:TestUSDC \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --constructor-args $DEPLOYER
```

**Symptom:**

```
ERROR alloy_provider::blocks: failed to fetch block number=262821916
err=deserialization error: missing field `timestampMillis`
Error: contract was not deployed
```

**Root cause:** Foundry 1.6.0's alloy expects `timestampMillis` in `eth_getBlockByNumber` responses. Arbitrum's RPC returns standard `timestamp` only (in seconds). `timestampMillis` is an Alchemy-flavored extension, not a core EIP field.
**Fix:** Deploy via viem in `tools/deploy-f2.ts` instead. viem doesn't have this strictness. We retain `contracts/script/DeployF2.s.sol` as documentation of the canonical broadcast pattern; the active deployer is TS.
**Time to fix:** ~20 min (write viem deployer + wire `pnpm deploy:f2`).
**Tags:** #infra #foundry

---

## [2026-04-25 F2] forge verify-contract requires ETHERSCAN_API_KEY env var even for Blockscout

**Repro:** `forge verify-contract <addr> --verifier blockscout --verifier-url 'https://...'` without setting `ETHERSCAN_API_KEY`.
**Symptom:** `Error: environment variable ETHERSCAN_API_KEY not found`.
**Root cause:** Foundry 1.6.0 unconditionally checks for the env var regardless of `--verifier` choice.
**Fix:** Set `ETHERSCAN_API_KEY=blockscout` (any non-empty string). Blockscout ignores it.
**Time to fix:** 30s.
**Tags:** #infra #foundry

---

## [2026-04-25 F2] Arbiscan V1 verification API deprecated; must use Etherscan V2

**Repro:** `forge verify-contract --verifier-url 'https://api-sepolia.arbiscan.io/api' ...`
**Symptom:** `You are using a deprecated V1 endpoint, switch to Etherscan API V2`. Verification fails with "Failed to obtain contract ABI for ...".
**Root cause:** Arbiscan migrated to the unified Etherscan V2 API. The V1 endpoint returns an error string instead of JSON.
**Fix:** Use `--verifier-url 'https://api.etherscan.io/v2/api?chainid=421614'` with the same Etherscan API key. Worked first try.
**Time to fix:** 1 min once identified.
**Tags:** #infra #etherscan

---

## [2026-04-25 P0-retry] healthcheck — `@iexec-nox/handle` does not export its network-config map

**Repro:** Inspect `node_modules/@iexec-nox/handle/src/index.ts`.
**Symptom:** Public exports = `{ createHandleClient, createEthersHandleClient, createViemHandleClient }` and types only. The `HandleClient` instance does not surface the resolved `gatewayUrl` / `smartContractAddress` / `subgraphUrl` either. The advanced-configuration doc page lists those three options as accepted _inputs_ but provides no documented path to _read_ the auto-resolved values back out.
**Root cause:** The SDK's `resolveNetworkConfig(chainId, override?)` and `NETWORK_CONFIGS` map (`src/config/networks.ts`) are internal. There is no public API for "what does Arb Sepolia auto-config actually point at?".
**Fix:** Source-inspected `src/config/networks.ts:9-15` and mirrored the values as a `NOX_NETWORK` constant in `tools/healthcheck.ts`. The script's `nox-code` step will catch any future drift in the Nox protocol contract address (returns RED if bytecode missing); the `subgraph` step does the same for the subgraph URL.
**Time to fix:** ~5 min (single source-grep).
**Tags:** #sdk #dx
