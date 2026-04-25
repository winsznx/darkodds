// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFeeVault} from "./interfaces/IFeeVault.sol";

/// @title FeeVault
/// @notice Receives the protocol-fee plaintext leg of a payout. Markets call
///         `receiveFee(amount)` after F5's claim handler unwraps the fee
///         portion of a winning payout into plaintext underlying. F4 ships the
///         surface; F5 wires the actual transfers from `Market.claimWinnings`.
///
///         Owner-managed allowlist of authorised markets gates `receiveFee` —
///         we do not lean on `MarketRegistry.markets(...)` because a single
///         registry can host many markets across multiple registries in the
///         future, and the allowlist is the simplest, auditable surface.
contract FeeVault is IFeeVault, Ownable {
    using SafeERC20 for IERC20;

    mapping(address market => bool) private _registeredMarkets;
    uint256 private _totalFees;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setMarketRegistered(address market, bool registered) external onlyOwner {
        _registeredMarkets[market] = registered;
        emit MarketRegistered(market, registered);
    }

    function isRegisteredMarket(address market) external view returns (bool) {
        return _registeredMarkets[market];
    }

    function totalFees() external view returns (uint256) {
        return _totalFees;
    }

    function receiveFee(uint256 amount) external {
        if (!_registeredMarkets[msg.sender]) revert UnknownMarket(msg.sender);
        unchecked {
            _totalFees += amount;
        }
        emit FeeReceived(msg.sender, amount);
    }

    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
        emit FeeWithdrawn(token, to, amount);
    }
}
