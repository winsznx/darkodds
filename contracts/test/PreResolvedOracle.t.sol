// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PreResolvedOracle} from "../src/oracles/PreResolvedOracle.sol";

contract PreResolvedOracleTest is Test {
    PreResolvedOracle private oracle;
    address private constant OWNER = address(0xA11CE);

    function setUp() public {
        oracle = new PreResolvedOracle(OWNER);
    }

    function test_Configure_HappyPath() public {
        vm.prank(OWNER);
        oracle.configure(1, 1);
        assertTrue(oracle.isReady(1));
        assertEq(oracle.resolve(1), 1);
    }

    function test_Configure_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        oracle.configure(1, 1);
    }

    function test_Configure_RevertsOnDouble() public {
        vm.startPrank(OWNER);
        oracle.configure(1, 1);
        vm.expectRevert(abi.encodeWithSelector(PreResolvedOracle.AlreadyConfigured.selector, uint256(1)));
        oracle.configure(1, 0);
        vm.stopPrank();
    }

    function test_Configure_RevertsOnInvalidOutcome() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(PreResolvedOracle.InvalidOutcome.selector, uint8(99)));
        oracle.configure(1, 99);
    }

    function test_Resolve_RevertsWhenUnconfigured() public {
        vm.expectRevert(abi.encodeWithSelector(PreResolvedOracle.NotConfigured.selector, uint256(42)));
        oracle.resolve(42);
    }

    function test_IsReady_FalseWhenUnconfigured() public view {
        assertFalse(oracle.isReady(42));
    }
}
