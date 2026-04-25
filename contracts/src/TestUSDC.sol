// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestUSDC
/// @notice 6-decimal ERC-20 stand-in for USDC on Arbitrum Sepolia. Owner-gated
///         minting drives the F8 faucet endpoint. Permit support lets the F8 web
///         flow approve `ConfidentialUSDC.wrap` in one signature.
/// @dev    Real USDC on Arbitrum is non-permitted; we add Permit here purely to
///         simplify test-net UX. This is intentional drift from the production
///         token shape and is documented in `KNOWN_LIMITATIONS.md` (will be
///         created in Phase F12 alongside the demo polish pass).
contract TestUSDC is ERC20, ERC20Permit, Ownable {
    constructor(
        address initialOwner
    ) ERC20("DarkOdds Test USDC", "tUSDC") ERC20Permit("DarkOdds Test USDC") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Owner-only mint, used by the F8 web faucet to top users up.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
