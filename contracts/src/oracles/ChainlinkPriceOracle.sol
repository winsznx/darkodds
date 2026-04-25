// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IResolutionAdapter} from "../interfaces/IResolutionAdapter.sol";

/// @dev Minimal AggregatorV3Interface — same shape as the canonical Chainlink
///      contract; we don't import the Chainlink Solidity package because it
///      pins solc 0.6/0.8 ranges that don't match our 0.8.34 line cleanly.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title ChainlinkPriceOracle
/// @notice PRD §5.4.1 implementation of the Chainlink-resolved adapter.
///
/// Per-market config: BTC/USD-style aggregator + threshold + comparison.
/// Resolution decision tree (in order):
///   1. Sequencer uptime check (skipped on chains where Chainlink doesn't
///      publish a feed — testnets, mainly. The chain-conditional skip is
///      load-bearing: PRD v1.3 §5.4.1 mandates the check, but the librarian
///      verified that no Arbitrum-Sepolia sequencer feed exists on Chainlink's
///      published registry. See DRIFT_LOG for the full provenance.)
///   2. latestRoundData read on the configured price aggregator
///   3. Heartbeat freshness (`updatedAt > now - HEARTBEAT_THRESHOLD`)
///   4. Round completeness (`answeredInRound >= roundId`)
///   5. Non-negative answer guard
///   6. Threshold comparison
///
/// ANY failure in steps 1–5 short-circuits to INVALID rather than YES/NO.
/// Bettors get refunded via `Market.refundIfInvalid()`.
contract ChainlinkPriceOracle is IResolutionAdapter, Ownable {
    error AlreadyConfigured(uint256 marketId);
    error NotConfigured(uint256 marketId);
    error InvalidThresholdAddress();
    error InvalidExpiry();
    error InvalidComparison();

    enum Comparison {
        Gt, // strictly greater than threshold → outcome YES
        Gte, // greater than or equal → outcome YES
        Lt, // strictly less than threshold → outcome YES
        Lte // less than or equal → outcome YES
    }

    struct Config {
        bool configured;
        AggregatorV3Interface aggregator;
        int256 threshold; // in aggregator's native decimals (e.g., 1.2e13 for $120k @ 8 decimals)
        Comparison op;
        uint256 expiryTs; // earliest block.timestamp at which resolve() may produce an outcome
    }

    mapping(uint256 marketId => Config) public configs;

    /// @dev Chainlink-published L2 sequencer uptime feeds (per
    ///      smartcontractkit/hardhat-chainlink registry, verified at F4 commit).
    AggregatorV3Interface public immutable sequencerFeed;
    uint256 public constant SEQUENCER_GRACE = 3600 seconds;
    uint256 public constant HEARTBEAT_THRESHOLD = 3600 seconds;

    event MarketConfigured(
        uint256 indexed marketId,
        address aggregator,
        int256 threshold,
        Comparison op,
        uint256 expiryTs
    );

    /// @param sequencerFeed_  Chainlink L2 sequencer uptime feed for the
    ///        deployment chain. Pass `address(0)` on chains where Chainlink
    ///        does not publish a feed (e.g., Arbitrum Sepolia testnet) —
    ///        `resolve()` will skip the sequencer check entirely. Production
    ///        deploys on Arbitrum One MUST pass the real feed
    ///        `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`.
    constructor(address sequencerFeed_, address initialOwner) Ownable(initialOwner) {
        sequencerFeed = AggregatorV3Interface(sequencerFeed_);
    }

    function configure(
        uint256 marketId,
        address aggregator_,
        int256 threshold_,
        Comparison op_,
        uint256 expiryTs_
    ) external onlyOwner {
        if (configs[marketId].configured) revert AlreadyConfigured(marketId);
        if (aggregator_ == address(0)) revert InvalidThresholdAddress();
        if (expiryTs_ <= block.timestamp) revert InvalidExpiry();
        if (uint8(op_) > uint8(Comparison.Lte)) revert InvalidComparison();
        configs[marketId] = Config({
            configured: true,
            aggregator: AggregatorV3Interface(aggregator_),
            threshold: threshold_,
            op: op_,
            expiryTs: expiryTs_
        });
        emit MarketConfigured(marketId, aggregator_, threshold_, op_, expiryTs_);
    }

    function isReady(uint256 marketId) external view returns (bool) {
        Config storage c = configs[marketId];
        return c.configured && block.timestamp >= c.expiryTs;
    }

    function resolve(uint256 marketId) external view returns (uint8 outcome) {
        Config storage c = configs[marketId];
        if (!c.configured) revert NotConfigured(marketId);
        if (block.timestamp < c.expiryTs) {
            // Premature call → mark INVALID; market would not be ready, but the
            // safe answer when isReady() returns false is "do not resolve YES/NO".
            return uint8(2);
        }

        // ============ 1. Sequencer uptime check (chain-conditional) ============
        if (address(sequencerFeed) != address(0)) {
            (, int256 sequencerAnswer, uint256 sequencerStartedAt, , ) = _tryLatestRoundData(sequencerFeed);
            if (sequencerStartedAt == 0) {
                // Round not started yet — feed is in an unknown state.
                return uint8(2);
            }
            // Per Chainlink: 0 = up, 1 = down.
            if (sequencerAnswer != 0) {
                return uint8(2);
            }
            if (block.timestamp < sequencerStartedAt + SEQUENCER_GRACE) {
                // Sequencer was recently down; data may be stale even though
                // the feed reports "up". Wait out the grace period.
                return uint8(2);
            }
        }

        // ============ 2-5. Price feed reads + freshness/round/sign checks ====
        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = _tryLatestRoundData(
            c.aggregator
        );
        if (updatedAt == 0) return uint8(2); // round not yet started
        if (answeredInRound < roundId) return uint8(2); // stale answer for the queried round
        if (block.timestamp > updatedAt + HEARTBEAT_THRESHOLD) return uint8(2); // heartbeat stale
        if (answer < 0) return uint8(2); // implausible negative price (defensive guard)

        // ============ 6. Threshold comparison ============
        bool yes;
        if (c.op == Comparison.Gt) yes = answer > c.threshold;
        else if (c.op == Comparison.Gte) yes = answer >= c.threshold;
        else if (c.op == Comparison.Lt) yes = answer < c.threshold;
        else yes = answer <= c.threshold;

        return yes ? uint8(1) : uint8(0);
    }

    /// @dev Wrap latestRoundData in a try/catch so a reverting feed maps to
    ///      "round not started" (zero values), which the caller treats as INVALID.
    function _tryLatestRoundData(
        AggregatorV3Interface feed
    ) internal view returns (uint80, int256, uint256, uint256, uint80) {
        try feed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            return (roundId, answer, startedAt, updatedAt, answeredInRound);
        } catch {
            return (0, 0, 0, 0, 0);
        }
    }
}
