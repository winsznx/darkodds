// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IResolutionAdapter} from "../interfaces/IResolutionAdapter.sol";

/// @title AdminOracle
/// @notice Commit-reveal admin resolution adapter (PRD §3.4 — MEV mitigation).
///         Admin first commits keccak256(abi.encode(outcome, salt)) and waits
///         REVEAL_DELAY before revealing. This prevents the trivial front-run
///         where a watcher sees the admin's "this market resolves YES" tx in
///         the mempool and races to claim before competitors can react.
contract AdminOracle is IResolutionAdapter, Ownable {
    error AlreadyCommitted(uint256 marketId);
    error NotCommitted(uint256 marketId);
    error AlreadyResolved(uint256 marketId);
    error RevealTooEarly(uint256 marketId, uint256 revealableAt);
    error CommitmentMismatch(uint256 marketId);
    error InvalidOutcome(uint8 outcome);

    /// @dev MEV-protection delay between commit and reveal. Per PRD §3.4 row
    ///      "MEV on resolution": 60s suffices on Arbitrum (block time ~250ms,
    ///      so ~240 blocks of mempool visibility before reveal is allowed).
    uint256 public constant REVEAL_DELAY = 60 seconds;

    struct Commitment {
        bytes32 hash;
        uint256 committedAt;
        bool revealed;
        uint8 outcome;
    }

    mapping(uint256 marketId => Commitment) public commitments;

    event OutcomeCommitted(uint256 indexed marketId, bytes32 hash, uint256 committedAt);
    event OutcomeRevealed(uint256 indexed marketId, uint8 outcome, uint256 revealedAt);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Commit a hash of (outcome, salt). Owner-only.
    function commit(uint256 marketId, bytes32 commitmentHash) external onlyOwner {
        Commitment storage c = commitments[marketId];
        if (c.committedAt != 0) revert AlreadyCommitted(marketId);
        c.hash = commitmentHash;
        c.committedAt = block.timestamp;
        emit OutcomeCommitted(marketId, commitmentHash, block.timestamp);
    }

    /// @notice Reveal a previously-committed outcome. Owner-only. Must be at
    ///         least REVEAL_DELAY after `commit`.
    /// @param outcome  0 = NO, 1 = YES, 2 = INVALID.
    /// @param salt     The 32-byte secret used in the commitment.
    function reveal(uint256 marketId, uint8 outcome, bytes32 salt) external onlyOwner {
        Commitment storage c = commitments[marketId];
        if (c.committedAt == 0) revert NotCommitted(marketId);
        if (c.revealed) revert AlreadyResolved(marketId);
        uint256 revealableAt = c.committedAt + REVEAL_DELAY;
        if (block.timestamp < revealableAt) revert RevealTooEarly(marketId, revealableAt);
        if (outcome > 2) revert InvalidOutcome(outcome);
        if (keccak256(abi.encode(outcome, salt)) != c.hash) revert CommitmentMismatch(marketId);
        c.revealed = true;
        c.outcome = outcome;
        emit OutcomeRevealed(marketId, outcome, block.timestamp);
    }

    function isReady(uint256 marketId) external view returns (bool) {
        return commitments[marketId].revealed;
    }

    function resolve(uint256 marketId) external view returns (uint8) {
        Commitment storage c = commitments[marketId];
        if (!c.revealed) revert NotCommitted(marketId);
        return c.outcome;
    }

    /// @dev Off-chain helper to compute the commitment hash. View-only.
    function commitmentHash(uint8 outcome, bytes32 salt) external pure returns (bytes32) {
        return keccak256(abi.encode(outcome, salt));
    }
}
