// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {Faucet} from "../src/Faucet.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

contract FaucetTest is Test {
    Faucet private faucet;
    TestUSDC private usdc;

    address private constant OWNER = address(0xA11CE);
    address private constant ALICE = address(0xBEEF);
    address private constant BOB = address(0xCAFE);

    uint256 private constant CLAIM = 1_000 * 1e6;
    uint256 private constant COOLDOWN = 6 hours;

    event Claimed(address indexed user, uint256 amount, uint256 nextClaimAt);
    event Refilled(address indexed by, uint256 amount);

    function setUp() public {
        usdc = new TestUSDC(OWNER);
        faucet = new Faucet(address(usdc), OWNER);

        // Pre-fund the faucet with 1M TestUSDC so per-test claims work without
        // every test having to go through the refill dance.
        vm.prank(OWNER);
        usdc.mint(address(faucet), 1_000_000 * 1e6);
    }

    // ====================================================================
    // Constructor
    // ====================================================================

    function test_Constructor_RevertsOnZeroToken() public {
        vm.expectRevert(Faucet.InvalidToken.selector);
        new Faucet(address(0), OWNER);
    }

    function test_Constructor_PinsTokenAndOwner() public view {
        assertEq(address(faucet.token()), address(usdc));
        assertEq(faucet.owner(), OWNER);
        assertFalse(faucet.paused());
    }

    function test_Constants() public view {
        assertEq(faucet.CLAIM_AMOUNT(), CLAIM);
        assertEq(faucet.COOLDOWN(), COOLDOWN);
    }

    // ====================================================================
    // Claim — happy path + balance accounting
    // ====================================================================

    function test_Claim_HappyPath_TransfersAndSetsCooldown() public {
        assertEq(faucet.claimableAt(ALICE), 0, "fresh user has no cooldown");
        assertEq(usdc.balanceOf(ALICE), 0);

        uint256 expectedNext = block.timestamp + COOLDOWN;
        vm.expectEmit(true, false, false, true);
        emit Claimed(ALICE, CLAIM, expectedNext);

        vm.prank(ALICE);
        faucet.claim();

        assertEq(usdc.balanceOf(ALICE), CLAIM, "alice received exactly CLAIM_AMOUNT");
        assertEq(faucet.claimableAt(ALICE), expectedNext, "cooldown set");
    }

    function test_Claim_SeparateUsersIndependent() public {
        vm.prank(ALICE);
        faucet.claim();
        // Bob should be unaffected by Alice's claim.
        assertEq(faucet.claimableAt(BOB), 0);

        vm.prank(BOB);
        faucet.claim();
        assertEq(usdc.balanceOf(BOB), CLAIM);
    }

    // ====================================================================
    // Claim — cooldown
    // ====================================================================

    function test_Claim_RevertsWithinCooldown() public {
        vm.prank(ALICE);
        faucet.claim();

        uint256 nextAt = faucet.claimableAt(ALICE);

        // 1 second before cooldown lifts → still locked.
        vm.warp(nextAt - 1);
        vm.expectRevert(abi.encodeWithSelector(Faucet.CooldownActive.selector, nextAt));
        vm.prank(ALICE);
        faucet.claim();
    }

    function test_Claim_AllowedExactlyAtCooldownEnd() public {
        vm.prank(ALICE);
        faucet.claim();

        uint256 nextAt = faucet.claimableAt(ALICE);
        // Faucet treats `nextAt > block.timestamp` as locked, so block.timestamp == nextAt is allowed.
        vm.warp(nextAt);
        vm.prank(ALICE);
        faucet.claim();

        assertEq(usdc.balanceOf(ALICE), CLAIM * 2);
    }

    function test_Claim_AllowedAfterCooldown() public {
        vm.prank(ALICE);
        faucet.claim();
        vm.warp(block.timestamp + COOLDOWN + 1);

        vm.prank(ALICE);
        faucet.claim();

        assertEq(usdc.balanceOf(ALICE), CLAIM * 2);
    }

    // ====================================================================
    // Claim — paused state
    // ====================================================================

    function test_Pause_BlocksClaim() public {
        vm.prank(OWNER);
        faucet.pause();
        assertTrue(faucet.paused());

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(ALICE);
        faucet.claim();
    }

    function test_Unpause_RestoresClaim() public {
        vm.prank(OWNER);
        faucet.pause();
        vm.prank(OWNER);
        faucet.unpause();

        vm.prank(ALICE);
        faucet.claim();
        assertEq(usdc.balanceOf(ALICE), CLAIM);
    }

    function test_Pause_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ALICE));
        vm.prank(ALICE);
        faucet.pause();
    }

    function test_Unpause_OnlyOwner() public {
        vm.prank(OWNER);
        faucet.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ALICE));
        vm.prank(ALICE);
        faucet.unpause();
    }

    // ====================================================================
    // Empty faucet
    // ====================================================================

    function test_Claim_RevertsOnInsufficientBalance() public {
        // Drain the pre-funded faucet by claiming repeatedly. Cleaner: deploy a
        // fresh empty faucet and try once.
        Faucet empty = new Faucet(address(usdc), OWNER);
        vm.expectRevert(abi.encodeWithSelector(Faucet.InsufficientFaucetBalance.selector, 0, CLAIM));
        vm.prank(ALICE);
        empty.claim();
    }

    // ====================================================================
    // Refill — owner-mediated transferFrom
    // ====================================================================

    function test_Refill_HappyPath() public {
        // Owner mints to themselves, approves faucet, then refills.
        vm.startPrank(OWNER);
        usdc.mint(OWNER, 5_000 * 1e6);
        usdc.approve(address(faucet), 5_000 * 1e6);

        vm.expectEmit(true, false, false, true);
        emit Refilled(OWNER, 5_000 * 1e6);
        faucet.refill(5_000 * 1e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(faucet)), 1_005_000 * 1e6);
    }

    function test_Refill_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ALICE));
        vm.prank(ALICE);
        faucet.refill(1);
    }

    function test_Refill_RevertsOnZeroAmount() public {
        vm.expectRevert(Faucet.InvalidAmount.selector);
        vm.prank(OWNER);
        faucet.refill(0);
    }

    // ====================================================================
    // Fuzz — claim cadence
    // ====================================================================

    /// @dev With a random elapsed gap, claim succeeds iff gap >= COOLDOWN
    ///      since last claim.
    function testFuzz_Claim_Cadence(uint256 gap) public {
        gap = bound(gap, 1, 365 days);

        // First claim establishes the cooldown timestamp.
        vm.prank(ALICE);
        faucet.claim();

        uint256 nextAt = faucet.claimableAt(ALICE);
        vm.warp(block.timestamp + gap);

        if (block.timestamp >= nextAt) {
            vm.prank(ALICE);
            faucet.claim();
            assertEq(usdc.balanceOf(ALICE), CLAIM * 2);
        } else {
            vm.expectRevert(abi.encodeWithSelector(Faucet.CooldownActive.selector, nextAt));
            vm.prank(ALICE);
            faucet.claim();
        }
    }

    // ====================================================================
    // No-payable invariant — Faucet has no receive() or fallback() so any
    // direct ETH send must revert. Locks against future accidental refactors
    // that add a payable surface without thinking about access control.
    // ====================================================================

    function test_Faucet_RejectsDirectEthSend() public {
        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (bool ok, ) = address(faucet).call{value: 1 ether}("");
        assertFalse(ok, "Faucet must reject plain ETH sends");
        assertEq(address(faucet).balance, 0);
    }

    /// @dev Many independent users can claim in the same block without
    ///      affecting each other's cooldown.
    function testFuzz_Claim_IndependentUsers(uint8 n) public {
        n = uint8(bound(uint256(n), 1, 50));
        for (uint256 i = 0; i < n; i++) {
            address user = address(uint160(0x1000 + i));
            vm.prank(user);
            faucet.claim();
            assertEq(usdc.balanceOf(user), CLAIM);
        }
    }
}
