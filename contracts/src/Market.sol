// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import "encrypted-types/EncryptedTypes.sol";
import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {HandleUtils} from "@iexec-nox/nox-protocol-contracts/contracts/shared/HandleUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMarket} from "./interfaces/IMarket.sol";
import {IConfidentialUSDC} from "./interfaces/IConfidentialUSDC.sol";
import {IResolutionOracle} from "./interfaces/IResolutionOracle.sol";

/// @title Market
/// @notice Single confidential prediction market. Per-market clone (EIP-1167 minimal
///         proxy) of an unitialised template; initialised once by `MarketRegistry`.
///
///         Implements the lazy public-decryption pattern from PRD §6.2:
///         - placeBet credits a TEE-only batch handle (no public delta leaks)
///         - publishBatch (permissionless after 60s) folds the batch into the
///           publicly-decryptable running total and resets the accumulator
///         - The batch event reveals the count of bets in the window only — sizes
///           remain individually private; bets within a batch are indistinguishable
contract Market is IMarket, ReentrancyGuard {
    // ====================================================================
    // Errors
    // ====================================================================

    error AlreadyInitialized();
    error InvalidExpiry();
    error InvalidFee();
    error InvalidConfidentialUSDC();
    error InvalidResolutionOracle();
    error InvalidAdmin();
    error InvalidOracleType(uint8 oracleType);
    error InvalidSide(uint8 side);
    error InvalidOutcome(uint8 outcome);
    error WrongState(State expected, State actual);
    error MarketExpired();
    error MarketNotExpired();
    error AlreadyBetThisSide(address user, uint8 side);
    error BatchIntervalNotElapsed(uint256 nextAt);
    error ClaimWindowNotElapsed(uint256 deadline);
    error NotInResolvableState();
    error OracleNotReady();
    error OnlyAdmin();
    error ClaimWindowNotOpen(uint256 opensAt);
    error AlreadyClaimed();
    error NoWinningPosition();
    error NoBetToRefund();
    error NotInvalid();

    // ====================================================================
    // Constants
    // ====================================================================

    /// @dev Per PRD §3.3 step E.1 — bets accumulate in a 60s window before
    ///      publication. This is a privacy primitive, not a UX knob.
    uint256 public constant BATCH_INTERVAL = 60 seconds;

    /// @dev Per PRD §5.3 — griefing guard: if no resolution happens within
    ///      7 days of expiry, anyone can flip the market to Invalid.
    uint256 public constant CLAIM_WINDOW = 7 days;

    /// @dev Per PRD §3.4 — MEV mitigation: claim window opens 60 seconds
    ///      after the pool is frozen, giving claimers time to react without
    ///      a watcher front-running the first claim.
    uint256 public constant CLAIM_OPEN_DELAY = 60 seconds;

    /// @dev Max basis points (10_000 = 100%). Sanity check on protocolFeeBps.
    uint256 public constant MAX_FEE_BPS = 1_000; // 10% upper bound

    // ====================================================================
    // Storage (clone-friendly — no `immutable` since we use minimal proxies)
    // ====================================================================

    bool private _initialized;

    uint256 public id;
    string public question;
    string public resolutionCriteria;
    uint8 public oracleType;
    uint256 public expiryTs;
    uint256 public claimWindowDeadline;
    uint256 public protocolFeeBps;
    State private _state;
    uint8 private _outcome;
    address public admin;
    address public confidentialUSDC;
    address public resolutionOracle;

    /// @dev Plaintext snapshot of the YES/NO pool sizes after `freezePool`.
    ///      Per PRD §6.1: post-resolution privacy on the aggregate is not
    ///      required since the outcome is public and proportional payout
    ///      requires the pool ratio. Per-bet handles remain ACL'd to users.
    uint256 public yesPoolFrozen;
    uint256 public noPoolFrozen;
    uint256 public resolutionTs;
    uint256 public poolFrozenTs;
    uint256 public claimWindowOpensAt;

    /// @dev TEE-only encrypted accumulators. ACL: this contract only.
    ///      Reset to encrypted zero at every publishBatch.
    euint256 private _yesPoolBatch;
    euint256 private _noPoolBatch;

    /// @dev Publicly-decryptable running totals. ACL: public-decryptable.
    ///      Updated at every publishBatch by adding the batch into the running total.
    euint256 private _yesPoolPublished;
    euint256 private _noPoolPublished;

    uint256 public lastBatchTs;
    uint256 public batchCount;
    uint256 public totalBetCount;
    uint256 public pendingBatchBetCount;

    /// @dev Per-user encrypted bet handles. ACL: user + this contract.
    mapping(address user => euint256) private _yesBet;
    mapping(address user => euint256) private _noBet;
    mapping(address user => bool) private _claimed;

    // ====================================================================
    // Initialization
    // ====================================================================

    function initialize(
        uint256 id_,
        string calldata question_,
        string calldata resolutionCriteria_,
        uint8 oracleType_,
        uint256 expiryTs_,
        uint256 protocolFeeBps_,
        address confidentialUSDC_,
        address resolutionOracle_,
        address admin_
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (expiryTs_ <= block.timestamp) revert InvalidExpiry();
        if (protocolFeeBps_ > MAX_FEE_BPS) revert InvalidFee();
        if (confidentialUSDC_ == address(0)) revert InvalidConfidentialUSDC();
        if (resolutionOracle_ == address(0)) revert InvalidResolutionOracle();
        if (admin_ == address(0)) revert InvalidAdmin();
        if (oracleType_ > 2) revert InvalidOracleType(oracleType_);

        _initialized = true;
        id = id_;
        question = question_;
        resolutionCriteria = resolutionCriteria_;
        oracleType = oracleType_;
        expiryTs = expiryTs_;
        claimWindowDeadline = expiryTs_ + CLAIM_WINDOW;
        protocolFeeBps = protocolFeeBps_;
        confidentialUSDC = confidentialUSDC_;
        resolutionOracle = resolutionOracle_;
        admin = admin_;
        _state = State.Open;
        _outcome = uint8(Outcome.INVALID);

        // Initial encrypted accumulator state: zero. Public handles since the
        // initial value is plaintext-known (zero); they become unique after the
        // first add operation.
        _yesPoolBatch = Nox.toEuint256(0);
        _noPoolBatch = Nox.toEuint256(0);
        _yesPoolPublished = Nox.toEuint256(0);
        _noPoolPublished = Nox.toEuint256(0);
        // The initial published totals are *public handles* (Nox.toEuint256
        // wraps a plaintext into a public-by-construction handle) so they
        // are already publicly readable — calling allowPublicDecryption on a
        // public handle reverts with PublicHandleACLForbidden. Skipped here.

        lastBatchTs = block.timestamp;

        emit Initialized(id_, expiryTs_, protocolFeeBps_);
    }

    // ====================================================================
    // Read accessors (some have to be functions because `state`/`outcome`
    // are reserved-ish names and the IMarket interface mandates an `outcome()`
    // returning `uint8`)
    // ====================================================================

    function state() external view returns (State) {
        return _state;
    }

    function outcome() external view returns (uint8) {
        return _outcome;
    }

    function yesPoolPublishedHandle() external view returns (euint256) {
        return _yesPoolPublished;
    }

    function noPoolPublishedHandle() external view returns (euint256) {
        return _noPoolPublished;
    }

    function yesBet(address user) external view returns (euint256) {
        return _yesBet[user];
    }

    function noBet(address user) external view returns (euint256) {
        return _noBet[user];
    }

    function claimed(address user) external view returns (bool) {
        return _claimed[user];
    }

    // ====================================================================
    // placeBet
    // ====================================================================

    function placeBet(
        uint8 side,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external nonReentrant {
        if (_state != State.Open) revert WrongState(State.Open, _state);
        if (block.timestamp >= expiryTs) revert MarketExpired();
        if (side > 1) revert InvalidSide(side);

        // Per-side, per-user, per-market enforcement: each user may have at most
        // one bet on YES and one on NO in any given market. PRD v1.3 §5.3 leaves
        // the cardinality unspecified; the F3 prompt explicitly requires this
        // restriction. F4+ may relax to "additive same-side bets" once the claim
        // accounting is wired (DRIFT_LOG entry).
        if (side == 1) {
            if (Nox.isInitialized(_yesBet[msg.sender])) revert AlreadyBetThisSide(msg.sender, side);
        } else {
            if (Nox.isInitialized(_noBet[msg.sender])) revert AlreadyBetThisSide(msg.sender, side);
        }

        // Validate the gateway-issued handle proof. After this call, this
        // contract has *transient* ACL on `betAmount`. The proof binds the
        // handle to (msg.sender as owner, this market as app).
        euint256 betAmount = Nox.fromExternal(encryptedAmount, inputProof);

        // Grant cUSDC transient ACL so it can use `betAmount` as input to
        // its internal Nox.safeSub against the user's encrypted balance.
        // Without this grant, NoxCompute (whose msg.sender during cUSDC's
        // safeSub call is cUSDC itself, not the market) would revert with
        // NotAllowed(handle, cusdc).
        Nox.allowTransient(betAmount, confidentialUSDC);

        // Pull encrypted cUSDC from user → this market via the operator
        // pattern. The user must have called cUSDC.setOperator(market, until)
        // before placeBet. The bet handle was just registered for both
        // (alice, market) — re-use it as the transferFrom amount handle.
        //
        // ERC-7984 silent-failure semantics: if the user's cUSDC balance is
        // less than `betAmount`, `transferred` is encrypted-zero and no
        // underlying funds move. We bind ALL downstream pool/bet accounting
        // to `transferred` (not `betAmount`) so the market only ever credits
        // a user with what was actually pulled. This is the canonical
        // ERC-7984 invariant per OZ Confidential Contracts reference.
        euint256 transferred = IConfidentialUSDC(confidentialUSDC).confidentialTransferFrom(
            msg.sender,
            address(this),
            betAmount
        );

        // Add the bet to the appropriate batch accumulator. Use the unsafe
        // `Nox.add` rather than `safeAdd` because (a) the accumulator is a
        // u256 and even with millions of bets it's far from overflow, and (b)
        // overflow on encrypted u256 is not a practical attack surface.
        if (side == 1) {
            euint256 newYesBatch = Nox.add(_yesPoolBatch, transferred);
            _yesPoolBatch = newYesBatch;
            Nox.allowThis(newYesBatch);
            _yesBet[msg.sender] = transferred;
        } else {
            euint256 newNoBatch = Nox.add(_noPoolBatch, transferred);
            _noPoolBatch = newNoBatch;
            Nox.allowThis(newNoBatch);
            _noBet[msg.sender] = transferred;
        }

        // Per-user persistent ACL on the *actually-transferred* amount so they
        // can off-chain decrypt their bet.
        Nox.allowThis(transferred);
        Nox.allow(transferred, msg.sender);

        unchecked {
            ++totalBetCount;
            ++pendingBatchBetCount;
        }

        emit BetPlaced(msg.sender, side, euint256.unwrap(transferred), batchCount);
    }

    // ====================================================================
    // publishBatch (permissionless, time-gated)
    // ====================================================================

    function publishBatch() external nonReentrant {
        uint256 nextEligibleAt = lastBatchTs + BATCH_INTERVAL;
        if (block.timestamp < nextEligibleAt) revert BatchIntervalNotElapsed(nextEligibleAt);
        _publishBatchInternal();
    }

    /// @dev Folds the current batch handles into the public running totals,
    ///      marks the new totals publicly decryptable, and resets the batch
    ///      accumulators to encrypted zero. Reused by `closeMarket` (which
    ///      bypasses the time gate to flush any pending bets at closure).
    function _publishBatchInternal() internal {
        // Add batch into the running total (encrypted add: produces a new
        // unique handle that we then mark as public-decryptable).
        euint256 newYesPublished = Nox.add(_yesPoolPublished, _yesPoolBatch);
        euint256 newNoPublished = Nox.add(_noPoolPublished, _noPoolBatch);

        _yesPoolPublished = newYesPublished;
        _noPoolPublished = newNoPublished;
        Nox.allowThis(newYesPublished);
        Nox.allowThis(newNoPublished);
        // allowPublicDecryption reverts on already-public handles; skip the
        // call when the result of Nox.add inherited public status from two
        // public inputs (the empty-batch + initial-zero-published case).
        if (!HandleUtils.isPublicHandle(euint256.unwrap(newYesPublished))) {
            Nox.allowPublicDecryption(newYesPublished);
        }
        if (!HandleUtils.isPublicHandle(euint256.unwrap(newNoPublished))) {
            Nox.allowPublicDecryption(newNoPublished);
        }

        // Reset the TEE-only batch accumulators. New encrypted zeros.
        _yesPoolBatch = Nox.toEuint256(0);
        _noPoolBatch = Nox.toEuint256(0);

        uint256 betsInBatch = pendingBatchBetCount;
        uint256 thisBatchId = batchCount;
        unchecked {
            ++batchCount;
        }
        pendingBatchBetCount = 0;
        lastBatchTs = block.timestamp;

        emit BatchPublished(thisBatchId, betsInBatch, block.timestamp);
    }

    // ====================================================================
    // closeMarket
    // ====================================================================

    function closeMarket() external nonReentrant {
        if (_state != State.Open) revert WrongState(State.Open, _state);
        if (block.timestamp < expiryTs) revert MarketNotExpired();

        // Auto-flush any pending bets so the closing snapshot is accurate.
        // Bypasses the time gate intentionally — closing is a definitive event.
        if (pendingBatchBetCount > 0) {
            _publishBatchInternal();
        }

        _state = State.Closed;
        emit MarketClosed(block.timestamp);
    }

    // ====================================================================
    // markInvalid (griefing protection)
    // ====================================================================

    function markInvalid() external {
        if (block.timestamp < claimWindowDeadline) revert ClaimWindowNotElapsed(claimWindowDeadline);
        // Only flip if we never resolved. If state is already Resolved or
        // ClaimWindow, the market is healthy and markInvalid is meaningless.
        if (_state != State.Closed && _state != State.Resolving && _state != State.Open) {
            revert NotInResolvableState();
        }

        _state = State.Invalid;
        _outcome = uint8(Outcome.INVALID);
        emit MarketInvalidated(block.timestamp);
    }

    // ====================================================================
    // Resolution
    // ====================================================================

    function resolveOracle() external nonReentrant {
        _preResolveTransitions();
        IResolutionOracle oracle = IResolutionOracle(resolutionOracle);
        if (!oracle.isReady(id)) revert OracleNotReady();
        uint8 result = oracle.resolve(id);
        _completeResolve(result);
    }

    function resolveAdmin(uint8 winningOutcome) external nonReentrant {
        if (msg.sender != admin) revert OnlyAdmin();
        if (winningOutcome > uint8(Outcome.INVALID)) revert InvalidOutcome(winningOutcome);
        _preResolveTransitions();
        _completeResolve(winningOutcome);
    }

    /// @dev Shared prologue for resolveOracle/resolveAdmin. Must transition
    ///      Open/Closed → Resolving and flush any pending batch first.
    function _preResolveTransitions() internal {
        if (_state == State.Open) {
            // Permissionless callers can effectively trigger a close-then-resolve
            // path once expiry has passed; the spec allows resolveOracle to be
            // a one-shot driver of the state machine.
            if (block.timestamp < expiryTs) revert MarketNotExpired();
            if (pendingBatchBetCount > 0) {
                _publishBatchInternal();
            }
            _state = State.Closed;
            emit MarketClosed(block.timestamp);
        }
        if (_state != State.Closed) revert WrongState(State.Closed, _state);
        _state = State.Resolving;
        resolutionTs = block.timestamp;
    }

    function _completeResolve(uint8 result) internal {
        if (result > uint8(Outcome.INVALID)) revert InvalidOutcome(result);
        _outcome = result;
        if (result == uint8(Outcome.INVALID)) {
            // Adapter explicitly returned INVALID — short-circuit straight to
            // Invalid state so refundIfInvalid is the next user action.
            _state = State.Invalid;
            emit MarketInvalidated(block.timestamp);
        } else {
            // Stay in Resolving until freezePool moves us forward.
            emit MarketResolved(result, block.timestamp);
        }
    }

    // ====================================================================
    // freezePool — convert public-decryptable handles to plaintext snapshots
    // ====================================================================

    function freezePool(
        bytes calldata yesPoolDecryptionProof,
        bytes calldata noPoolDecryptionProof
    ) external nonReentrant {
        if (_state != State.Resolving) revert WrongState(State.Resolving, _state);

        // Validate the gateway-issued public-decryption proofs against the
        // already-published handles (they were marked publicly-decryptable
        // on every publishBatch). The proofs come from the off-chain Nox
        // gateway via `publicDecrypt(handle)` — anyone can fetch them and
        // submit, since the handles are public.
        uint256 yesPlain = Nox.publicDecrypt(_yesPoolPublished, yesPoolDecryptionProof);
        uint256 noPlain = Nox.publicDecrypt(_noPoolPublished, noPoolDecryptionProof);

        yesPoolFrozen = yesPlain;
        noPoolFrozen = noPlain;
        poolFrozenTs = block.timestamp;
        claimWindowOpensAt = block.timestamp + CLAIM_OPEN_DELAY;
        _state = State.ClaimWindow;

        emit PoolFrozen(yesPlain, noPlain, block.timestamp);
        emit ClaimWindowOpened(claimWindowOpensAt);
    }

    // ====================================================================
    // claimWinnings — F5 on-chain payout via Nox arithmetic
    // ====================================================================

    /// @notice Proportional pari-mutuel payout computed entirely on-chain via
    ///         Nox encrypted arithmetic. No TEE handler needed — the Nox Runner
    ///         executes all encrypted ops inside its own Intel TDX environment.
    ///
    ///         Formula: gross = (userBet * totalPool) / winningSide
    ///                  fee   = (gross * protocolFeeBps) / 10_000
    ///                  net   = gross - fee
    ///
    ///         The net payout is confidentialTransfer'd to the caller via cUSDC.
    ///         The fee handle is ACL-granted to this contract (admin drains post-
    ///         claim via confidentialTransfer to FeeVault, see DRIFT_LOG F5).
    ///
    ///         Per DRIFT_LOG F5: Nox has no custom handler deployment surface;
    ///         on-chain arithmetic is the canonical computation path.
    function claimWinnings() external nonReentrant {
        if (_state != State.ClaimWindow) revert ClaimWindowNotOpen(claimWindowOpensAt);
        if (block.timestamp < claimWindowOpensAt) revert ClaimWindowNotOpen(claimWindowOpensAt);
        if (_claimed[msg.sender]) revert AlreadyClaimed();

        bool hasYes = Nox.isInitialized(_yesBet[msg.sender]);
        bool hasNo = Nox.isInitialized(_noBet[msg.sender]);
        bool wins = (_outcome == uint8(Outcome.YES) && hasYes) || (_outcome == uint8(Outcome.NO) && hasNo);
        if (!wins) revert NoWinningPosition();

        _claimed[msg.sender] = true;
        emit ClaimRecorded(msg.sender, _outcome, block.timestamp);

        euint256 userBet = (_outcome == uint8(Outcome.YES)) ? _yesBet[msg.sender] : _noBet[msg.sender];
        uint256 totalPool = yesPoolFrozen + noPoolFrozen;
        uint256 winningSide = (_outcome == uint8(Outcome.YES)) ? yesPoolFrozen : noPoolFrozen;

        // winningSide == 0 is unreachable: wins == true implies a non-zero bet on
        // the winning side which must have contributed to the frozen pool.
        assert(winningSide > 0);

        // Step 1: gross = (userBet * totalPool) / winningSide
        euint256 totalPoolHandle = Nox.toEuint256(totalPool);
        euint256 winningSideHandle = Nox.toEuint256(winningSide);
        euint256 numeratorHandle = Nox.mul(userBet, totalPoolHandle);
        Nox.allowThis(numeratorHandle);
        euint256 grossHandle = Nox.div(numeratorHandle, winningSideHandle);
        Nox.allowThis(grossHandle);

        // Step 2: fee = (gross * protocolFeeBps) / 10_000
        euint256 feeNumerator = Nox.mul(grossHandle, Nox.toEuint256(protocolFeeBps));
        Nox.allowThis(feeNumerator);
        euint256 feeHandle = Nox.div(feeNumerator, Nox.toEuint256(10_000));
        Nox.allowThis(feeHandle);

        // Step 3: net payout = gross - fee
        euint256 payoutHandle = Nox.sub(grossHandle, feeHandle);
        Nox.allowThis(payoutHandle);
        Nox.allow(payoutHandle, msg.sender);

        // Transfer net payout to user. Market must have sufficient cUSDC
        // balance (guaranteed: market holds all bets via placeBet's transferFrom).
        Nox.allowTransient(payoutHandle, confidentialUSDC);
        IConfidentialUSDC(confidentialUSDC).confidentialTransfer(msg.sender, payoutHandle);

        emit ClaimSettled(msg.sender, _outcome, euint256.unwrap(payoutHandle), euint256.unwrap(feeHandle));
    }

    function hasClaimed(address user) external view returns (bool) {
        return _claimed[user];
    }

    // ====================================================================
    // refundIfInvalid — full F4 implementation
    // ====================================================================

    function refundIfInvalid() external nonReentrant returns (bytes32 refundHandle) {
        if (_state != State.Invalid) revert NotInvalid();
        if (_claimed[msg.sender]) revert AlreadyClaimed();

        // Pick whichever side the user has a non-zero bet on. Users may bet
        // on both sides per market; refund both via two refunds (the user
        // calls this once, contract refunds the FIRST initialized side; user
        // calls again to refund the second). To keep state machine simple,
        // we refund ONE side per call and only mark `_claimed` once both
        // sides are zeroed — but for v1 simplicity we refund a single side
        // per call without claimed bookkeeping; the second call refunds the
        // other side, then a third call reverts NoBetToRefund. This is
        // acceptable since per-side bet limit is one per user.
        euint256 betHandle = euint256.wrap(bytes32(0));
        if (Nox.isInitialized(_yesBet[msg.sender])) {
            betHandle = _yesBet[msg.sender];
            _yesBet[msg.sender] = euint256.wrap(bytes32(0));
        } else if (Nox.isInitialized(_noBet[msg.sender])) {
            betHandle = _noBet[msg.sender];
            _noBet[msg.sender] = euint256.wrap(bytes32(0));
        } else {
            revert NoBetToRefund();
        }

        // Grant cUSDC transient ACL on the bet handle so its internal
        // safeSub on the market's confidential balance works (canonical
        // cross-contract handle pattern, see F3 BUG_LOG).
        Nox.allowTransient(betHandle, confidentialUSDC);

        // Transfer the user's original deposit (now stored in _yesBet/_noBet)
        // back to them. The market's confidential balance always covers
        // outstanding bets because placeBet binds bet records to actual
        // pulled `transferred` amounts (post-F4.5 hardening). Capture the
        // returned encrypted-actually-transferred handle for the event so
        // off-chain consumers can verify the refund value.
        euint256 refunded = IConfidentialUSDC(confidentialUSDC).confidentialTransfer(msg.sender, betHandle);

        refundHandle = euint256.unwrap(refunded);
        emit Refunded(msg.sender, refundHandle);
    }
}
