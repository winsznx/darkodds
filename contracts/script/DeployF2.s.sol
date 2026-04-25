// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {ConfidentialUSDC} from "../src/ConfidentialUSDC.sol";

/// @dev Deploys F2 contracts to Arbitrum Sepolia. Reads DEPLOYER_PRIVATE_KEY
///      from env, broadcasts both deployments under it, writes deployment
///      artifact JSON to deployments/arb-sepolia.json.
///
/// Usage:
///   forge script script/DeployF2.s.sol --root contracts \
///       --rpc-url $ARB_SEPOLIA_RPC_URL --broadcast --verify \
///       --verifier blockscout \
///       --verifier-url https://arbitrum-sepolia.blockscout.com/api
contract DeployF2 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        TestUSDC usdc = new TestUSDC(deployer);
        console.log("TestUSDC:", address(usdc));

        ConfidentialUSDC cusdc = new ConfidentialUSDC(IERC20(address(usdc)), "Confidential tUSDC", "ctUSDC");
        console.log("ConfidentialUSDC:", address(cusdc));

        vm.stopBroadcast();

        // Write deployment artifact. Foundry's vm.writeJson serializes from a
        // struct-shaped key path, so we hand-build the JSON to keep the
        // canonical {chainId, contracts, deployedAt} shape from the prompt.
        string memory json = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "contracts": {\n',
            '    "TestUSDC": "',
            vm.toString(address(usdc)),
            '",\n',
            '    "ConfidentialUSDC": "',
            vm.toString(address(cusdc)),
            '",\n',
            '    "NoxProtocol": "0xd464B198f06756a1d00be223634b85E0a731c229"\n',
            "  },\n",
            '  "deployer": "',
            vm.toString(deployer),
            '",\n',
            '  "deployedAt": ',
            vm.toString(block.timestamp),
            "\n}\n"
        );
        vm.writeFile("./deployments/arb-sepolia.json", json);
        console.log("Wrote ./deployments/arb-sepolia.json");
    }
}
