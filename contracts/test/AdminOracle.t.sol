// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AdminOracle} from "../src/oracles/AdminOracle.sol";

contract AdminOracleTest is Test {
    AdminOracle private oracle;
    address private constant OWNER = address(0xA11CE);
    uint256 private constant MARKET_ID = 7;

    function setUp() public {
        oracle = new AdminOracle(OWNER);
    }

    function _commit(uint8 outcome, bytes32 salt) internal returns (bytes32 hash) {
        hash = keccak256(abi.encode(outcome, salt));
        vm.prank(OWNER);
        oracle.commit(MARKET_ID, hash);
    }

    function test_Commit_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        oracle.commit(MARKET_ID, bytes32(uint256(1)));
    }

    function test_Commit_RevertsOnDoubleCommit() public {
        _commit(1, bytes32(uint256(0xC1)));
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AdminOracle.AlreadyCommitted.selector, MARKET_ID));
        oracle.commit(MARKET_ID, bytes32(uint256(0xC2)));
    }

    function test_Reveal_HappyPath() public {
        bytes32 salt = bytes32(uint256(0xD1));
        _commit(1, salt);
        vm.warp(block.timestamp + oracle.REVEAL_DELAY() + 1);
        vm.prank(OWNER);
        oracle.reveal(MARKET_ID, 1, salt);
        assertTrue(oracle.isReady(MARKET_ID));
        assertEq(oracle.resolve(MARKET_ID), 1);
    }

    function test_Reveal_RevertsBeforeDelay() public {
        bytes32 salt = bytes32(uint256(0xD2));
        _commit(1, salt);
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(AdminOracle.RevealTooEarly.selector, MARKET_ID, block.timestamp + 60)
        );
        oracle.reveal(MARKET_ID, 1, salt);
    }

    function test_Reveal_RevertsOnCommitmentMismatch() public {
        bytes32 salt = bytes32(uint256(0xD3));
        _commit(1, salt);
        vm.warp(block.timestamp + oracle.REVEAL_DELAY() + 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AdminOracle.CommitmentMismatch.selector, MARKET_ID));
        oracle.reveal(MARKET_ID, 0, salt); // wrong outcome
    }

    function test_Reveal_RevertsOnDoubleReveal() public {
        bytes32 salt = bytes32(uint256(0xD4));
        _commit(1, salt);
        vm.warp(block.timestamp + oracle.REVEAL_DELAY() + 1);
        vm.startPrank(OWNER);
        oracle.reveal(MARKET_ID, 1, salt);
        vm.expectRevert(abi.encodeWithSelector(AdminOracle.AlreadyResolved.selector, MARKET_ID));
        oracle.reveal(MARKET_ID, 1, salt);
        vm.stopPrank();
    }

    function test_Reveal_RevertsWithoutCommit() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AdminOracle.NotCommitted.selector, MARKET_ID));
        oracle.reveal(MARKET_ID, 1, bytes32(uint256(0xD5)));
    }

    function test_Reveal_RevertsOnInvalidOutcome() public {
        bytes32 salt = bytes32(uint256(0xD6));
        _commit(99, salt);
        vm.warp(block.timestamp + oracle.REVEAL_DELAY() + 1);
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AdminOracle.InvalidOutcome.selector, uint8(99)));
        oracle.reveal(MARKET_ID, 99, salt);
    }

    function test_IsReady_FalseBeforeReveal() public {
        _commit(1, bytes32(uint256(0xD7)));
        assertFalse(oracle.isReady(MARKET_ID));
    }

    function test_Resolve_RevertsBeforeReveal() public {
        _commit(1, bytes32(uint256(0xD8)));
        vm.expectRevert(abi.encodeWithSelector(AdminOracle.NotCommitted.selector, MARKET_ID));
        oracle.resolve(MARKET_ID);
    }

    function test_CommitmentHash_Idempotent() public view {
        bytes32 a = oracle.commitmentHash(1, bytes32(uint256(0xCC)));
        bytes32 b = keccak256(abi.encode(uint8(1), bytes32(uint256(0xCC))));
        assertEq(a, b);
    }
}
