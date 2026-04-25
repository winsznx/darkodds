// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title IResolutionOracle
/// @notice Orchestrator that dispatches per-market resolution to the configured
///         `IResolutionAdapter`. Markets call `isReady` / `resolve` here; the
///         orchestrator routes to the adapter registered for that market id.
interface IResolutionOracle {
    event AdapterSet(uint256 indexed marketId, address indexed adapter);
    event ResolutionRequested(uint256 indexed marketId, address indexed adapter, uint256 timestamp);
    event ResolutionFulfilled(uint256 indexed marketId, uint8 outcome, uint256 timestamp);

    function setAdapter(uint256 marketId, address adapter) external;
    function adapterOf(uint256 marketId) external view returns (address);
    function isReady(uint256 marketId) external view returns (bool);
    function resolve(uint256 marketId) external returns (uint8 outcome);
}
