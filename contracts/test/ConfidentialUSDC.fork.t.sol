// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {INoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol";

/// @dev Optional fork test against the live Arb Sepolia Nox protocol contract.
///      Gated behind FORK_TEST=1 — opt-in via env so contributor PRs run fast.
///      Run via:
///          FORK_TEST=1 forge test --match-contract ConfidentialUSDCForkTest \
///              --root contracts \
///              --fork-url https://sepolia-rollup.arbitrum.io/rpc
///      Proves the iExec-resolved Nox protocol address actually has bytecode on
///      Arb Sepolia at the moment the test runs.
contract ConfidentialUSDCForkTest is Test {
    function test_NoxComputeContractIsDeployedOnArbSepolia() public {
        if (vm.envOr("FORK_TEST", uint256(0)) != 1) {
            vm.skip(true);
        }
        // Force Nox lib to resolve Arb Sepolia regardless of the fork's
        // reported chainId — protects against future Nox lib chainid behaviour.
        vm.chainId(421614);

        address noxAddr = Nox.noxComputeContract();
        assertEq(noxAddr, 0xd464B198f06756a1d00be223634b85E0a731c229, "address mismatch");

        uint256 codeSize;
        assembly {
            codeSize := extcodesize(noxAddr)
        }
        assertGt(codeSize, 0, "Nox protocol contract has no bytecode on the forked chain");

        // The deployed contract should also expose its INoxCompute surface —
        // calling a view function proves the proxy is initialised.
        address gw = INoxCompute(noxAddr).gateway();
        assertTrue(gw != address(0), "gateway not configured");
    }
}
