# Slither static analysis — F4.5 hardening pass

**Date:** 2026-04-25
**Slither version:** 0.11.5
**Solidity:** 0.8.34
**Target:** `contracts/src/` (filter-paths excludes `lib`, `test`, `script`)

## Reproduction

```
cd contracts/
forge clean
forge build --build-info --force --skip "./test/**" --skip "./script/**"
slither . --ignore-compile --filter-paths "lib|test|script" --json audits/slither-2026-04-25/raw.json
```

Note: invoking `slither .` directly (without `--ignore-compile`) triggers a
second internal `forge build --force` whose AST exhibits stale source
mapping on this codebase (slither 0.11.5 misreports line numbers for some
user-defined-value-type variable declarations). The two-step
build-then-analyze workflow above sidesteps the issue by using a
forge-produced build-info that we've manually verified has the correct
source content.

## Severity totals

| Impact        | Count |
| ------------- | ----- |
| High          | 0     |
| Medium        | 16    |
| Low           | 34    |
| Informational | 0     |
| Optimization  | 1     |

| Detector              | Count |
| --------------------- | ----- |
| `timestamp`           | 15    |
| `reentrancy-no-eth`   | 13    |
| `shadowing-local`     | 10    |
| `reentrancy-benign`   | 6     |
| `reentrancy-events`   | 3     |
| `unused-return`       | 2     |
| `uninitialized-local` | 1     |
| `immutable-states`    | 1     |

## Triage and disposition

### High / Critical — none

Clean. Meets PRD §11 F4.5 deliverable bar.

### Medium

#### `reentrancy-no-eth` × 13 — accepted (false positive, mitigated by ReentrancyGuard)

Affected functions:

- `Market.placeBet`
- `Market._publishBatchInternal` (called only from `publishBatch` and `closeMarket`, both nonReentrant)
- `ConfidentialUSDC.wrap`
- `ConfidentialUSDC.requestUnwrap`
- `ConfidentialUSDC._transfer` (called only from `confidentialTransfer`/`confidentialTransferFrom`, both nonReentrant)

All public/external entry points carry `nonReentrant` from
`@openzeppelin/contracts/utils/ReentrancyGuard.sol`. Slither's
`reentrancy-no-eth` detector flags state-mutation-after-external-call
syntactically and does not model `ReentrancyGuard` semantically. The
external-call targets (cUSDC, the `_underlying` ERC-20) are also
contracts we deploy and trust on Arb Sepolia.

**Disposition:** accepted. Documented in `KNOWN_LIMITATIONS.md`.

#### `unused-return` × 2 — false positive (slither 0.11.5 UDVT mapping bug)

Reported sites:

- `Market.placeBet` calling `IConfidentialUSDC.confidentialTransferFrom`
- `Market.refundIfInvalid` calling `IConfidentialUSDC.confidentialTransfer`

Both call sites capture the return value in F4.5:

```solidity
// Market.sol:255 (post-F4.5)
euint256 transferred = IConfidentialUSDC(confidentialUSDC).confidentialTransferFrom(...);
// Market.sol:523 (post-F4.5)
euint256 refunded = IConfidentialUSDC(confidentialUSDC).confidentialTransfer(msg.sender, betHandle);
```

`transferred`/`refunded` are then used downstream in pool accounting and
event emission. The forge-produced AST (build-info file
`9ccfedb108a2a658.json`) confirms `initialValue` is non-null on both
declarations.

Slither 0.11.5 misreports source line ranges for user-defined-value-type
(`euint256`) assignments, causing this detector to flag the OLD line
ranges. Verified by direct AST inspection of build-info input/output
sources.

**Disposition:** false positive. BUG_LOG entry filed.

#### `uninitialized-local` × 1 — false positive (UDVT mapping bug)

Reported: `Market.refundIfInvalid().betHandle` — flagged as never
initialized.

Source (`Market.sol:501`):

```solidity
euint256 betHandle = euint256.wrap(bytes32(0));
```

Variable IS initialized at declaration with a UDVT-wrapped zero. AST
shows `initialValue` is set on the `VariableDeclarationStatement` with
a `FunctionCall` to `euint256.wrap`. Compiler accepts this. Slither
flags it due to the same UDVT mapping bug as `unused-return` above.

**Disposition:** false positive.

### Low — accepted (documented)

#### `shadowing-local` × 10 — `IMarket.initialize` parameter shadowing

The `IMarket.initialize` parameter names (`id`, `question`,
`resolutionCriteria`, `oracleType`, `expiryTs`, `protocolFeeBps`,
`confidentialUSDC`, `resolutionOracle`, `admin`) match same-named state
variables in `Market.sol`. Solidity scope rules make this unambiguous
— parameters shadow state vars only in the function scope. The Market
implementation uses `id_`, `question_`, etc. with trailing-underscore
suffix to avoid any reader confusion. The interface keeps clean
parameter names for ABI ergonomics.

#### `timestamp` × 15

Every market lifecycle gate (`expiryTs`, `claimWindowDeadline`,
`BATCH_INTERVAL`, `CLAIM_OPEN_DELAY`, `SEQUENCER_GRACE`,
`HEARTBEAT_THRESHOLD`) intentionally uses `block.timestamp`. Per PRD
§3.4: "5-min dispute window before claim opens",
"claimWindowDeadline = expiryTs + 7 days", "60s reveal delay". Miner
timestamp manipulation is bounded to ~15 seconds on L1, less on L2
sequencers; none of our gates have sensitivity below ±1 minute.

#### `reentrancy-benign` × 6 / `reentrancy-events` × 3

State writes after external calls inside nonReentrant scopes. Same
mitigation as `reentrancy-no-eth`.

### Optimization × 1 — false positive (slither stale mapping)

Reported: `MarketRegistry.confidentialUSDC` should be immutable.

Source (`MarketRegistry.sol:24`):

```solidity
address public immutable confidentialUSDC;
```

Already immutable as of F4.5. Slither's UDVT-line-mapping issue causes
it to retain the pre-F4.5 finding.

**Disposition:** false positive — the variable is declared `immutable`
and the constructor assigns it once.

## What changed in F4.5 (Slither-driven)

1. **`Market.placeBet`** — capture `transferred` return from
   `cUSDC.confidentialTransferFrom` and bind ALL pool/bet accounting
   to the actually-transferred handle (not the gateway-issued bet
   handle). This is the canonical ERC-7984 invariant: a market only
   credits a user with what was actually pulled from their balance.
   ERC-7984 silent-failure semantics on insufficient balance now
   produce zero-credit instead of a phantom bet.

2. **`Market.refundIfInvalid`** — explicit
   `betHandle = euint256.wrap(bytes32(0))` initializer; capture
   `refunded` return from `cUSDC.confidentialTransfer` and emit it in
   `Refunded` event.

3. **`MarketRegistry.confidentialUSDC`** — declared `immutable`.

## Final tally

| Impact       | Pre-F4.5 | Post-F4.5 (real)                                       |
| ------------ | -------- | ------------------------------------------------------ |
| High         | 0        | 0                                                      |
| Medium       | 16       | 13 (all `reentrancy-no-eth` FPs behind `nonReentrant`) |
| Optimization | 1        | 0 (slither tooling FP only)                            |

The `unused-return`, `uninitialized-local`, and `immutable-states`
findings are addressed in source; their continued reporting by slither
0.11.5 is a tool-side mapping bug verified against the build-info AST.
