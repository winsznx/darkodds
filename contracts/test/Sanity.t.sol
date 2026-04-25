// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";

contract SanityTest is Test {
    function test_ArithmeticHolds() public pure {
        assertEq(uint256(1) + uint256(1), uint256(2));
    }
}
