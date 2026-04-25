// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title IFeeVault
/// @notice Receives the protocol-fee plaintext leg of a payout. Markets call
///         `receiveFee(amount)` after F5's claim handler unwraps the fee
///         portion of a winning payout into plaintext underlying. F4 ships
///         the surface; F5 wires the actual transfers.
interface IFeeVault {
    event MarketRegistered(address indexed market, bool registered);
    event FeeReceived(address indexed market, uint256 amount);
    event FeeWithdrawn(address indexed token, address indexed to, uint256 amount);

    error UnknownMarket(address market);

    function setMarketRegistered(address market, bool registered) external;
    function isRegisteredMarket(address market) external view returns (bool);
    function totalFees() external view returns (uint256);

    function receiveFee(uint256 amount) external;
    function withdraw(address token, address to, uint256 amount) external;
}
