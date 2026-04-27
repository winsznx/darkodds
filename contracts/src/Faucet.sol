// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Faucet
/// @notice F7 testnet faucet for TestUSDC. Anyone may call `claim()` once per
///         cooldown window (6h) to receive `CLAIM_AMOUNT` (1,000 TestUSDC at
///         6 decimals = 1e9 base units). Owner is the 2-of-3 Safe; owner can
///         pause/unpause and refill via `transferFrom` (requires prior approval).
///
///         The canonical top-up path is the Safe calling
///         `TestUSDC.mint(faucet, amount)` directly — `mint` is also onlyOwner
///         on TestUSDC and shares the same Safe owner. `refill()` is a backup
///         path for transferring already-held TestUSDC to the faucet.
///
/// @dev    Cooldown semantics: `_nextClaimAt[user]` stores the unix timestamp
///         after which the user may claim again. Default zero means
///         "never claimed → claimable now". `claim()` writes
///         `block.timestamp + COOLDOWN` after successful transfer (CEI order).
contract Faucet is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================
    // Errors
    // ============================================================

    error InvalidToken();
    error CooldownActive(uint256 nextAt);
    error InsufficientFaucetBalance(uint256 available, uint256 required);
    error InvalidAmount();

    // ============================================================
    // Events
    // ============================================================

    event Claimed(address indexed user, uint256 amount, uint256 nextClaimAt);
    event Refilled(address indexed by, uint256 amount);

    // ============================================================
    // Constants
    // ============================================================

    /// @notice 1,000 TestUSDC at 6 decimals.
    uint256 public constant CLAIM_AMOUNT = 1_000 * 10 ** 6;

    /// @notice Per-address cooldown between successful claims.
    uint256 public constant COOLDOWN = 6 hours;

    // ============================================================
    // Immutable state
    // ============================================================

    /// @notice The dispensed token. Wired to TestUSDC at deploy time.
    IERC20 public immutable token;

    // ============================================================
    // Mutable state
    // ============================================================

    mapping(address user => uint256 nextClaimAt) private _nextClaimAt;

    // ============================================================
    // Init
    // ============================================================

    constructor(address tokenAddress, address initialOwner) Ownable(initialOwner) {
        if (tokenAddress == address(0)) revert InvalidToken();
        token = IERC20(tokenAddress);
    }

    // ============================================================
    // Claim
    // ============================================================

    /// @notice Dispenses CLAIM_AMOUNT to caller; reverts if within cooldown
    ///         window or if faucet is empty/paused.
    function claim() external nonReentrant whenNotPaused {
        uint256 nextAt = _nextClaimAt[msg.sender];
        if (nextAt > block.timestamp) revert CooldownActive(nextAt);

        uint256 bal = token.balanceOf(address(this));
        if (bal < CLAIM_AMOUNT) revert InsufficientFaucetBalance(bal, CLAIM_AMOUNT);

        // Effects before interaction (CEI). Reentrancy guard is belt-and-suspenders;
        // SafeERC20 against TestUSDC has no reentry surface, but the guard keeps
        // this safe under any future ERC-777-style hook tokens swapped in.
        uint256 next = block.timestamp + COOLDOWN;
        _nextClaimAt[msg.sender] = next;

        token.safeTransfer(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT, next);
    }

    /// @notice Returns the unix timestamp at which `user` becomes eligible to
    ///         claim again. Zero if user has never claimed.
    function claimableAt(address user) external view returns (uint256) {
        return _nextClaimAt[user];
    }

    // ============================================================
    // Owner ops
    // ============================================================

    /// @notice Owner-mediated top-up via transferFrom. Owner must
    ///         `IERC20(token).approve(faucet, amount)` first.
    function refill(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Refilled(msg.sender, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
