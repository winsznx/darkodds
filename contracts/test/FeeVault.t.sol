// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {IFeeVault} from "../src/interfaces/IFeeVault.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

contract FeeVaultTest is Test {
    FeeVault private vault;
    TestUSDC private usdc;
    address private constant OWNER = address(0xA11CE);
    address private constant MARKET = address(0xBEEF);
    address private constant RECIPIENT = address(0xC0FFEE);

    function setUp() public {
        vault = new FeeVault(OWNER);
        usdc = new TestUSDC(OWNER);
    }

    function test_SetMarketRegistered_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        vault.setMarketRegistered(MARKET, true);
    }

    function test_SetMarketRegistered_FlagsCorrectly() public {
        vm.prank(OWNER);
        vault.setMarketRegistered(MARKET, true);
        assertTrue(vault.isRegisteredMarket(MARKET));
        vm.prank(OWNER);
        vault.setMarketRegistered(MARKET, false);
        assertFalse(vault.isRegisteredMarket(MARKET));
    }

    function test_ReceiveFee_RevertsForUnknownMarket() public {
        vm.expectRevert(abi.encodeWithSelector(IFeeVault.UnknownMarket.selector, address(this)));
        vault.receiveFee(123);
    }

    function test_ReceiveFee_HappyPath() public {
        vm.prank(OWNER);
        vault.setMarketRegistered(MARKET, true);
        vm.prank(MARKET);
        vault.receiveFee(123);
        assertEq(vault.totalFees(), 123);
    }

    function test_Withdraw_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        vault.withdraw(address(usdc), RECIPIENT, 0);
    }

    function test_Withdraw_TransfersToken() public {
        // Pre-fund the vault with tUSDC plaintext so withdraw has something to move.
        vm.prank(OWNER);
        usdc.mint(address(vault), 500 * 1e6);
        vm.prank(OWNER);
        vault.withdraw(address(usdc), RECIPIENT, 200 * 1e6);
        assertEq(usdc.balanceOf(RECIPIENT), 200 * 1e6);
        assertEq(usdc.balanceOf(address(vault)), 300 * 1e6);
    }
}
