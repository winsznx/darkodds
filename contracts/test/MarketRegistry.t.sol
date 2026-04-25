// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {NoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/NoxCompute.sol";
import {TestHelper} from "@iexec-nox/nox-protocol-contracts/test/utils/TestHelper.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Market} from "../src/Market.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {IMarket} from "../src/interfaces/IMarket.sol";
import {ConfidentialUSDC} from "../src/ConfidentialUSDC.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

contract MarketRegistryTest is Test {
    NoxCompute private noxCompute;
    ConfidentialUSDC private cusdc;
    TestUSDC private usdc;
    Market private marketImpl;
    MarketRegistry private registry;

    address private constant OWNER = address(0xA11CE);
    uint256 private constant GATEWAY_KEY = 0xBEEF;

    function setUp() public {
        noxCompute = TestHelper.deploy(OWNER, vm.addr(GATEWAY_KEY));
        usdc = new TestUSDC(OWNER);
        cusdc = new ConfidentialUSDC(IERC20(address(usdc)), "ctUSDC", "ctUSDC");
        marketImpl = new Market();
        registry = new MarketRegistry(address(marketImpl), address(cusdc), OWNER);
    }

    // ====================================================================
    // Constructor
    // ====================================================================

    function test_Constructor_RevertsOnZeroImpl() public {
        vm.expectRevert(MarketRegistry.InvalidImplementation.selector);
        new MarketRegistry(address(0), address(cusdc), OWNER);
    }

    function test_Constructor_RevertsOnZeroCUSDC() public {
        vm.expectRevert(MarketRegistry.InvalidConfidentialUSDC.selector);
        new MarketRegistry(address(marketImpl), address(0), OWNER);
    }

    function test_Constructor_StoresState() public view {
        assertEq(registry.marketImplementation(), address(marketImpl));
        assertEq(registry.confidentialUSDC(), address(cusdc));
        assertEq(registry.owner(), OWNER);
        assertEq(registry.nextMarketId(), 0);
    }

    // ====================================================================
    // createMarket
    // ====================================================================

    function _create(string memory q, uint256 expiry) internal returns (uint256 id, address market) {
        vm.prank(OWNER);
        (id, market) = registry.createMarket(q, "criteria", 0, expiry, 200);
    }

    function test_CreateMarket_HappyPath() public {
        uint256 expiry = block.timestamp + 7 days;
        (uint256 id, address market) = _create("Will X happen?", expiry);

        assertEq(id, 0);
        assertTrue(market != address(0));
        assertEq(registry.markets(0), market);
        assertEq(registry.nextMarketId(), 1);

        // Cloned market state was initialized.
        IMarket m = IMarket(market);
        assertEq(m.id(), 0);
        assertEq(m.question(), "Will X happen?");
        assertEq(m.expiryTs(), expiry);
        assertEq(m.protocolFeeBps(), 200);
        assertEq(m.confidentialUSDC(), address(cusdc));
        assertEq(m.admin(), OWNER);
        assertEq(uint8(m.state()), uint8(IMarket.State.Open));
    }

    function test_CreateMarket_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        registry.createMarket("q", "c", 0, block.timestamp + 1 days, 200);
    }

    function test_CreateMarket_RevertsOnPastExpiry() public {
        vm.expectRevert(MarketRegistry.InvalidExpiry.selector);
        vm.prank(OWNER);
        registry.createMarket("q", "c", 0, block.timestamp, 200);
    }

    function test_CreateMarket_TwoMarketsHaveDistinctAddresses() public {
        (uint256 id1, address m1) = _create("q1", block.timestamp + 7 days);
        (uint256 id2, address m2) = _create("q2", block.timestamp + 7 days);
        assertEq(id1, 0);
        assertEq(id2, 1);
        assertTrue(m1 != m2, "clones should be at different addresses");
        assertEq(IMarket(m1).question(), "q1");
        assertEq(IMarket(m2).question(), "q2");
    }

    function test_CreateMarket_CloneCannotBeReinitialized() public {
        (, address m) = _create("q", block.timestamp + 7 days);
        vm.expectRevert(Market.AlreadyInitialized.selector);
        IMarket(m).initialize(99, "x", "y", 0, block.timestamp + 1 days, 100, address(cusdc), OWNER);
    }

    // ====================================================================
    // setMarketImplementation
    // ====================================================================

    function test_SetMarketImplementation_OnlyOwner() public {
        Market newImpl = new Market();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        registry.setMarketImplementation(address(newImpl));
    }

    function test_SetMarketImplementation_RevertsOnZero() public {
        vm.expectRevert(MarketRegistry.InvalidImplementation.selector);
        vm.prank(OWNER);
        registry.setMarketImplementation(address(0));
    }

    function test_SetMarketImplementation_HappyPath() public {
        Market newImpl = new Market();
        vm.prank(OWNER);
        registry.setMarketImplementation(address(newImpl));
        assertEq(registry.marketImplementation(), address(newImpl));
    }

    function test_SetMarketImplementation_OldClonesUnaffected() public {
        (, address oldMarket) = _create("q", block.timestamp + 7 days);
        Market newImpl = new Market();
        vm.prank(OWNER);
        registry.setMarketImplementation(address(newImpl));
        // Old clone still functions — its delegatecall target is the *first* impl.
        assertEq(IMarket(oldMarket).question(), "q");
    }
}
