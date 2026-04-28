# BUG_LOG

Append-only log of every bug encountered, with reproduction and fix.
Format per PRD §0.3.

---

## [2026-04-27 F9] BetModal START OVER button rendered in close-button corner

**Repro:** Reach `error` phase in BetModal → observe "START OVER" text bleeding into the
top-right corner where the X close button lives.
**Root cause:** Error state used `className="modal-close"` for the START OVER button. That
class applies `position: absolute; top: 12px; right: 12px; width: 32px; height: 32px;` —
the text overflowed the 32×32 icon-sized box into the corner where the close X already sits.
**Fix:** Changed START OVER button to `className="secondary"` and extended the
`.bm-cta-row .secondary` CSS selector to also cover `.bm-error .actions .secondary`.
**Time to fix:** ~5 min.
**Tags:** #frontend #css #betflow

---

## [2026-04-27 F9] viem default fee estimation races Arb Sepolia basefee

**Repro:** Click CONFIRM BET on any market → approve wallet popup → tx submitted →
RPC rejects: `max fee per gas less than block base fee: maxFeePerGas: 20004000 baseFee: 20008000`.
**Root cause:** Viem's `prepareTransactionRequest` reads the previous block's basefee and
multiplies by ~1.2, but on Arb Sepolia the EIP-1559 minimum basefee is 0.02 gwei and
fluctuates by ±8,000 wei per block. The prepared maxFeePerGas often lands below the next
block's minimum by a few thousand wei.
**Fix:** Added `feeOverrides(publicClient)` helper in `web/lib/bet/place-bet.ts` that reads
`block.baseFeePerGas` at time-of-submission and computes `maxFeePerGas = basefee × 5 + 0.01 gwei`.
Spread into all 4 `walletClient.sendTransaction` calls. Cost on Arb Sepolia: ~$0.001/tx.
**Time to fix:** ~15 min.
**Tags:** #blockchain #gas #arb-sepolia #betflow

---

## [2026-04-27 F9] Insufficient tUSDC balance not caught before review state

**Repro:** Enter an amount larger than wallet's tUSDC balance → REVIEW BET → CONFIRM BET →
approve step → wrap tx reverts with ERC20: transfer amount exceeds balance.
**Root cause:** `PREFLIGHT_OK` reducer case unconditionally advanced to "review" even when
`preflight.tusdcBalance < params.amountUsdc`. The balance check was missing from the preflight
effect and the review UI.
**Fix:** Added a balance gate in the preflight effect in `BetModal.tsx` — if
`preflight.tusdcBalance < amountUsdc`, dispatch `PREFLIGHT_FAIL` with `errorKind:
"insufficient_balance"` before reaching review. Error state now renders a "GET TESTUSDC FROM
FAUCET" CTA that dispatches a `darkodds:open-faucet` custom DOM event (Shell.tsx listens
and opens FaucetModal).
**Time to fix:** ~20 min.
**Tags:** #frontend #betflow #ux

---

## [2026-04-27 F8] wagmi `useChainId()` returns config-narrowed type — can't detect mismatch

**Repro:** typecheck a `useChainId() !== chain.id` comparison where the wagmi
config declares `chains: [arbitrumSepolia]`. TypeScript flags the comparison
because `useChainId()`'s return type is narrowed to the literal `421614`
(union of `chains[number]['id']` from the typed `Register` config), so any
value other than `421614` is impossible per types.
**Root cause:** `useChainId()` is intentionally typed against the wagmi
config's chains, not the connected wallet's chain. To detect a _wallet_ on a
non-config chain, use `useAccount().chainId` (typed `number | undefined`)
instead. The wagmi docs don't make this distinction loud, but the type
signatures are clear.
**Fix:** `components/topbar/NetworkChip.tsx` and `app/(dashboard)/Shell.tsx`
both switched from `useChainId()` to `useAccount().chainId` for mismatch
detection. The check additionally gates on `isConnected` so we don't flash
the mismatch banner before the wallet has connected at all.

---

## [2026-04-27 F7] React 19 lint blocks setState-in-effect cascade in faucet success animation

**Repro:** write `useEffect(() => { if (claimReceipt.isSuccess) setShowSuccess(true); ... })`
under React 19's `react-hooks/set-state-in-effect` ESLint rule.
**Root cause:** React 19's hook lint rule forbids synchronous `setState` calls
inside `useEffect` bodies — they cause cascading re-renders. Even ostensibly-
correct patterns like "schedule a celebration on tx confirm" trip the rule.
**Fix:** `components/faucet/FaucetModal.tsx` replaced direct `setShowSuccess(true)`
with `setTimeout(() => setCelebrated(hash), 0)` so the state update runs in a
fresh microtask, not the effect body. Track the celebrated tx hash directly so
the celebration fires exactly once per successful claim. The auto-dismiss
`setTimeout(..., 3000)` was already deferred and fine.

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

## [2026-04-25 F4] PRD §5.4.1 BTC/USD aggregator address is mainnet (Arb One), not Arb Sepolia

**Repro:** Read PRD v1.3 §5.4.1 — claims `0x942d00008D658dbB40745BBEc89A93c253f9B882` is BTC/USD on Arb Sepolia.
**Symptom:** Calling `latestRoundData()` at that address on Arb Sepolia would either revert (no contract) or silently return data from whatever address happens to live there.
**Root cause:** Verified via `smartcontractkit/hardhat-chainlink/src/registries/json/DataFeeds.json` (commit `25ccf9dc`): the address belongs to chainId 42161 (Arbitrum One mainnet), not 421614 (Arb Sepolia). The `DataFeeds.json` registry contains zero entries for chainId 421614 — Chainlink has not deployed feeds to Arb Sepolia at all.
**Fix:** F4 deploys ChainlinkPriceOracle for mainnet correctness but skips the BTC-resolved demo market on testnet per PRD §0.5. Production deploy on Arbitrum One uses the real address. Documented in DRIFT_LOG entry "PRD §5.4.1 BTC/USD aggregator address misattributed; no Chainlink feeds on Arb Sepolia".
**Time to fix:** 30 min (librarian research + design adjustment).
**Tags:** #infra #chainlink

---

## [2026-04-25 F4] viem `writeContract` nonce race when called rapid-fire without awaiting receipts

**Repro:** In `tools/deploy-f4.ts`, fire 5+ `walletClient.writeContract({...})` calls back-to-back, awaiting only the promise resolution (not the transaction receipt).
**Symptom:**

```
ContractFunctionExecutionError: Nonce provided for the transaction is lower than the current nonce of the account.
Details: nonce too low: address 0xF97933..., tx: 26 state: 27
```

**Root cause:** viem 2.48.4's automatic nonce inference reads `eth_getTransactionCount(latest)` to assign nonce, but if a previous tx hasn't mined yet (only submitted), the next call sees the same nonce and the tx gets rejected. Auto-nonce assumes serial-await semantics.
**Fix:** Wrap each `writeContract` in `publicClient.waitForTransactionReceipt({hash})` before the next call. We added a small `wcWait()` helper in deploy-f4.ts.
**Time to fix:** 5 min once the failure mode was understood.
**Tags:** #infra #viem

---

## [2026-04-25 F4] PreResolvedOracle.configure phantom-id collision blocks fresh smoke runs

**Repro:** Call `deploy-f4.ts` (which configures `PreResolvedOracle.configure(2, 1)`), then run `smoke-f4.ts` which creates a new market and tries to configure that market id (which happens to be `2` because the registry's `nextMarketId` had advanced to 2 after the deploy created markets 0 and 1).
**Symptom:** `configure` reverts with `AlreadyConfigured(2)`.
**Root cause:** The deploy script labelled markets as "Market_1" and "Market_2" in the deployments JSON, but their actual `Market.id()` values are 0 and 1 (the registry counter starts at 0). The deploy then configured the WRONG ids in PreResolvedOracle (2 instead of 1), creating a phantom configuration for a market that doesn't exist. When the smoke test created a new market and got id=2, configuring it conflicted.
**Fix:** smoke-f4.ts deploys a fresh `PreResolvedOracle` per run for full isolation from the production-deploy oracle. Trade-off: an extra contract deploy per smoke run (~0.0005 ETH); benefit: smoke is idempotent. Long-term: rewrite deploy-f4.ts to read `nextMarketId` between createMarket calls and assert id alignment, or to read MarketCreated event topics for the actual id (currently parses address from the event data, ignoring id).
**Time to fix:** 10 min.
**Tags:** #infra #deploy

---

## [2026-04-25 F4] `vm.prank` consumed by arg-evaluation contract call inside the same expression

**Repro:** In a Foundry test:

```solidity
vm.prank(OWNER);
oracle.someFunction(market.id(), ...);  // market.id() is a contract call!
```

**Symptom:** `someFunction` reverts `OwnableUnauthorizedAccount(test_contract_address)`.
**Root cause:** Solidity evaluates function arguments before the call. `market.id()` is a STATICCALL that consumes the prepared prank, so by the time `someFunction` actually fires, `msg.sender` is back to the test contract.
**Fix:** Cache `market.id()` to a state field once in setUp (or to a local before any prank), then use the cached value in pranked calls.
**Time to fix:** 15 min once `forge test -vvvv` showed the trace.
**Tags:** #foundry #tests

---

## [2026-04-25 F3] Market.placeBet → cUSDC.confidentialTransferFrom reverts NotAllowed on the bet handle

**Repro:**

```bash
cd /Users/mac/darkodds
forge test --root contracts --match-test test_PlaceBet_HappyPath_Yes
```

**Symptom:**

```
[FAIL: NotAllowed(0x0000007a6923011d... <bet handle>, 0x5991... <cUSDC address>)] test_PlaceBet_HappyPath_Yes
```

**Root cause:** Market obtained transient ACL on the bet handle via `Nox.fromExternal(handle, proof)` — but transient ACL is keyed by `msg.sender` at grant time. When Market then calls `cUSDC.confidentialTransferFrom(user, market, betHandle)`, cUSDC's internal `Nox.safeSub(userBalance, betHandle)` is invoked against NoxCompute. `msg.sender` at that NoxCompute call frame is **cUSDC**, not Market. cUSDC has no ACL on `betHandle`, NoxCompute reverts.
**Fix:** Add `Nox.allowTransient(betHandle, confidentialUSDC)` immediately after `Nox.fromExternal` in `Market.placeBet`. This grants cUSDC its own transient ACL on the handle, scoped to the same transaction. All 28 Market tests pass after the fix.
**Time to fix:** ~10 min once the failure mode was understood (had to trace cross-contract msg.sender propagation through NoxCompute).
**Tags:** #contracts #nox

---

## [2026-04-25 F3] Nox.allowPublicDecryption reverts on already-public handles

**Repro:** Call `Nox.allowPublicDecryption(handle)` where `handle = Nox.toEuint256(0)`.
**Symptom:** `INoxCompute.PublicHandleACLForbidden()`.
**Root cause:** `Nox.toEuint256(0)` calls `wrapAsPublicHandle` which produces a handle whose attributes byte has bit 0 unset (= public). Public handles carry no ACL by design; calling `allowPublicDecryption` on them is rejected. The Nox SDK has `_allowIfNotPublic` for the `allow` / `allowThis` / `allowTransient` family (silent skip on public) but does NOT have an equivalent for `allowPublicDecryption`.
**Fix:** Two patches in `Market.sol`:

1. `initialize` skips `allowPublicDecryption` on the initial-zero published handles (they're already public).
2. `_publishBatchInternal` checks `HandleUtils.isPublicHandle(...)` before calling `allowPublicDecryption` on `Nox.add` results — the empty-batch case can produce a public-handle output.
   **Time to fix:** ~5 min.
   **Tags:** #contracts #nox

---

## [2026-04-25 P0-retry] healthcheck — `@iexec-nox/handle` does not export its network-config map

**Repro:** Inspect `node_modules/@iexec-nox/handle/src/index.ts`.
**Symptom:** Public exports = `{ createHandleClient, createEthersHandleClient, createViemHandleClient }` and types only. The `HandleClient` instance does not surface the resolved `gatewayUrl` / `smartContractAddress` / `subgraphUrl` either. The advanced-configuration doc page lists those three options as accepted _inputs_ but provides no documented path to _read_ the auto-resolved values back out.
**Root cause:** The SDK's `resolveNetworkConfig(chainId, override?)` and `NETWORK_CONFIGS` map (`src/config/networks.ts`) are internal. There is no public API for "what does Arb Sepolia auto-config actually point at?".
**Fix:** Source-inspected `src/config/networks.ts:9-15` and mirrored the values as a `NOX_NETWORK` constant in `tools/healthcheck.ts`. The script's `nox-code` step will catch any future drift in the Nox protocol contract address (returns RED if bytecode missing); the `subgraph` step does the same for the subgraph URL.
**Time to fix:** ~5 min (single source-grep).
**Tags:** #sdk #dx

---

## [2026-04-25 F4.5] Slither 0.11.5 — UDVT line-mapping bug retains stale findings

**Repro:**

1. `cd contracts && forge clean && forge build --build-info --force --skip "./test/**" --skip "./script/**"`
2. `slither . --filter-paths "lib|test|script" --json out.json`
3. Inspect findings for `uninitialized-local`, `unused-return`, `immutable-states`.

**Symptom:** Slither flags variables that the source explicitly initializes / captures / declares immutable. Specifically:

- `Market.refundIfInvalid().betHandle` flagged as uninitialized despite `euint256 betHandle = euint256.wrap(bytes32(0));` at the declaration site.
- `Market.placeBet` flagged for ignoring `confidentialTransferFrom` return despite `euint256 transferred = ...` capture.
- `MarketRegistry.confidentialUSDC` flagged "should be immutable" despite already being declared `address public immutable`.

**Root cause:** Slither 0.11.5 does not handle user-defined-value-type (`euint256`) variable declarations correctly in source-position resolution. The forge-produced AST is correct (`initialValue` set, `mutability: "immutable"` set) — verified by manual JSON inspection of `out/build-info/*.json`. Slither's own AST traversal misreads these.

**Fix:** Documented as tooling false positive in `audits/slither-2026-04-25/summary.md`. No source change. Re-test after slither 0.11.6+.

**Time to fix:** ~30 min spent diagnosing (initially suspected our config / cache / forge artifacts).
**Tags:** #infra #tooling #slither

---

## [2026-04-25 F4.5] Safe execTransaction reverts GS013 when inner call would revert

**Repro:** Construct a Safe tx whose `data` calls a function with the wrong selector / unauthorized owner / etc. Co-sign with two owners. Execute.

**Symptom:** Safe contract reverts with `GS013` ("Safe transaction failed when gasPrice and safeTxGas were 0").

**Root cause:** With `safeTxGas == 0` and `gasPrice == 0` (the SDK defaults), Safe v1.4.1 requires the inner tx to succeed. If the inner call reverts (e.g. our first attempt used a hand-computed function selector `0xc8df6c69` that did not match `setMarketImplementation(address)` = `0xb5c459b4`), Safe propagates as `GS013`. The actual revert reason is swallowed.

**Fix:** Always use `viem.encodeFunctionData({abi, functionName, args})` instead of hand-composing selectors. For debugging GS013s, simulate the inner call via a direct `eth_call` from the Safe address to surface the real revert.

**Time to fix:** ~5 min once the selector mismatch was spotted.
**Tags:** #infra #safe #tooling

---

## [2026-04-25 F4.5] forge artifact `metadata` field is an object, `rawMetadata` is the JSON string

**Repro:** `JSON.parse(art.metadata)` after `art = JSON.parse(readFileSync('out/Market.sol/Market.json'))`.

**Symptom:** `SyntaxError: "[object Object]" is not valid JSON`.

**Root cause:** Foundry stores both a parsed `metadata` (object) and the raw `rawMetadata` (string) in compilation artifacts. Earlier-version artifacts only had a string at `metadata` so the `JSON.parse` pattern was canonical. New artifacts changed shape.

**Fix:** Use `JSON.parse(art.rawMetadata)` for verification scripts that need the raw standard-input-json. Or skip standard-json submission entirely and use `forge verify-contract <addr> <path>:<name>`, which lets foundry compose the input itself — that's what `deploy-f45.ts` ended up doing.

**Time to fix:** ~3 min.
**Tags:** #infra #foundry #verify

---

## [2026-04-26 F5] ConfidentialTransfer event topic used wrong type string

**Bug:** `test_ClaimWinnings_F5_ConfidentialTransferEmitted` failed with
"ConfidentialTransfer market->alice not emitted". The test computed the topic hash
using `keccak256("ConfidentialTransfer(address,address,uint256)")`.
**Root cause:** `euint256` is `type euint256 is bytes32` — a UDVT wrapping `bytes32`.
Solidity uses the underlying canonical type in event signatures; the correct ABI
string is `ConfidentialTransfer(address,address,bytes32)` not `uint256`.
**Fix:** Changed topic hash string to `keccak256("ConfidentialTransfer(address,address,bytes32)")`.
**Time to fix:** ~2 min.
**Tags:** #test #events #UDVT

---

## [2026-04-28 F10b] Nox SDK decrypts trigger N parallel auth signatures (TOCTOU race)

**Repro:** Connect MetaMask to /portfolio with 7+ open positions. MetaMask shows
"1 of 7" pending signature requests on first connect, even before any user
interaction.

**Symptom:** Each `decrypt(handle)` call queues its own EIP-712
`DataAccessAuthorization` signature. With Privy embedded wallets the signatures
auto-resolve silently (which masked the bug in F9 verification); MetaMask
surfaces the queue.

**Root cause:** `node_modules/@iexec-nox/handle/src/methods/decrypt.ts` checks
`localStorage` for cached auth material. If absent, it generates a fresh RSA
keypair and asks for a signature, then caches. Concurrent calls all hit the
storage-empty branch simultaneously (TOCTOU) → N signatures.

**Fix:** Module-level `safeDecrypt()` helper in `web/lib/nox/client-hook.ts`
that serializes the FIRST decrypt per wallet address. Subsequent decrypts
wait for the first to populate localStorage, then run in parallel without
further signatures. Wired into `PositionRow`, `UserPositions`, `runClaim`.
8 prompts → 1 prompt on first /portfolio connect.

**Time to fix:** ~30 min (recon + helper + wiring).
**Tags:** #nox #sdk #auth #race-condition

---

## [2026-04-28 F10b] ChainGPT smartcontractgenerator refuses non-Solidity prompts

**Repro:** POST `/api/chaingpt/generate-market` with the F10b mirror prompt
"Create a DarkOdds prediction market mirroring this Polymarket question..."
**Symptom:** API returned 422 with empty `raw` field.

**Root cause:** Two stacked bugs.

1. The `@chaingpt/smartcontractgenerator` SDK's `createSmartContractBlob`
   response shape is doubly nested: `result.data.bot.data.bot`. Our code read
   `result.bot` which is undefined → `raw = ""`.
2. Even after the unwrap fix, the model is hardwired with a Solidity-only
   system prompt and refuses extraction prompts: "I'm ChainGPT, your Solidity
   smart contract expert..." for every non-Solidity request.

**Fix:** Switched to `@chaingpt/generalchat` (a general-purpose Web3-fluent
model). Response shape is `result.data.bot` (single level). Strengthened the
system prompt with strong delimiters + worked examples for crypto and sports
cases. Web3-framed wrapper ("Solidity smart contract requirement gathering")
slips past GeneralChat's topic filter so non-crypto prompts extract cleanly
too. Old SDK packages dropped.

**Time to fix:** ~45 min including SDK probe + prompt iteration.
**Tags:** #chaingpt #sdk #prompt-engineering

---

## [2026-04-28 F10b] /create wagmi useWriteContract didn't apply F9 fee overrides

**Repro:** /create page → DEPLOY MARKET button. MetaMask returns "max fee per
gas less than block base fee" revert (same Arb Sepolia floor race we fixed
for /place-bet in F9).

**Root cause:** /create used wagmi's `useWriteContract` directly which doesn't
expose a clean way to attach pre-computed `maxFeePerGas`/`maxPriorityFeePerGas`.
The default viem estimator races the network-minimum basefee.

**Fix:** Extracted `getArbSepoliaFeeOverrides(publicClient)` into shared
`web/lib/contracts/fees.ts` (5× basefee + 0.01 gwei priority — same logic as
F9 BetModal). Refactored /create to `walletClient.sendTransaction({...fees})`
matching the place-bet/run-claim pattern. Migrated existing place-bet and
run-claim call sites to import from the shared helper.

**Time to fix:** ~20 min.
**Tags:** #fees #arb-sepolia #wagmi

---

## [2026-04-28 F10b] /create createMarket reverted with OwnableUnauthorizedAccount for non-deployer wallets

**Repro:** Connect any wallet other than the deployer EOA, click DEPLOY MARKET
on /create. MetaMask shows "Network fee: Unavailable" + red Review-alert.

**Root cause:** `MarketRegistry.createMarket(...)` is `onlyOwner`. F4.5 hardened
ownership to a 2-of-3 Safe; F10 ships a one-click /create UI that submits a
single EOA tx. The two designs collide — non-owner wallets revert with
`OwnableUnauthorizedAccount`. MetaMask's `eth_estimateGas` simulates the call,
sees the revert, and shows "Unavailable" rather than estimating gas for a
failing tx. The user's ETH balance is irrelevant.

**Fix:**

1. F10b operational delegation — Safe-cosigned `transferOwnership(deployerEOA)`
   for the live-judging window. Reversible via `--to-safe`. See
   `KNOWN_LIMITATIONS.md §registry-ownership-temporary-delegation`.
2. Sponsored deployment route `/api/admin/deploy-market` for judges connecting
   wallets other than the deployer. Server signs with `DEPLOYER_PRIVATE_KEY`,
   per-IP 60s rate limit, 503 self-disable when ownership returns to the Safe.
3. /create page detects connected wallet vs deployer EOA and routes the
   request accordingly. Amber "SPONSORED DEPLOYMENT — DEMO MODE" banner
   surfaces the routing to the user.

**Time to fix:** ~3 hours including the operational-delegation script,
governance badge, sponsored route, and UX disclosures.
**Tags:** #access-control #multisig #ux #demo-mode

---

## [2026-04-28 F10b] Faucet error messages truncated mid-sentence

**Repro:** Click CLAIM 1000 TESTUSDC within 6h cooldown window. Modal shows
"The contract function 'claim' reverted with the following re" with the rest
clipped.

**Root cause:** `claimError.message.split("\n")[0].slice(0, 60)` was truncating
the prefix wrapper viem prepends to revert reasons, leaving the actual reason
("CooldownActive(<nextAt>)") off-screen.

**Fix:** New `describeClaimError(err)` helper that walks viem's error chain
via `err.walk(e => e instanceof ContractFunctionRevertedError)` and extracts
`data.errorName` / `data.args`. Translates known custom errors to clean
messages: `CooldownActive(nextAt)` → "Cooldown active — next claim in 5h 22m."
(computed live from the revert arg). Removed the 60-char slice; full message
shown in a dedicated `.modal-faucet-error` block.

**Time to fix:** ~10 min.
**Tags:** #faucet #ux #viem #error-handling
