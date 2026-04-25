// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IResolutionOracle} from "./interfaces/IResolutionOracle.sol";
import {IResolutionAdapter} from "./interfaces/IResolutionAdapter.sol";

/// @title ResolutionOracle
/// @notice Orchestrator that dispatches per-market resolution to the configured
///         adapter (admin signoff, Chainlink price feed, or pre-resolved). The
///         orchestrator itself holds no resolution logic — it just routes.
///         Owner-managed adapter assignment; resolve()/isReady() are public.
contract ResolutionOracle is IResolutionOracle, Ownable {
    error AdapterNotSet(uint256 marketId);
    error InvalidAdapter();

    mapping(uint256 marketId => address) private _adapter;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setAdapter(uint256 marketId, address adapter) external onlyOwner {
        if (adapter == address(0)) revert InvalidAdapter();
        _adapter[marketId] = adapter;
        emit AdapterSet(marketId, adapter);
    }

    function adapterOf(uint256 marketId) external view returns (address) {
        return _adapter[marketId];
    }

    function isReady(uint256 marketId) external view returns (bool) {
        address a = _adapter[marketId];
        if (a == address(0)) return false;
        return IResolutionAdapter(a).isReady(marketId);
    }

    function resolve(uint256 marketId) external returns (uint8 outcome) {
        address a = _adapter[marketId];
        if (a == address(0)) revert AdapterNotSet(marketId);
        emit ResolutionRequested(marketId, a, block.timestamp);
        outcome = IResolutionAdapter(a).resolve(marketId);
        emit ResolutionFulfilled(marketId, outcome, block.timestamp);
    }
}
