// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ResolutionOracle} from "../src/ResolutionOracle.sol";
import {PreResolvedOracle} from "../src/oracles/PreResolvedOracle.sol";

contract ResolutionOracleTest is Test {
    ResolutionOracle private oracle;
    PreResolvedOracle private adapter;
    address private constant OWNER = address(0xA11CE);
    uint256 private constant MID = 9;

    function setUp() public {
        oracle = new ResolutionOracle(OWNER);
        adapter = new PreResolvedOracle(OWNER);
        vm.prank(OWNER);
        adapter.configure(MID, 1);
    }

    function test_SetAdapter_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        oracle.setAdapter(MID, address(adapter));
    }

    function test_SetAdapter_RevertsOnZero() public {
        vm.prank(OWNER);
        vm.expectRevert(ResolutionOracle.InvalidAdapter.selector);
        oracle.setAdapter(MID, address(0));
    }

    function test_AdapterOf_DefaultZero() public view {
        assertEq(oracle.adapterOf(MID), address(0));
    }

    function test_DispatchToAdapter() public {
        vm.prank(OWNER);
        oracle.setAdapter(MID, address(adapter));
        assertEq(oracle.adapterOf(MID), address(adapter));
        assertTrue(oracle.isReady(MID));
        assertEq(oracle.resolve(MID), 1);
    }

    function test_Resolve_RevertsWithoutAdapter() public {
        vm.expectRevert(abi.encodeWithSelector(ResolutionOracle.AdapterNotSet.selector, MID));
        oracle.resolve(MID);
    }

    function test_IsReady_FalseWithoutAdapter() public view {
        assertFalse(oracle.isReady(MID));
    }
}
