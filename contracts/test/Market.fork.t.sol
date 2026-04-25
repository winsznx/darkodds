// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {INoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol";

/// @dev Optional fork test that confirms our F3 expectations about the live
///      NoxCompute proxy on Arbitrum Sepolia: address resolution still works
///      and the gateway is configured. Gated behind FORK_TEST=1.
///
///          FORK_TEST=1 forge test --match-contract MarketForkTest \
///              --root contracts \
///              --fork-url https://sepolia-rollup.arbitrum.io/rpc \
///              --fork-block-number $(cast block-number --rpc-url https://sepolia-rollup.arbitrum.io/rpc)
contract MarketForkTest is Test {
    function test_NoxComputeStillResolvesOnArbSepolia() public {
        if (vm.envOr("FORK_TEST", uint256(0)) != 1) {
            vm.skip(true);
        }
        vm.chainId(421614);
        address nox = Nox.noxComputeContract();
        assertEq(nox, 0xd464B198f06756a1d00be223634b85E0a731c229);

        uint256 codeSize;
        assembly {
            codeSize := extcodesize(nox)
        }
        assertGt(codeSize, 0, "Nox protocol contract has no bytecode");
        assertTrue(INoxCompute(nox).gateway() != address(0), "gateway not set");
    }
}
