// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ChainlinkPriceOracle, AggregatorV3Interface} from "../src/oracles/ChainlinkPriceOracle.sol";

/// @dev Test-only AggregatorV3 mock. Returns canned values; the test mutates
///      them between scenarios to exercise the full decision tree of the
///      production resolver. Lives in test/ only — never deployed in production.
contract MockAggregator is AggregatorV3Interface {
    uint8 private _decimals;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public roundId;
    uint80 public answeredInRound;
    bool public revertOnLatest;

    constructor(uint8 d) {
        _decimals = d;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external pure returns (string memory) {
        return "MockAggregator";
    }

    function setAnswer(int256 a, uint256 t) external {
        answer = a;
        updatedAt = t;
        startedAt = t;
        unchecked {
            roundId += 1;
        }
        answeredInRound = roundId;
    }

    function setStaleAnsweredInRound(uint80 stale) external {
        answeredInRound = stale;
    }

    function setRevertOnLatest(bool r) external {
        revertOnLatest = r;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (revertOnLatest) revert("revert");
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}

contract ChainlinkPriceOracleTest is Test {
    ChainlinkPriceOracle private oracle;
    MockAggregator private price;
    MockAggregator private sequencer;

    address private constant OWNER = address(0xA11CE);
    uint256 private constant MID = 1;

    /// @dev BTC at $120k with 8 decimals.
    int256 private constant THRESHOLD = 12_000_000_000_000;
    uint256 private expiry;

    function setUp() public {
        // Default forge block.timestamp is 1, which underflows when we subtract
        // SEQUENCER_GRACE below. Warp forward to a comfortable origin first.
        vm.warp(1_700_000_000);

        sequencer = new MockAggregator(0);
        price = new MockAggregator(8);
        oracle = new ChainlinkPriceOracle(address(sequencer), OWNER);
        expiry = block.timestamp + 1 days;

        vm.prank(OWNER);
        oracle.configure(MID, address(price), THRESHOLD, ChainlinkPriceOracle.Comparison.Gt, expiry);

        // Default: sequencer up for >grace, fresh price.
        sequencer.setAnswer(0, block.timestamp - oracle.SEQUENCER_GRACE() - 1);
        // After warp to expiry, the price feed should also be set.
    }

    function _warpAndSetPrice(int256 ans) internal {
        vm.warp(expiry + 1);
        // Re-anchor sequencer startedAt so SEQUENCER_GRACE remains satisfied.
        sequencer.setAnswer(0, block.timestamp - oracle.SEQUENCER_GRACE() - 1);
        price.setAnswer(ans, block.timestamp);
    }

    // ====================================================================
    // Configure
    // ====================================================================

    function test_Configure_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        oracle.configure(2, address(price), THRESHOLD, ChainlinkPriceOracle.Comparison.Gt, expiry);
    }

    function test_Configure_RevertsOnDouble() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkPriceOracle.AlreadyConfigured.selector, MID));
        oracle.configure(MID, address(price), THRESHOLD, ChainlinkPriceOracle.Comparison.Gt, expiry);
    }

    function test_Configure_RevertsOnZeroAggregator() public {
        vm.prank(OWNER);
        vm.expectRevert(ChainlinkPriceOracle.InvalidThresholdAddress.selector);
        oracle.configure(2, address(0), THRESHOLD, ChainlinkPriceOracle.Comparison.Gt, expiry);
    }

    function test_Configure_RevertsOnPastExpiry() public {
        vm.prank(OWNER);
        vm.expectRevert(ChainlinkPriceOracle.InvalidExpiry.selector);
        oracle.configure(2, address(price), THRESHOLD, ChainlinkPriceOracle.Comparison.Gt, block.timestamp);
    }

    // ====================================================================
    // Resolve — happy path + every INVALID branch
    // ====================================================================

    function test_Resolve_BeforeExpiry_ReturnsInvalid() public view {
        // Default config: expiry is in the future.
        assertFalse(oracle.isReady(MID));
        assertEq(oracle.resolve(MID), 2);
    }

    function test_Resolve_NotConfigured_Reverts() public {
        vm.expectRevert(abi.encodeWithSelector(ChainlinkPriceOracle.NotConfigured.selector, uint256(42)));
        oracle.resolve(42);
    }

    function test_Resolve_ThresholdMet_OutcomeYES() public {
        _warpAndSetPrice(THRESHOLD + 1);
        assertEq(oracle.resolve(MID), 1);
    }

    function test_Resolve_ThresholdNotMet_OutcomeNO() public {
        _warpAndSetPrice(THRESHOLD - 1);
        assertEq(oracle.resolve(MID), 0);
    }

    function test_Resolve_ThresholdEqual_GtFalse() public {
        // Comparison is Gt, so equality should NOT meet the threshold.
        _warpAndSetPrice(THRESHOLD);
        assertEq(oracle.resolve(MID), 0);
    }

    function test_Resolve_SequencerDown_INVALID() public {
        _warpAndSetPrice(THRESHOLD + 1);
        sequencer.setAnswer(1, block.timestamp); // sequencer DOWN
        assertEq(oracle.resolve(MID), 2);
    }

    function test_Resolve_SequencerWithinGrace_INVALID() public {
        _warpAndSetPrice(THRESHOLD + 1);
        // Sequencer just came back up (within grace).
        sequencer.setAnswer(0, block.timestamp - 100);
        assertEq(oracle.resolve(MID), 2);
    }

    function test_Resolve_StaleHeartbeat_INVALID() public {
        _warpAndSetPrice(THRESHOLD + 1);
        // Backdate the price feed so updatedAt is older than HEARTBEAT_THRESHOLD.
        vm.warp(block.timestamp + oracle.HEARTBEAT_THRESHOLD() + 1);
        // Re-anchor sequencer so its grace is fine, but DON'T touch the price.
        sequencer.setAnswer(0, block.timestamp - oracle.SEQUENCER_GRACE() - 1);
        assertEq(oracle.resolve(MID), 2);
    }

    function test_Resolve_NegativeAnswer_INVALID() public {
        _warpAndSetPrice(-1);
        assertEq(oracle.resolve(MID), 2);
    }

    function test_Resolve_StaleAnsweredInRound_INVALID() public {
        _warpAndSetPrice(THRESHOLD + 1);
        // Set answeredInRound < roundId.
        price.setStaleAnsweredInRound(0);
        assertEq(oracle.resolve(MID), 2);
    }

    function test_Resolve_RevertingFeed_INVALID() public {
        _warpAndSetPrice(THRESHOLD + 1);
        price.setRevertOnLatest(true);
        assertEq(oracle.resolve(MID), 2);
    }

    function test_Resolve_NoSequencerFeed_SkipsCheck() public {
        // Deploy a fresh oracle with no sequencer feed (the testnet-style configuration).
        ChainlinkPriceOracle noSeq = new ChainlinkPriceOracle(address(0), OWNER);
        vm.prank(OWNER);
        noSeq.configure(MID, address(price), THRESHOLD, ChainlinkPriceOracle.Comparison.Gt, expiry);
        _warpAndSetPrice(THRESHOLD + 1);
        // Even though the local sequencer mock would fail, the no-feed oracle
        // skips the check entirely and returns YES.
        assertEq(noSeq.resolve(MID), 1);
    }

    function test_Resolve_AllComparisonOps() public {
        // Re-configure separate market ids for each op.
        vm.startPrank(OWNER);
        oracle.configure(2, address(price), THRESHOLD, ChainlinkPriceOracle.Comparison.Gte, expiry);
        oracle.configure(3, address(price), THRESHOLD, ChainlinkPriceOracle.Comparison.Lt, expiry);
        oracle.configure(4, address(price), THRESHOLD, ChainlinkPriceOracle.Comparison.Lte, expiry);
        vm.stopPrank();

        _warpAndSetPrice(THRESHOLD); // exactly the threshold
        assertEq(oracle.resolve(2), 1, "Gte threshold-eq should be YES");
        assertEq(oracle.resolve(3), 0, "Lt threshold-eq should be NO");
        assertEq(oracle.resolve(4), 1, "Lte threshold-eq should be YES");
    }
}
