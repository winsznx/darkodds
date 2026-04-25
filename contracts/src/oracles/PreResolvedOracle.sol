// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IResolutionAdapter} from "../interfaces/IResolutionAdapter.sol";

/// @title PreResolvedOracle
/// @notice Adapter for the demo's "guaranteed claim flow" market (PRD §3.3
///         step G). The market is created with a hard-coded outcome that
///         `resolve()` returns immediately. Owner can configure additional
///         markets but cannot mutate an existing entry.
contract PreResolvedOracle is IResolutionAdapter, Ownable {
    error AlreadyConfigured(uint256 marketId);
    error NotConfigured(uint256 marketId);
    error InvalidOutcome(uint8 outcome);

    struct Config {
        bool configured;
        uint8 outcome;
    }

    mapping(uint256 marketId => Config) public configs;

    event MarketConfigured(uint256 indexed marketId, uint8 outcome);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function configure(uint256 marketId, uint8 outcome) external onlyOwner {
        if (configs[marketId].configured) revert AlreadyConfigured(marketId);
        if (outcome > 2) revert InvalidOutcome(outcome);
        configs[marketId] = Config({configured: true, outcome: outcome});
        emit MarketConfigured(marketId, outcome);
    }

    function isReady(uint256 marketId) external view returns (bool) {
        return configs[marketId].configured;
    }

    function resolve(uint256 marketId) external view returns (uint8) {
        Config storage c = configs[marketId];
        if (!c.configured) revert NotConfigured(marketId);
        return c.outcome;
    }
}
