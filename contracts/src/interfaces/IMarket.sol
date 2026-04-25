// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import "encrypted-types/EncryptedTypes.sol";

/// @title IMarket
/// @notice Public surface of a single DarkOdds prediction market.
///         Per-market clone deployed by `MarketRegistry` (EIP-1167 minimal proxy).
///
/// State machine (per PRD §3.2):
///   Created → Open → Closed → Resolving → Resolved(YES|NO) → ClaimWindow → Settled
///                                       ↘ Invalid (griefing protection)
///
/// Privacy model (per PRD §6.2 — lazy public decryption):
///   - Each placeBet adds the user's encrypted amount to a TEE-only batch handle
///   - Every 60s, anyone can call publishBatch() to decrypt the batch in TEE,
///     fold it into the public running total, and reset the batch accumulator
///   - Individual user bet handles are ACL'd to the user only (off-chain decryptable)
///   - Public running totals are ACL'd publicly (anyone can decrypt)
interface IMarket {
    enum State {
        Created,
        Open,
        Closed,
        Resolving,
        Resolved,
        ClaimWindow,
        Invalid
    }

    /// @dev 0 = NO, 1 = YES, 2 = INVALID (set on resolution).
    enum Outcome {
        NO,
        YES,
        INVALID
    }

    // ====================================================================
    // Events
    // ====================================================================

    event Initialized(uint256 indexed id, uint256 expiryTs, uint256 protocolFeeBps);
    event BetPlaced(address indexed user, uint8 side, bytes32 handle, uint256 indexed batchId);
    event BatchPublished(uint256 indexed batchId, uint256 betsInBatch, uint256 timestamp);
    event MarketClosed(uint256 timestamp);
    event MarketResolved(uint8 outcome, uint256 timestamp);
    event MarketInvalidated(uint256 timestamp);
    event Claimed(address indexed user, bytes32 payoutHandle);
    event Refunded(address indexed user, bytes32 refundHandle);

    // ====================================================================
    // Initialization (clone-friendly — replaces constructor for proxies)
    // ====================================================================

    /// @notice One-shot initializer. Called by `MarketRegistry.createMarket` on
    ///         each cloned proxy. Reverts if called twice on the same instance.
    function initialize(
        uint256 id,
        string calldata question,
        string calldata resolutionCriteria,
        uint8 oracleType,
        uint256 expiryTs,
        uint256 protocolFeeBps,
        address confidentialUSDC,
        address admin
    ) external;

    // ====================================================================
    // Read-only state
    // ====================================================================

    function id() external view returns (uint256);
    function question() external view returns (string memory);
    function resolutionCriteria() external view returns (string memory);
    function oracleType() external view returns (uint8);
    function expiryTs() external view returns (uint256);
    function claimWindowDeadline() external view returns (uint256);
    function protocolFeeBps() external view returns (uint256);
    function state() external view returns (State);
    function outcome() external view returns (uint8);
    function admin() external view returns (address);
    function confidentialUSDC() external view returns (address);

    /// @notice Publicly-decryptable handle of the running YES pool total (post-batch).
    function yesPoolPublishedHandle() external view returns (euint256);

    /// @notice Publicly-decryptable handle of the running NO pool total (post-batch).
    function noPoolPublishedHandle() external view returns (euint256);

    function lastBatchTs() external view returns (uint256);
    function batchCount() external view returns (uint256);
    function totalBetCount() external view returns (uint256);
    function pendingBatchBetCount() external view returns (uint256);

    function yesBet(address user) external view returns (euint256);
    function noBet(address user) external view returns (euint256);
    function claimed(address user) external view returns (bool);

    // ====================================================================
    // User actions
    // ====================================================================

    /// @notice Place a confidential bet. The user has previously called the Nox
    ///         SDK's `encryptInput(amount, 'uint256', address(thisMarket))` to
    ///         produce `(encryptedAmount, inputProof)`. The market validates the
    ///         proof, debits cUSDC from the user (operator pattern — user must
    ///         have called `cUSDC.setOperator(market, until)` first), and adds
    ///         the encrypted amount to the side's TEE-only batch accumulator.
    /// @param side  0 = NO, 1 = YES.
    function placeBet(uint8 side, externalEuint256 encryptedAmount, bytes calldata inputProof) external;

    // ====================================================================
    // Permissionless lifecycle transitions
    // ====================================================================

    /// @notice Permissionless. After `lastBatchTs + 60s`, anyone can call to
    ///         flush the batch accumulator into the public running totals.
    function publishBatch() external;

    /// @notice Permissionless after `expiryTs`. State: Open → Closed.
    ///         Auto-flushes any pending batch.
    function closeMarket() external;

    /// @notice Permissionless after `claimWindowDeadline` (= expiryTs + 7d) if
    ///         no resolution happened. State: Closed/Resolving → Invalid.
    ///         Bettors can then call `refundIfInvalid` (F4).
    function markInvalid() external;

    // ====================================================================
    // Phase F4 surface — present for ABI stability, stubbed to revert
    // ====================================================================

    function resolveAdmin(uint8 winningOutcome) external;
    function resolveOracle() external;
    function claimWinnings() external returns (bytes32 payoutHandle);
    function refundIfInvalid() external returns (bytes32 refundHandle);
}
