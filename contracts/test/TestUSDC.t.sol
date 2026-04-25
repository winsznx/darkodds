// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TestUSDCTest is Test {
    TestUSDC private token;
    address private constant OWNER = address(0xA11CE);
    address private constant USER = address(0xB0B);

    function setUp() public {
        token = new TestUSDC(OWNER);
    }

    function test_NameSymbolDecimals() public view {
        assertEq(token.name(), "DarkOdds Test USDC");
        assertEq(token.symbol(), "tUSDC");
        assertEq(token.decimals(), 6);
    }

    function test_OwnerMints() public {
        vm.prank(OWNER);
        token.mint(USER, 1_000_000 * 1e6);
        assertEq(token.balanceOf(USER), 1_000_000 * 1e6);
    }

    function test_NonOwnerCannotMint() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, USER));
        vm.prank(USER);
        token.mint(USER, 1);
    }

    function test_TransfersWork() public {
        vm.prank(OWNER);
        token.mint(USER, 100 * 1e6);

        address recipient = address(0xC0FFEE);
        vm.prank(USER);
        token.transfer(recipient, 40 * 1e6);

        assertEq(token.balanceOf(USER), 60 * 1e6);
        assertEq(token.balanceOf(recipient), 40 * 1e6);
    }

    function test_PermitRoundTrip() public {
        uint256 ownerKey = 0xA11CE;
        address ownerAddr = vm.addr(ownerKey);
        address spender = address(0xCAFE);
        uint256 value = 50 * 1e6;
        uint256 deadline = block.timestamp + 1 days;

        // Mint to ownerAddr first.
        vm.prank(OWNER);
        token.mint(ownerAddr, value);

        bytes32 domain = token.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                ownerAddr,
                spender,
                value,
                token.nonces(ownerAddr),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);

        token.permit(ownerAddr, spender, value, deadline, v, r, s);
        assertEq(token.allowance(ownerAddr, spender), value);
    }
}
