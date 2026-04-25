// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, Vm} from "forge-std/Test.sol";
import "encrypted-types/EncryptedTypes.sol";
import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {INoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol";
import {NoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/NoxCompute.sol";
import {TEEType} from "@iexec-nox/nox-protocol-contracts/contracts/shared/TypeUtils.sol";
import {TestHelper} from "@iexec-nox/nox-protocol-contracts/test/utils/TestHelper.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ConfidentialUSDC} from "../src/ConfidentialUSDC.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @dev Reentrant ERC-20 used to verify nonReentrant on wrap. Calls back into
///      ConfidentialUSDC.wrap during transferFrom.
contract ReentrantUnderlying is IERC20 {
    string public name = "Reentrant";
    string public symbol = "REE";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    ConfidentialUSDC public target;
    bool public reenterArmed;
    externalEuint256 public storedHandle;
    bytes public storedProof;

    function arm(ConfidentialUSDC _target, externalEuint256 h, bytes memory p) external {
        target = _target;
        reenterArmed = true;
        storedHandle = h;
        storedProof = p;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        if (reenterArmed) {
            reenterArmed = false;
            // Attempt reentry — must revert.
            target.wrap(amount, storedHandle, storedProof);
        }
        return true;
    }
}

contract ConfidentialUSDCTest is Test {
    ConfidentialUSDC private cusdc;
    TestUSDC private usdc;
    NoxCompute private noxCompute;

    address private constant OWNER = address(0xA11CE);
    uint256 private constant GATEWAY_KEY = 0xBEEF;
    address private gateway;

    address private alice = address(0xA1);
    address private bob = address(0xB0B);

    uint256 private constant DEPOSIT_AMOUNT = 100 * 1e6;

    function setUp() public {
        gateway = vm.addr(GATEWAY_KEY);

        // Deploy real NoxCompute via TestHelper at the canonical address resolved
        // by Nox.noxComputeContract() for chain 31337 (forge default). This gives
        // us full-fidelity on-chain ACL/proof semantics in tests — no custom mock.
        noxCompute = TestHelper.deploy(OWNER, gateway);

        usdc = new TestUSDC(OWNER);
        cusdc = new ConfidentialUSDC(IERC20(address(usdc)), "Confidential tUSDC", "ctUSDC");

        // Fund alice + bob with tUSDC.
        vm.startPrank(OWNER);
        usdc.mint(alice, 10_000 * 1e6);
        usdc.mint(bob, 10_000 * 1e6);
        vm.stopPrank();
    }

    // ====================================================================
    // Helpers
    // ====================================================================

    /// @dev Mint a Nox handle and a valid gateway proof binding it to (owner, app).
    function _mintHandleWithProof(
        address owner,
        address app
    ) internal returns (externalEuint256 handle, bytes memory proof) {
        bytes32 raw = TestHelper.createHandle(TEEType.Uint256);
        proof = TestHelper.buildInputProof(
            address(noxCompute),
            raw,
            owner,
            app,
            block.timestamp,
            GATEWAY_KEY
        );
        handle = externalEuint256.wrap(raw);
    }

    /// @dev Build a public-decryption proof asserting that `handle` decrypts to
    ///      `boolValue`. Used to fake gateway responses for finalizeUnwrap tests.
    function _decryptionProofForBool(bytes32 handle, bool boolValue) internal view returns (bytes memory) {
        bytes memory plaintext = abi.encodePacked(boolValue ? bytes1(0x01) : bytes1(0x00));
        return TestHelper.buildDecryptionProof(handle, plaintext, GATEWAY_KEY);
    }

    function _wrapForUser(address user, uint256 amount) internal returns (bytes32 newBalanceHandle) {
        vm.prank(user);
        usdc.approve(address(cusdc), amount);

        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(user, address(cusdc));
        vm.prank(user);
        euint256 newBalance = cusdc.wrap(amount, handle, proof);
        newBalanceHandle = euint256.unwrap(newBalance);
    }

    // ====================================================================
    // Constructor
    // ====================================================================

    function test_Constructor_RevertsOnZeroUnderlying() public {
        vm.expectRevert(ConfidentialUSDC.InvalidUnderlying.selector);
        new ConfidentialUSDC(IERC20(address(0)), "x", "y");
    }

    function test_Constructor_StoresMetadata() public view {
        assertEq(cusdc.name(), "Confidential tUSDC");
        assertEq(cusdc.symbol(), "ctUSDC");
        assertEq(cusdc.decimals(), 6);
        assertEq(address(cusdc.underlying()), address(usdc));
    }

    // ====================================================================
    // Wrap
    // ====================================================================

    function test_Wrap_HappyPath() public {
        vm.prank(alice);
        usdc.approve(address(cusdc), DEPOSIT_AMOUNT);

        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(alice, address(cusdc));

        uint256 underlyingBefore = usdc.balanceOf(alice);
        uint256 vaultBefore = usdc.balanceOf(address(cusdc));

        vm.prank(alice);
        euint256 newBalance = cusdc.wrap(DEPOSIT_AMOUNT, handle, proof);

        // Underlying moved from alice into the vault.
        assertEq(usdc.balanceOf(alice), underlyingBefore - DEPOSIT_AMOUNT);
        assertEq(usdc.balanceOf(address(cusdc)), vaultBefore + DEPOSIT_AMOUNT);

        // Confidential balance handle persisted.
        bytes32 storedBalance = euint256.unwrap(cusdc.confidentialBalanceOf(alice));
        assertEq(storedBalance, euint256.unwrap(newBalance), "balance handle mismatch");
        assertTrue(storedBalance != bytes32(0), "balance not initialized");

        // Alice has viewer ACL on her balance handle (decrypt would succeed off-chain).
        assertTrue(noxCompute.isAllowed(storedBalance, alice), "alice missing ACL");
        assertTrue(noxCompute.isAllowed(storedBalance, address(cusdc)), "vault missing ACL");
    }

    function test_Wrap_EmitsEvent() public {
        vm.prank(alice);
        usdc.approve(address(cusdc), DEPOSIT_AMOUNT);
        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(alice, address(cusdc));

        vm.recordLogs();
        vm.prank(alice);
        cusdc.wrap(DEPOSIT_AMOUNT, handle, proof);

        // Find the Wrapped event (topic0 = keccak("Wrapped(address,uint256,bytes32)")).
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        bytes32 expectedTopic = keccak256("Wrapped(address,uint256,bytes32)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(cusdc) && logs[i].topics[0] == expectedTopic) {
                found = true;
                break;
            }
        }
        assertTrue(found, "Wrapped event not emitted");
    }

    function test_Wrap_RevertsOnZeroAmount() public {
        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(alice, address(cusdc));
        vm.expectRevert(ConfidentialUSDC.InvalidAmount.selector);
        vm.prank(alice);
        cusdc.wrap(0, handle, proof);
    }

    function test_Wrap_RevertsOnInsufficientAllowance() public {
        // No approve — transferFrom will revert.
        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(alice, address(cusdc));
        vm.expectRevert();
        vm.prank(alice);
        cusdc.wrap(DEPOSIT_AMOUNT, handle, proof);
    }

    function test_Wrap_RevertsOnInsufficientUnderlyingBalance() public {
        address poor = address(0xDEAD);
        vm.prank(poor);
        usdc.approve(address(cusdc), DEPOSIT_AMOUNT);
        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(poor, address(cusdc));
        vm.expectRevert();
        vm.prank(poor);
        cusdc.wrap(DEPOSIT_AMOUNT, handle, proof);
    }

    function test_Wrap_RevertsOnProofForDifferentApp() public {
        vm.prank(alice);
        usdc.approve(address(cusdc), DEPOSIT_AMOUNT);

        // Build proof binding handle to a DIFFERENT app contract.
        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(alice, address(0xBEEF));

        vm.expectRevert(); // INoxCompute.InvalidProof("App mismatch")
        vm.prank(alice);
        cusdc.wrap(DEPOSIT_AMOUNT, handle, proof);
    }

    function test_Wrap_RevertsOnProofForDifferentOwner() public {
        vm.prank(alice);
        usdc.approve(address(cusdc), DEPOSIT_AMOUNT);

        // Proof binds to bob as owner, but alice is calling.
        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(bob, address(cusdc));

        vm.expectRevert(); // INoxCompute.InvalidProof("Owner mismatch")
        vm.prank(alice);
        cusdc.wrap(DEPOSIT_AMOUNT, handle, proof);
    }

    function test_Wrap_RevertsOnExpiredProof() public {
        vm.prank(alice);
        usdc.approve(address(cusdc), DEPOSIT_AMOUNT);
        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(alice, address(cusdc));

        uint256 expiry = noxCompute.proofExpirationDuration();
        vm.warp(block.timestamp + expiry + 1);

        vm.expectRevert(); // InvalidProof("Proof expired")
        vm.prank(alice);
        cusdc.wrap(DEPOSIT_AMOUNT, handle, proof);
    }

    function test_Wrap_TwoSequentialDepositsAccumulate() public {
        bytes32 first = _wrapForUser(alice, DEPOSIT_AMOUNT);
        bytes32 second = _wrapForUser(alice, DEPOSIT_AMOUNT * 3);

        assertTrue(first != second, "second deposit should produce a new handle");
        bytes32 stored = euint256.unwrap(cusdc.confidentialBalanceOf(alice));
        assertEq(stored, second, "stored balance should be latest handle");
        assertTrue(noxCompute.isAllowed(stored, alice));
    }

    // ====================================================================
    // Reentrancy
    // ====================================================================

    function test_Wrap_NonReentrant() public {
        ReentrantUnderlying evilUsdc = new ReentrantUnderlying();
        ConfidentialUSDC evilCusdc = new ConfidentialUSDC(IERC20(address(evilUsdc)), "evil", "ev");

        evilUsdc.mint(alice, 1e18);
        vm.prank(alice);
        evilUsdc.approve(address(evilCusdc), 1e18);

        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(alice, address(evilCusdc));

        evilUsdc.arm(evilCusdc, handle, proof);

        // The reentrancy attempt happens in transferFrom; ReentrancyGuard should
        // make the inner wrap revert, which propagates as "ReentrancyGuardReentrantCall".
        vm.expectRevert();
        vm.prank(alice);
        evilCusdc.wrap(DEPOSIT_AMOUNT, handle, proof);
    }

    // ====================================================================
    // Unwrap (2-tx)
    // ====================================================================

    function test_RequestUnwrap_HappyPath() public {
        _wrapForUser(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        bytes32 requestId = cusdc.requestUnwrap(DEPOSIT_AMOUNT);

        (address user, uint256 amt) = cusdc.pendingUnwrap(requestId);
        assertEq(user, alice);
        assertEq(amt, DEPOSIT_AMOUNT);

        // success ebool was marked publicly decryptable.
        assertTrue(noxCompute.isPubliclyDecryptable(requestId), "success not public-decryptable");
    }

    function test_RequestUnwrap_RevertsOnZeroAmount() public {
        vm.expectRevert(ConfidentialUSDC.InvalidAmount.selector);
        vm.prank(alice);
        cusdc.requestUnwrap(0);
    }

    function test_FinalizeUnwrap_HappyPath() public {
        _wrapForUser(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        bytes32 requestId = cusdc.requestUnwrap(DEPOSIT_AMOUNT);

        // Gateway signs success=true.
        bytes memory dproof = _decryptionProofForBool(requestId, true);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 vaultBefore = usdc.balanceOf(address(cusdc));

        vm.prank(alice);
        cusdc.finalizeUnwrap(requestId, dproof);

        // Underlying flowed back to alice; pending request cleared.
        assertEq(usdc.balanceOf(alice), aliceBefore + DEPOSIT_AMOUNT);
        assertEq(usdc.balanceOf(address(cusdc)), vaultBefore - DEPOSIT_AMOUNT);

        (address user, uint256 amt) = cusdc.pendingUnwrap(requestId);
        assertEq(user, address(0));
        assertEq(amt, 0);
    }

    function test_FinalizeUnwrap_RevertsOnUnknownRequest() public {
        bytes32 fakeId = keccak256("nope");
        bytes memory dproof = _decryptionProofForBool(fakeId, true);
        vm.expectRevert(abi.encodeWithSelector(ConfidentialUSDC.UnknownUnwrapRequest.selector, fakeId));
        vm.prank(alice);
        cusdc.finalizeUnwrap(fakeId, dproof);
    }

    function test_FinalizeUnwrap_RevertsWhenBurnFailed() public {
        _wrapForUser(alice, DEPOSIT_AMOUNT);

        // Request unwrap of legitimate amount, but provide a proof asserting burn=false.
        vm.prank(alice);
        bytes32 requestId = cusdc.requestUnwrap(DEPOSIT_AMOUNT);
        bytes memory dproof = _decryptionProofForBool(requestId, false);

        vm.expectRevert(abi.encodeWithSelector(ConfidentialUSDC.UnwrapBurnFailed.selector, requestId));
        vm.prank(alice);
        cusdc.finalizeUnwrap(requestId, dproof);
    }

    function test_FinalizeUnwrap_NonReentrant() public {
        // We use the standard underlying here — verifying that the second call
        // to finalizeUnwrap with the same id reverts as UnknownUnwrapRequest
        // (since we delete _pendingUnwraps before the external transfer).
        _wrapForUser(alice, DEPOSIT_AMOUNT);
        vm.prank(alice);
        bytes32 requestId = cusdc.requestUnwrap(DEPOSIT_AMOUNT);
        bytes memory dproof = _decryptionProofForBool(requestId, true);

        vm.prank(alice);
        cusdc.finalizeUnwrap(requestId, dproof);

        // Second call should fail (state cleared).
        vm.expectRevert(abi.encodeWithSelector(ConfidentialUSDC.UnknownUnwrapRequest.selector, requestId));
        vm.prank(alice);
        cusdc.finalizeUnwrap(requestId, dproof);
    }

    // ====================================================================
    // Confidential transfer
    // ====================================================================

    function test_ConfidentialTransfer_WithProof() public {
        _wrapForUser(alice, DEPOSIT_AMOUNT);

        // Alice transfers a fresh-encrypted amount to bob.
        (externalEuint256 amtHandle, bytes memory amtProof) = _mintHandleWithProof(alice, address(cusdc));

        vm.prank(alice);
        euint256 transferred = cusdc.confidentialTransfer(bob, amtHandle, amtProof);

        bytes32 transferredId = euint256.unwrap(transferred);
        // Both sides have ACL on the transferred amount handle.
        assertTrue(noxCompute.isAllowed(transferredId, alice), "alice missing transferred ACL");
        assertTrue(noxCompute.isAllowed(transferredId, bob), "bob missing transferred ACL");

        // Both sides have ACL on their balance handles.
        bytes32 aliceBalance = euint256.unwrap(cusdc.confidentialBalanceOf(alice));
        bytes32 bobBalance = euint256.unwrap(cusdc.confidentialBalanceOf(bob));
        assertTrue(noxCompute.isAllowed(aliceBalance, alice));
        assertTrue(noxCompute.isAllowed(bobBalance, bob));
    }

    function test_ConfidentialTransfer_RevertsOnZeroReceiver() public {
        _wrapForUser(alice, DEPOSIT_AMOUNT);
        (externalEuint256 amtHandle, bytes memory amtProof) = _mintHandleWithProof(alice, address(cusdc));
        vm.expectRevert(abi.encodeWithSelector(ConfidentialUSDC.InvalidReceiver.selector, address(0)));
        vm.prank(alice);
        cusdc.confidentialTransfer(address(0), amtHandle, amtProof);
    }

    function test_ConfidentialTransfer_RevertsOnUnauthorizedAmount() public {
        _wrapForUser(alice, DEPOSIT_AMOUNT);
        // bob does not have ACL on alice's balance handle.
        euint256 aliceBalance = cusdc.confidentialBalanceOf(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConfidentialUSDC.UnauthorizedUseOfEncryptedAmount.selector,
                aliceBalance,
                bob
            )
        );
        vm.prank(bob);
        cusdc.confidentialTransfer(alice, aliceBalance);
    }

    // ====================================================================
    // Fuzz
    // ====================================================================

    function testFuzz_Wrap(uint128 amount) public {
        vm.assume(amount > 0);
        vm.assume(amount <= 10_000 * 1e6); // fits funded balance

        vm.prank(alice);
        usdc.approve(address(cusdc), amount);
        (externalEuint256 handle, bytes memory proof) = _mintHandleWithProof(alice, address(cusdc));

        vm.prank(alice);
        cusdc.wrap(amount, handle, proof);

        bytes32 stored = euint256.unwrap(cusdc.confidentialBalanceOf(alice));
        assertTrue(stored != bytes32(0));
        assertTrue(noxCompute.isAllowed(stored, alice));
    }
}
