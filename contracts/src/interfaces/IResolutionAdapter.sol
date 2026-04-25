// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title IResolutionAdapter
/// @notice Per-PRD §5.4 adapter pattern. Each market is wired to exactly one
///         adapter implementation (admin signoff, Chainlink price feed, or
///         pre-resolved historical outcome).
interface IResolutionAdapter {
    /// @notice Outcome encoding: 0 = NO, 1 = YES, 2 = INVALID.
    /// @return ready True iff `resolve(marketId)` would now succeed without
    ///         reverting and produce a final, non-INVALID outcome on the
    ///         adapter's internal logic. View-only: never mutates state.
    function isReady(uint256 marketId) external view returns (bool ready);

    /// @notice Produce a final outcome for `marketId`. May revert if the adapter
    ///         is not yet in a resolvable state (e.g. AdminOracle not revealed).
    ///         May return 2 (INVALID) when the adapter detects a fault that the
    ///         caller (Market.sol) MUST treat as "refund all bettors".
    function resolve(uint256 marketId) external returns (uint8 outcome);
}
