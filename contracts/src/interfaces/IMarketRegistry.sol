// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title IMarketRegistry
/// @notice Factory + indexer for DarkOdds markets. Per-market state lives in
///         EIP-1167 minimal proxy clones of `marketImplementation()`, initialized
///         via `IMarket.initialize(...)`.
interface IMarketRegistry {
    event MarketCreated(uint256 indexed id, address market, string question, uint256 expiryTs);
    event MarketImplementationUpdated(address indexed previous, address indexed next);

    /// @notice The implementation contract that all created markets clone.
    function marketImplementation() external view returns (address);

    /// @notice The cUSDC token that all markets settle against.
    function confidentialUSDC() external view returns (address);

    /// @notice The resolution oracle orchestrator that all markets call.
    function resolutionOracle() external view returns (address);

    /// @notice Counter for the next market id (markets are zero-indexed by default).
    function nextMarketId() external view returns (uint256);

    /// @notice Lookup the market address for a given id, or address(0) if not created.
    function markets(uint256 id) external view returns (address);

    /// @notice Owner-only. Deploys a clone of the implementation, calls initialize.
    /// @param question            Human-readable market question.
    /// @param resolutionCriteria  How the market resolves (admin signoff, oracle, etc.).
    /// @param oracleType          0=admin, 1=chainlink, 2=preresolved.
    /// @param expiryTs            Unix timestamp at which the betting window closes.
    /// @param protocolFeeBps      Basis points (e.g. 200 = 2%) charged on payouts in F4.
    /// @return id      The newly assigned market id.
    /// @return market  The address of the freshly cloned market.
    function createMarket(
        string calldata question,
        string calldata resolutionCriteria,
        uint8 oracleType,
        uint256 expiryTs,
        uint256 protocolFeeBps
    ) external returns (uint256 id, address market);

    /// @notice Owner-only. Swap the implementation pointer (does not affect already-deployed clones).
    function setMarketImplementation(address newImpl) external;
}
