// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, Vm} from "forge-std/Test.sol";
import "encrypted-types/EncryptedTypes.sol";
import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {NoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/NoxCompute.sol";
import {TEEType} from "@iexec-nox/nox-protocol-contracts/contracts/shared/TypeUtils.sol";
import {TestHelper} from "@iexec-nox/nox-protocol-contracts/test/utils/TestHelper.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Market} from "../src/Market.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {ResolutionOracle} from "../src/ResolutionOracle.sol";
import {AdminOracle} from "../src/oracles/AdminOracle.sol";
import {PreResolvedOracle} from "../src/oracles/PreResolvedOracle.sol";
import {IMarket} from "../src/interfaces/IMarket.sol";
import {ConfidentialUSDC} from "../src/ConfidentialUSDC.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

contract MarketTest is Test {
    NoxCompute private noxCompute;
    ConfidentialUSDC private cusdc;
    TestUSDC private usdc;
    Market private market;
    MarketRegistry private registry;
    ResolutionOracle private resolutionOracle;
    AdminOracle private adminOracle;
    PreResolvedOracle private preOracle;

    address private constant OWNER = address(0xA11CE);
    uint256 private constant GATEWAY_KEY = 0xBEEF;

    address private alice = address(0xA1);
    address private bob = address(0xB0B);
    address private carol = address(0xCA40);

    uint256 private constant BET_AMOUNT = 50 * 1e6; // 50 tUSDC
    uint256 private expiryTs;
    uint256 private mid; // market.id() cached — `market.id()` inside an arg list
    // consumes vm.prank() one frame too early.

    function setUp() public {
        noxCompute = TestHelper.deploy(OWNER, vm.addr(GATEWAY_KEY));
        usdc = new TestUSDC(OWNER);
        cusdc = new ConfidentialUSDC(IERC20(address(usdc)), "ctUSDC", "ctUSDC");

        Market impl = new Market();
        resolutionOracle = new ResolutionOracle(OWNER);
        adminOracle = new AdminOracle(OWNER);
        preOracle = new PreResolvedOracle(OWNER);
        registry = new MarketRegistry(address(impl), address(cusdc), address(resolutionOracle), OWNER);

        expiryTs = block.timestamp + 7 days;
        vm.prank(OWNER);
        (uint256 createdId, address m) = registry.createMarket(
            "Will X happen?",
            "admin-resolved",
            0,
            expiryTs,
            200
        );
        market = Market(m);
        mid = createdId;

        // Wire AdminOracle as the adapter for this market id by default.
        vm.prank(OWNER);
        resolutionOracle.setAdapter(mid, address(adminOracle));

        // Top up alice + bob with tUSDC and wrap into cUSDC.
        vm.startPrank(OWNER);
        usdc.mint(alice, 10_000 * 1e6);
        usdc.mint(bob, 10_000 * 1e6);
        usdc.mint(carol, 10_000 * 1e6);
        vm.stopPrank();

        _wrapForUser(alice, 5_000 * 1e6);
        _wrapForUser(bob, 5_000 * 1e6);
        _wrapForUser(carol, 5_000 * 1e6);

        // Each user authorises the market as operator on cUSDC so placeBet
        // can transferFrom their balance.
        vm.prank(alice);
        cusdc.setOperator(address(market), uint48(block.timestamp + 30 days));
        vm.prank(bob);
        cusdc.setOperator(address(market), uint48(block.timestamp + 30 days));
        vm.prank(carol);
        cusdc.setOperator(address(market), uint48(block.timestamp + 30 days));
    }

    // ====================================================================
    // Helpers
    // ====================================================================

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

    function _wrapForUser(address user, uint256 amount) internal {
        vm.prank(user);
        usdc.approve(address(cusdc), amount);
        (externalEuint256 h, bytes memory p) = _mintHandleWithProof(user, address(cusdc));
        vm.prank(user);
        cusdc.wrap(amount, h, p);
    }

    function _placeBet(address user, uint8 side, uint256 /* amount */) internal {
        (externalEuint256 h, bytes memory p) = _mintHandleWithProof(user, address(market));
        vm.prank(user);
        market.placeBet(side, h, p);
    }

    // ====================================================================
    // Initialization (constructor + clone re-init)
    // ====================================================================

    function test_Initialize_StateOpen() public view {
        assertEq(uint8(market.state()), uint8(IMarket.State.Open));
        assertEq(market.expiryTs(), expiryTs);
        assertEq(market.claimWindowDeadline(), expiryTs + 7 days);
        assertEq(market.lastBatchTs(), block.timestamp);
        assertEq(market.totalBetCount(), 0);
        assertEq(market.batchCount(), 0);
    }

    function test_Initialize_RevertsOnSecondCall() public {
        vm.expectRevert(Market.AlreadyInitialized.selector);
        market.initialize(
            99,
            "x",
            "y",
            0,
            block.timestamp + 1 days,
            100,
            address(cusdc),
            address(resolutionOracle),
            OWNER
        );
    }

    function test_Initialize_RawImplCanBeInitialized() public {
        Market raw = new Market();
        raw.initialize(
            0,
            "q",
            "c",
            0,
            block.timestamp + 1 days,
            100,
            address(cusdc),
            address(resolutionOracle),
            OWNER
        );
        vm.expectRevert(Market.AlreadyInitialized.selector);
        raw.initialize(
            0,
            "q",
            "c",
            0,
            block.timestamp + 1 days,
            100,
            address(cusdc),
            address(resolutionOracle),
            OWNER
        );
    }

    function test_Initialize_RevertsOnPastExpiry() public {
        Market raw = new Market();
        vm.expectRevert(Market.InvalidExpiry.selector);
        raw.initialize(
            0,
            "q",
            "c",
            0,
            block.timestamp,
            100,
            address(cusdc),
            address(resolutionOracle),
            OWNER
        );
    }

    function test_Initialize_RevertsOnExcessiveFee() public {
        Market raw = new Market();
        vm.expectRevert(Market.InvalidFee.selector);
        raw.initialize(
            0,
            "q",
            "c",
            0,
            block.timestamp + 1 days,
            1_001,
            address(cusdc),
            address(resolutionOracle),
            OWNER
        );
    }

    function test_Initialize_RevertsOnInvalidOracleType() public {
        Market raw = new Market();
        vm.expectRevert(abi.encodeWithSelector(Market.InvalidOracleType.selector, uint8(3)));
        raw.initialize(
            0,
            "q",
            "c",
            3,
            block.timestamp + 1 days,
            100,
            address(cusdc),
            address(resolutionOracle),
            OWNER
        );
    }

    function test_Initialize_RevertsOnZeroOracle() public {
        Market raw = new Market();
        vm.expectRevert(Market.InvalidResolutionOracle.selector);
        raw.initialize(0, "q", "c", 0, block.timestamp + 1 days, 100, address(cusdc), address(0), OWNER);
    }

    // ====================================================================
    // placeBet
    // ====================================================================

    function test_PlaceBet_HappyPath_Yes() public {
        (externalEuint256 h, bytes memory p) = _mintHandleWithProof(alice, address(market));
        vm.recordLogs();
        vm.prank(alice);
        market.placeBet(1, h, p);

        // BetPlaced event emitted.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 expectedTopic = keccak256("BetPlaced(address,uint8,bytes32,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(market) && logs[i].topics[0] == expectedTopic) {
                found = true;
                break;
            }
        }
        assertTrue(found, "BetPlaced not emitted");

        // Per-user bet handle stored, ACL'd to alice.
        bytes32 yesBetId = euint256.unwrap(market.yesBet(alice));
        assertTrue(yesBetId != bytes32(0), "yesBet not stored");
        assertTrue(noxCompute.isAllowed(yesBetId, alice), "alice missing ACL on her bet");
        assertTrue(noxCompute.isAllowed(yesBetId, address(market)), "market missing ACL on bet");

        // No bet on the NO side.
        assertEq(euint256.unwrap(market.noBet(alice)), bytes32(0));

        // Counts increment.
        assertEq(market.totalBetCount(), 1);
        assertEq(market.pendingBatchBetCount(), 1);
    }

    function test_PlaceBet_HappyPath_No() public {
        _placeBet(alice, 0, BET_AMOUNT);
        assertTrue(euint256.unwrap(market.noBet(alice)) != bytes32(0));
        assertEq(euint256.unwrap(market.yesBet(alice)), bytes32(0));
    }

    function test_PlaceBet_RevertsOnInvalidSide() public {
        (externalEuint256 h, bytes memory p) = _mintHandleWithProof(alice, address(market));
        vm.expectRevert(abi.encodeWithSelector(Market.InvalidSide.selector, uint8(2)));
        vm.prank(alice);
        market.placeBet(2, h, p);
    }

    function test_PlaceBet_RevertsAfterExpiry() public {
        vm.warp(expiryTs);
        (externalEuint256 h, bytes memory p) = _mintHandleWithProof(alice, address(market));
        vm.expectRevert(Market.MarketExpired.selector);
        vm.prank(alice);
        market.placeBet(1, h, p);
    }

    function test_PlaceBet_RevertsAfterClose() public {
        vm.warp(expiryTs);
        market.closeMarket();
        (externalEuint256 h, bytes memory p) = _mintHandleWithProof(alice, address(market));
        vm.expectRevert(
            abi.encodeWithSelector(Market.WrongState.selector, IMarket.State.Open, IMarket.State.Closed)
        );
        vm.prank(alice);
        market.placeBet(1, h, p);
    }

    function test_PlaceBet_RevertsOnSecondBetSameSide() public {
        _placeBet(alice, 1, BET_AMOUNT);
        (externalEuint256 h, bytes memory p) = _mintHandleWithProof(alice, address(market));
        vm.expectRevert(abi.encodeWithSelector(Market.AlreadyBetThisSide.selector, alice, uint8(1)));
        vm.prank(alice);
        market.placeBet(1, h, p);
    }

    function test_PlaceBet_AllowsBothSidesPerUser() public {
        _placeBet(alice, 1, BET_AMOUNT);
        _placeBet(alice, 0, BET_AMOUNT);
        assertTrue(euint256.unwrap(market.yesBet(alice)) != bytes32(0));
        assertTrue(euint256.unwrap(market.noBet(alice)) != bytes32(0));
        assertEq(market.totalBetCount(), 2);
    }

    function test_PlaceBet_RevertsOnProofForDifferentApp() public {
        // Proof bound to a different "app" address — Nox.fromExternal will revert.
        (externalEuint256 h, bytes memory p) = _mintHandleWithProof(alice, address(0xBEEF));
        vm.expectRevert();
        vm.prank(alice);
        market.placeBet(1, h, p);
    }

    function test_PlaceBet_RevertsWhenUserHasNotApprovedOperator() public {
        // Fresh user with no operator approval on cUSDC.
        address dave = address(0xDA1E);
        vm.prank(OWNER);
        usdc.mint(dave, 10_000 * 1e6);
        _wrapForUser(dave, 1_000 * 1e6);
        // dave has cUSDC but never called setOperator — placeBet must revert
        // with cUSDC.UnauthorizedSpender.
        (externalEuint256 h, bytes memory p) = _mintHandleWithProof(dave, address(market));
        vm.expectRevert(
            abi.encodeWithSelector(ConfidentialUSDC.UnauthorizedSpender.selector, dave, address(market))
        );
        vm.prank(dave);
        market.placeBet(1, h, p);
    }

    // ====================================================================
    // publishBatch
    // ====================================================================

    function test_PublishBatch_RevertsBeforeInterval() public {
        _placeBet(alice, 1, BET_AMOUNT);
        // Initial lastBatchTs == block.timestamp at init; publishBatch needs +60s.
        vm.expectRevert(
            abi.encodeWithSelector(Market.BatchIntervalNotElapsed.selector, market.lastBatchTs() + 60)
        );
        market.publishBatch();
    }

    function test_PublishBatch_HappyPath_AfterInterval() public {
        _placeBet(alice, 1, BET_AMOUNT);
        _placeBet(bob, 0, BET_AMOUNT);

        uint256 priorBatchCount = market.batchCount();
        uint256 priorPending = market.pendingBatchBetCount();
        assertEq(priorPending, 2);

        vm.warp(market.lastBatchTs() + 61);

        vm.recordLogs();
        market.publishBatch();

        // BatchPublished event emitted with betsInBatch == 2.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("BatchPublished(uint256,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(market) && logs[i].topics[0] == topic) {
                // batchId is indexed (topic[1]); betsInBatch + timestamp are in data.
                (uint256 betsInBatch, ) = abi.decode(logs[i].data, (uint256, uint256));
                assertEq(betsInBatch, 2);
                found = true;
            }
        }
        assertTrue(found, "BatchPublished not emitted");

        // Batch counter incremented, pending reset, lastBatchTs updated.
        assertEq(market.batchCount(), priorBatchCount + 1);
        assertEq(market.pendingBatchBetCount(), 0);
        assertEq(market.lastBatchTs(), block.timestamp);

        // Published handle is publicly decryptable (per the lazy public-decrypt pattern).
        bytes32 yesPub = euint256.unwrap(market.yesPoolPublishedHandle());
        bytes32 noPub = euint256.unwrap(market.noPoolPublishedHandle());
        assertTrue(noxCompute.isPubliclyDecryptable(yesPub), "yes total not public");
        assertTrue(noxCompute.isPubliclyDecryptable(noPub), "no total not public");
    }

    function test_PublishBatch_MultiBatchSequence() public {
        _placeBet(alice, 1, BET_AMOUNT);
        _placeBet(bob, 1, BET_AMOUNT);
        _placeBet(carol, 0, BET_AMOUNT);

        vm.warp(market.lastBatchTs() + 61);
        market.publishBatch();
        assertEq(market.batchCount(), 1);

        // Round 2: 2 more bets (one new, one same-side from a fresh fund).
        // alice already bet YES and NO — give her a different alias address.
        address dave = address(0xDA1E);
        vm.prank(OWNER);
        usdc.mint(dave, 10_000 * 1e6);
        _wrapForUser(dave, 1_000 * 1e6);
        vm.prank(dave);
        cusdc.setOperator(address(market), uint48(block.timestamp + 30 days));
        _placeBet(dave, 1, BET_AMOUNT);
        // and alice on NO (her first NO bet)
        _placeBet(alice, 0, BET_AMOUNT);

        assertEq(market.pendingBatchBetCount(), 2);
        vm.warp(market.lastBatchTs() + 61);
        market.publishBatch();
        assertEq(market.batchCount(), 2);
        assertEq(market.pendingBatchBetCount(), 0);
        assertEq(market.totalBetCount(), 5);
    }

    function test_PublishBatch_EmptyBatchAllowed() public {
        // No bets placed, but anyone can still publish (rolls forward the timer).
        vm.warp(market.lastBatchTs() + 61);
        market.publishBatch();
        assertEq(market.batchCount(), 1);
        assertEq(market.pendingBatchBetCount(), 0);
    }

    // ====================================================================
    // closeMarket
    // ====================================================================

    function test_CloseMarket_RevertsBeforeExpiry() public {
        vm.expectRevert(Market.MarketNotExpired.selector);
        market.closeMarket();
    }

    function test_CloseMarket_HappyPath() public {
        _placeBet(alice, 1, BET_AMOUNT);
        vm.warp(expiryTs);
        market.closeMarket();
        assertEq(uint8(market.state()), uint8(IMarket.State.Closed));
    }

    function test_CloseMarket_AutoFlushesPendingBatch() public {
        _placeBet(alice, 1, BET_AMOUNT);
        _placeBet(bob, 0, BET_AMOUNT);
        assertEq(market.pendingBatchBetCount(), 2);
        assertEq(market.batchCount(), 0);

        vm.warp(expiryTs);
        market.closeMarket();

        // The pending batch was published as part of close.
        assertEq(market.batchCount(), 1);
        assertEq(market.pendingBatchBetCount(), 0);
        assertEq(uint8(market.state()), uint8(IMarket.State.Closed));
    }

    function test_CloseMarket_NoFlushIfEmpty() public {
        vm.warp(expiryTs);
        market.closeMarket();
        // No flush since pending was 0.
        assertEq(market.batchCount(), 0);
        assertEq(uint8(market.state()), uint8(IMarket.State.Closed));
    }

    function test_CloseMarket_RevertsIfAlreadyClosed() public {
        vm.warp(expiryTs);
        market.closeMarket();
        vm.expectRevert(
            abi.encodeWithSelector(Market.WrongState.selector, IMarket.State.Open, IMarket.State.Closed)
        );
        market.closeMarket();
    }

    // ====================================================================
    // markInvalid
    // ====================================================================

    function test_MarkInvalid_RevertsBeforeDeadline() public {
        vm.warp(expiryTs);
        market.closeMarket();
        vm.expectRevert(
            abi.encodeWithSelector(Market.ClaimWindowNotElapsed.selector, market.claimWindowDeadline())
        );
        market.markInvalid();
    }

    function test_MarkInvalid_HappyPathFromClosed() public {
        vm.warp(expiryTs);
        market.closeMarket();
        vm.warp(market.claimWindowDeadline() + 1);
        market.markInvalid();
        assertEq(uint8(market.state()), uint8(IMarket.State.Invalid));
        assertEq(market.outcome(), uint8(IMarket.Outcome.INVALID));
    }

    function test_MarkInvalid_HappyPathFromOpen() public {
        // Edge case: market never closed but the deadline elapsed anyway.
        vm.warp(market.claimWindowDeadline() + 1);
        market.markInvalid();
        assertEq(uint8(market.state()), uint8(IMarket.State.Invalid));
    }

    // ====================================================================
    // Resolution + Claim (F4)
    // ====================================================================

    /// @dev Drives a market from Open through Resolved with a YES outcome via
    ///      the AdminOracle commit-reveal flow + freezePool with gateway-issued
    ///      decryption proofs, leaving it in ClaimWindow once `CLAIM_OPEN_DELAY`
    ///      has passed. Used by the claim/refund test cases.
    function _resolveYes(uint256 yesTotal, uint256 noTotal) internal {
        // Place a YES bet so there's something to claim.
        _placeBet(alice, 1, BET_AMOUNT);

        // Close + flush + AdminOracle commit-reveal.
        vm.warp(expiryTs);
        market.closeMarket();

        bytes32 salt = keccak256("v1");
        bytes32 commitment = keccak256(abi.encode(uint8(1), salt));
        vm.prank(OWNER);
        adminOracle.commit(mid, commitment);
        vm.warp(block.timestamp + adminOracle.REVEAL_DELAY() + 1);
        vm.prank(OWNER);
        adminOracle.reveal(mid, uint8(1), salt);

        market.resolveOracle();
        assertEq(uint8(market.state()), uint8(IMarket.State.Resolving));
        assertEq(market.outcome(), uint8(1));

        // Build gateway proofs asserting yesPool/noPool plaintexts.
        bytes32 yesHandle = euint256.unwrap(market.yesPoolPublishedHandle());
        bytes32 noHandle = euint256.unwrap(market.noPoolPublishedHandle());
        bytes memory yesProof = TestHelper.buildDecryptionProof(yesHandle, abi.encode(yesTotal), GATEWAY_KEY);
        bytes memory noProof = TestHelper.buildDecryptionProof(noHandle, abi.encode(noTotal), GATEWAY_KEY);

        market.freezePool(yesProof, noProof);
        assertEq(uint8(market.state()), uint8(IMarket.State.ClaimWindow));
        assertEq(market.yesPoolFrozen(), yesTotal);
        assertEq(market.noPoolFrozen(), noTotal);

        // Roll past the claim-open delay so claimWinnings is callable.
        vm.warp(market.claimWindowOpensAt() + 1);
    }

    function test_ResolveAdmin_OnlyAdmin() public {
        vm.warp(expiryTs);
        market.closeMarket();
        vm.expectRevert(Market.OnlyAdmin.selector);
        vm.prank(alice);
        market.resolveAdmin(1);
    }

    function test_ResolveAdmin_HappyPath() public {
        vm.warp(expiryTs);
        market.closeMarket();
        vm.prank(OWNER);
        market.resolveAdmin(1);
        assertEq(uint8(market.state()), uint8(IMarket.State.Resolving));
        assertEq(market.outcome(), uint8(1));
        assertEq(market.resolutionTs(), block.timestamp);
    }

    function test_ResolveAdmin_RevertsOnInvalidOutcome() public {
        vm.warp(expiryTs);
        market.closeMarket();
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(Market.InvalidOutcome.selector, uint8(99)));
        market.resolveAdmin(99);
    }

    function test_ResolveOracle_BeforeExpiryReverts() public {
        vm.expectRevert(Market.MarketNotExpired.selector);
        market.resolveOracle();
    }

    function test_ResolveOracle_AdminOracleNotReadyReverts() public {
        vm.warp(expiryTs);
        market.closeMarket();
        vm.expectRevert(Market.OracleNotReady.selector);
        market.resolveOracle();
    }

    function test_ResolveOracle_PreResolved_HappyPath() public {
        // Re-wire to PreResolvedOracle for this market.
        vm.prank(OWNER);
        preOracle.configure(mid, uint8(1));
        vm.prank(OWNER);
        resolutionOracle.setAdapter(mid, address(preOracle));

        vm.warp(expiryTs);
        market.resolveOracle();
        assertEq(uint8(market.state()), uint8(IMarket.State.Resolving));
        assertEq(market.outcome(), uint8(1));
    }

    function test_ResolveOracle_AdminOracle_FullFlow() public {
        vm.warp(expiryTs);
        market.closeMarket();

        bytes32 salt = keccak256("flow-1");
        bytes32 commitment = keccak256(abi.encode(uint8(1), salt));
        vm.prank(OWNER);
        adminOracle.commit(mid, commitment);
        vm.warp(block.timestamp + adminOracle.REVEAL_DELAY() + 1);
        vm.prank(OWNER);
        adminOracle.reveal(mid, uint8(1), salt);

        market.resolveOracle();
        assertEq(uint8(market.state()), uint8(IMarket.State.Resolving));
    }

    function test_ResolveOracle_INVALID_GoesStraightToInvalid() public {
        vm.prank(OWNER);
        preOracle.configure(mid, uint8(2)); // INVALID
        vm.prank(OWNER);
        resolutionOracle.setAdapter(mid, address(preOracle));

        vm.warp(expiryTs);
        market.resolveOracle();
        assertEq(uint8(market.state()), uint8(IMarket.State.Invalid));
    }

    function test_FreezePool_RevertsBeforeResolution() public {
        bytes memory empty = "";
        vm.expectRevert(
            abi.encodeWithSelector(Market.WrongState.selector, IMarket.State.Resolving, IMarket.State.Open)
        );
        market.freezePool(empty, empty);
    }

    function test_FreezePool_HappyPath() public {
        _resolveYes(BET_AMOUNT, 0); // alice bet 1 unit on YES, no NO bets
        // _resolveYes asserts state == ClaimWindow and frozen totals
    }

    function test_ClaimWinnings_HappyPath_RecordsClaim() public {
        _resolveYes(BET_AMOUNT, 0);
        vm.recordLogs();
        vm.prank(alice);
        market.claimWinnings();
        assertTrue(market.hasClaimed(alice));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("ClaimRecorded(address,uint8,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(market) && logs[i].topics[0] == topic) found = true;
        }
        assertTrue(found, "ClaimRecorded not emitted");
    }

    function test_ClaimWinnings_RevertsBeforeClaimWindow() public {
        _placeBet(alice, 1, BET_AMOUNT);
        vm.warp(expiryTs);
        market.closeMarket();
        vm.prank(OWNER);
        market.resolveAdmin(1);
        // State is Resolving; freezePool not called → claim must revert.
        vm.expectRevert(abi.encodeWithSelector(Market.ClaimWindowNotOpen.selector, uint256(0)));
        vm.prank(alice);
        market.claimWinnings();
    }

    function test_ClaimWinnings_RevertsOnDoubleClaim() public {
        _resolveYes(BET_AMOUNT, 0);
        vm.prank(alice);
        market.claimWinnings();
        vm.expectRevert(Market.AlreadyClaimed.selector);
        vm.prank(alice);
        market.claimWinnings();
    }

    function test_ClaimWinnings_LoserCannotClaim() public {
        // Bob bet on NO — alice on YES.
        _placeBet(bob, 0, BET_AMOUNT);
        _resolveYes(BET_AMOUNT, BET_AMOUNT);
        vm.expectRevert(Market.NoWinningPosition.selector);
        vm.prank(bob);
        market.claimWinnings();
    }

    function test_ClaimWinnings_NonBettorCannotClaim() public {
        _resolveYes(BET_AMOUNT, 0);
        // carol never placed a bet.
        vm.expectRevert(Market.NoWinningPosition.selector);
        vm.prank(carol);
        market.claimWinnings();
    }

    // ---- F5 payout tests ----

    function test_ClaimWinnings_F5_EmitsClaimSettled() public {
        _resolveYes(BET_AMOUNT, 0);
        vm.recordLogs();
        vm.prank(alice);
        market.claimWinnings();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 settledTopic = keccak256("ClaimSettled(address,uint8,bytes32,bytes32)");
        bool foundSettled;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(market) && logs[i].topics[0] == settledTopic) {
                foundSettled = true;
                // payoutHandle (data[0]) and feeHandle (data[32]) must be non-zero Nox handles.
                bytes32 payoutHandle = abi.decode(logs[i].data, (bytes32));
                assertTrue(payoutHandle != bytes32(0), "payoutHandle is zero");
            }
        }
        assertTrue(foundSettled, "ClaimSettled not emitted");
    }

    function test_ClaimWinnings_F5_ConfidentialTransferEmitted() public {
        _resolveYes(BET_AMOUNT, 0);
        vm.recordLogs();
        vm.prank(alice);
        market.claimWinnings();

        // Verify cUSDC emitted ConfidentialTransfer from market → alice.
        // euint256 is `type euint256 is bytes32` so the ABI canonical type is bytes32.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 transferTopic = keccak256("ConfidentialTransfer(address,address,bytes32)");
        bool foundTransfer;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(cusdc) && logs[i].topics[0] == transferTopic) {
                address from = address(uint160(uint256(logs[i].topics[1])));
                address to = address(uint160(uint256(logs[i].topics[2])));
                if (from == address(market) && to == alice) foundTransfer = true;
            }
        }
        assertTrue(foundTransfer, "ConfidentialTransfer market->alice not emitted");
    }

    function test_ClaimWinnings_F5_BothSides_WinnerClaims() public {
        // Bob bets NO, alice bets YES. YES wins.
        _placeBet(bob, 0, BET_AMOUNT);
        _resolveYes(BET_AMOUNT, BET_AMOUNT);

        vm.prank(alice);
        market.claimWinnings();
        assertTrue(market.hasClaimed(alice));

        // Bob (loser) cannot claim.
        vm.expectRevert(Market.NoWinningPosition.selector);
        vm.prank(bob);
        market.claimWinnings();
    }

    // ---- F5-followup edge case tests: empty-winning-side handling ----

    /// @dev Drives a market to Resolving with adminOracle for outcome=1 (YES),
    ///      then exposes raw freezePool so the caller can supply arbitrary
    ///      plaintext totals for both pools. Used by empty-side tests.
    function _resolveToYes_RawFreeze(uint256 yesPlain, uint256 noPlain) internal {
        vm.warp(expiryTs);
        market.closeMarket();

        bytes32 salt = keccak256("empty-side");
        bytes32 commitment = keccak256(abi.encode(uint8(1), salt));
        vm.prank(OWNER);
        adminOracle.commit(mid, commitment);
        vm.warp(block.timestamp + adminOracle.REVEAL_DELAY() + 1);
        vm.prank(OWNER);
        adminOracle.reveal(mid, uint8(1), salt);

        market.resolveOracle();
        assertEq(uint8(market.state()), uint8(IMarket.State.Resolving));

        bytes32 yesHandle = euint256.unwrap(market.yesPoolPublishedHandle());
        bytes32 noHandle = euint256.unwrap(market.noPoolPublishedHandle());
        bytes memory yesProof = TestHelper.buildDecryptionProof(yesHandle, abi.encode(yesPlain), GATEWAY_KEY);
        bytes memory noProof = TestHelper.buildDecryptionProof(noHandle, abi.encode(noPlain), GATEWAY_KEY);
        market.freezePool(yesProof, noProof);
    }

    /// @notice Empty-winning-side: outcome=YES but yesPoolFrozen==0. F5-followup
    ///         strict fix transitions the market straight to Invalid (instead of
    ///         ClaimWindow) so losers can refundIfInvalid. Pre-fix this state
    ///         was reachable but unrecoverable — claimWinnings reverts for
    ///         everyone (NoWinningPosition) and markInvalid disallows
    ///         ClaimWindow → funds locked forever.
    function test_FreezePool_F5fu_EmptyWinningSide_AutoInvalidates() public {
        // Alice bets NO only — no one bets YES.
        _placeBet(alice, 0, BET_AMOUNT);
        _resolveToYes_RawFreeze(0, BET_AMOUNT);

        // State must be Invalid, not ClaimWindow.
        assertEq(uint8(market.state()), uint8(IMarket.State.Invalid));
        assertEq(market.outcome(), uint8(IMarket.Outcome.INVALID));
        assertEq(market.claimWindowOpensAt(), 0, "claimWindowOpensAt must remain unset");
    }

    function test_FreezePool_F5fu_EmptyWinningSide_EmitsMarketInvalidated() public {
        _placeBet(alice, 0, BET_AMOUNT);

        vm.recordLogs();
        _resolveToYes_RawFreeze(0, BET_AMOUNT);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 invalidatedTopic = keccak256("MarketInvalidated(uint256)");
        bytes32 claimOpenedTopic = keccak256("ClaimWindowOpened(uint256)");
        bool foundInvalidated;
        bool foundClaimOpened;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(market)) continue;
            if (logs[i].topics[0] == invalidatedTopic) foundInvalidated = true;
            if (logs[i].topics[0] == claimOpenedTopic) foundClaimOpened = true;
        }
        assertTrue(foundInvalidated, "MarketInvalidated not emitted on empty-winning-side");
        assertFalse(foundClaimOpened, "ClaimWindowOpened must NOT emit on empty-winning-side");
    }

    function test_FreezePool_F5fu_EmptyWinningSide_LoserCanRefund() public {
        _placeBet(alice, 0, BET_AMOUNT);
        _resolveToYes_RawFreeze(0, BET_AMOUNT);

        // Alice has a NO bet, market is Invalid → refundIfInvalid is the path.
        assertTrue(euint256.unwrap(market.noBet(alice)) != bytes32(0));

        vm.prank(alice);
        bytes32 refundHandle = market.refundIfInvalid();
        assertTrue(refundHandle != bytes32(0));
        assertEq(euint256.unwrap(market.noBet(alice)), bytes32(0));
    }

    /// @notice Empty-LOSING-side: outcome=YES with noPoolFrozen==0 is a degenerate
    ///         but legitimate resolution. Winners get exactly their stake back
    ///         (payout = userBet * userBet / userBet = userBet, minus protocol
    ///         fee). Stays on the Resolved/ClaimWindow path per the strict fix
    ///         documented in DRIFT_LOG F5-followup.
    function test_FreezePool_F5fu_EmptyLosingSide_StaysClaimWindow() public {
        _placeBet(alice, 1, BET_AMOUNT);
        _resolveToYes_RawFreeze(BET_AMOUNT, 0);

        // State must be ClaimWindow (the existing happy path), not Invalid.
        assertEq(uint8(market.state()), uint8(IMarket.State.ClaimWindow));
        assertEq(market.outcome(), uint8(1));
        assertGt(market.claimWindowOpensAt(), 0);
    }

    function test_FreezePool_F5fu_EmptyLosingSide_WinnerClaimsBreakEven() public {
        _placeBet(alice, 1, BET_AMOUNT);
        _resolveToYes_RawFreeze(BET_AMOUNT, 0);

        vm.warp(market.claimWindowOpensAt() + 1);
        vm.prank(alice);
        market.claimWinnings();
        assertTrue(market.hasClaimed(alice));
    }

    function test_RefundIfInvalid_RevertsWhenNotInvalid() public {
        vm.expectRevert(Market.NotInvalid.selector);
        vm.prank(alice);
        market.refundIfInvalid();
    }

    function test_RefundIfInvalid_HappyPath() public {
        _placeBet(alice, 1, BET_AMOUNT);
        // Simulate adapter-returned-INVALID path.
        vm.prank(OWNER);
        preOracle.configure(mid, uint8(2));
        vm.prank(OWNER);
        resolutionOracle.setAdapter(mid, address(preOracle));
        vm.warp(expiryTs);
        market.resolveOracle();
        assertEq(uint8(market.state()), uint8(IMarket.State.Invalid));

        bytes32 prevYesBet = euint256.unwrap(market.yesBet(alice));
        assertTrue(prevYesBet != bytes32(0));

        vm.recordLogs();
        vm.prank(alice);
        bytes32 refundHandle = market.refundIfInvalid();
        // Post-F4.5 hardening: refund returns the cUSDC-emitted "actually
        // transferred" encrypted handle, not the previously-stored bet
        // handle. The two encode the same plaintext value but are distinct
        // Nox handles — the contract refunds what was *actually* moved.
        assertTrue(refundHandle != bytes32(0));

        // alice's yesBet is cleared.
        assertEq(euint256.unwrap(market.yesBet(alice)), bytes32(0));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("Refunded(address,bytes32)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(market) && logs[i].topics[0] == topic) found = true;
        }
        assertTrue(found, "Refunded not emitted");
    }

    function test_RefundIfInvalid_BothSidesSequentially() public {
        _placeBet(alice, 1, BET_AMOUNT);
        _placeBet(alice, 0, BET_AMOUNT);
        vm.prank(OWNER);
        preOracle.configure(mid, uint8(2));
        vm.prank(OWNER);
        resolutionOracle.setAdapter(mid, address(preOracle));
        vm.warp(expiryTs);
        market.resolveOracle();

        vm.prank(alice);
        market.refundIfInvalid();
        // First call refunds YES.
        assertEq(euint256.unwrap(market.yesBet(alice)), bytes32(0));
        assertTrue(euint256.unwrap(market.noBet(alice)) != bytes32(0));

        vm.prank(alice);
        market.refundIfInvalid();
        // Second call refunds NO.
        assertEq(euint256.unwrap(market.noBet(alice)), bytes32(0));

        // Third call reverts: nothing left.
        vm.expectRevert(Market.NoBetToRefund.selector);
        vm.prank(alice);
        market.refundIfInvalid();
    }
}
