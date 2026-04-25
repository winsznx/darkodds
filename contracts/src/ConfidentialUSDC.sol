// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import "encrypted-types/EncryptedTypes.sol";
import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IConfidentialUSDC} from "./interfaces/IConfidentialUSDC.sol";
import {IERC7984} from "./interfaces/IERC7984.sol";

/// @title ConfidentialUSDC
/// @notice Nox-native ERC-7984-shape wrapper over a plaintext ERC-20.
///         Built on the iExec-Nox Solidity library per PRD §5.1.1
///         (NOT inheriting OpenZeppelin Confidential Contracts, which is
///         FHEVM-only and would disconnect from Nox's on-chain ACL).
///
/// Storage model:
///   - `_balances[user]` is a `euint256` handle whose ACL grants the user
///     persistent viewer access (so off-chain `decrypt(handle)` succeeds).
///   - `_totalSupply` is a `euint256` whose ACL is held only by this contract
///     (intentional: total supply is not part of the user disclosure path).
///
/// Wrap (single tx):
///   user → encryptInput(amount, 'uint256', address(this)) off-chain (Nox SDK)
///        → wrap(amount, externalHandle, proof) on-chain
///        → SafeERC20.transferFrom(underlying, user → this, amount)
///        → Nox.fromExternal(externalHandle, proof)  // grants this contract transient ACL
///        → Nox.mint(balance, amount, totalSupply)   // atomic encrypted update
///        → Nox.allow(newBalance, user)              // user can decrypt their balance
///
/// Unwrap (two tx, mirrors OpenZeppelin FHEVM ERC7984ERC20Wrapper pattern):
///   tx 1 — requestUnwrap(amount):
///        → encrypt the requested amount as a public handle
///        → Nox.burn(balance, amount, totalSupply) → (success, newBalance, newSupply)
///        → mark `success` publicly decryptable so anyone can verify the burn outcome
///        → store {user, amount} under the requestId (= success handle bytes)
///   tx 2 — finalizeUnwrap(requestId, decryptionProof):
///        → Nox.publicDecrypt(success, decryptionProof) returns true/false
///        → if true: SafeERC20.safeTransfer(underlying, user, amount)
///        → if false: revert (caller must re-request with smaller amount)
///
/// All state-mutating user functions are nonReentrant and follow CEI.
contract ConfidentialUSDC is IConfidentialUSDC, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ====================================================================
    // Errors
    // ====================================================================

    error InvalidUnderlying();
    error InvalidAmount();
    error InvalidReceiver(address to);
    error InvalidSender(address from);
    error UnauthorizedUseOfEncryptedAmount(euint256 amount, address user);
    error UnknownUnwrapRequest(bytes32 requestId);
    error UnwrapBurnFailed(bytes32 requestId);
    error UnauthorizedSpender(address from, address spender);
    error InvalidOperator(address operator);

    // ====================================================================
    // Storage
    // ====================================================================

    IERC20 private immutable _underlying;
    string private _name;
    string private _symbol;
    uint8 private immutable _decimals;

    mapping(address holder => euint256) private _balances;
    euint256 private _totalSupply;

    struct PendingUnwrap {
        address user;
        uint256 amount;
    }

    mapping(bytes32 requestId => PendingUnwrap) private _pendingUnwraps;

    /// @dev `_operatorUntil[holder][operator]` is the unix timestamp through
    ///      which `operator` may move tokens on behalf of `holder`. Zero or
    ///      a past value means "not currently authorized".
    mapping(address holder => mapping(address operator => uint48)) private _operatorUntil;

    // ====================================================================
    // Constructor
    // ====================================================================

    /// @param underlying_  Plaintext ERC-20 backing this confidential token (e.g., TestUSDC).
    /// @param name_        Display name.
    /// @param symbol_      Display symbol.
    constructor(IERC20 underlying_, string memory name_, string memory symbol_) {
        if (address(underlying_) == address(0)) revert InvalidUnderlying();
        _underlying = underlying_;
        _name = name_;
        _symbol = symbol_;
        _decimals = IERC20Metadata(address(underlying_)).decimals();

        // Initialize encrypted total supply at zero. `Nox.toEuint256(0)` produces
        // a public handle (no ACL needed) — the supply value will become unique
        // (ACL-controlled) on the first `mint` operation.
        _totalSupply = Nox.toEuint256(0);
    }

    // ====================================================================
    // ERC-7984 metadata
    // ====================================================================

    function name() external view returns (string memory) {
        return _name;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function underlying() external view returns (IERC20) {
        return _underlying;
    }

    function confidentialTotalSupply() external view returns (euint256) {
        return _totalSupply;
    }

    function confidentialBalanceOf(address account) external view returns (euint256) {
        return _balances[account];
    }

    // ====================================================================
    // Wrap
    // ====================================================================

    function wrap(
        uint256 amount,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external nonReentrant returns (euint256 newBalance) {
        if (amount == 0) revert InvalidAmount();

        // Effects: mark intent before any external interaction. (No state writes
        // happen until after the underlying pull, but the mint/balance update
        // sequence below is the canonical CEI: pull, validate, compute, store.)

        // Interaction 1: pull underlying. SafeERC20 reverts on failure.
        _underlying.safeTransferFrom(msg.sender, address(this), amount);

        // Interaction 2: validate the gateway-issued handle proof. After this
        // call, this contract has *transient* ACL on `amount`. The proof binds
        // `encryptedAmount` to (msg.sender as owner, this contract as app).
        euint256 amountHandle = Nox.fromExternal(encryptedAmount, inputProof);

        // Resolve the caller's existing balance (zero handle on first deposit).
        euint256 balance = _balances[msg.sender];
        if (!Nox.isInitialized(balance)) {
            balance = Nox.toEuint256(0);
        }

        // Atomic encrypted mint: produces (success, newBalance, newSupply).
        ebool success;
        euint256 newSupply;
        (success, newBalance, newSupply) = Nox.mint(balance, amountHandle, _totalSupply);

        // Persist new state and grant ACL. Every TEE-output handle MUST receive
        // `allowThis` immediately, otherwise the contract loses the ability to
        // use it as input to future operations (per Nox SDK semantics).
        _balances[msg.sender] = newBalance;
        Nox.allowThis(newBalance);
        Nox.allow(newBalance, msg.sender); // user can off-chain `decrypt(newBalance)`

        _totalSupply = newSupply;
        Nox.allowThis(newSupply);

        // ACL housekeeping for the success bool — kept on this contract for
        // possible future invariants checks (e.g., asserting mint never fails).
        Nox.allowThis(success);

        emit Wrapped(msg.sender, amount, newBalance);
    }

    // ====================================================================
    // Unwrap (2-tx)
    // ====================================================================

    function requestUnwrap(uint256 amount) external nonReentrant returns (bytes32 requestId) {
        if (amount == 0) revert InvalidAmount();

        // Encrypt the requested withdrawal as a public handle. This intentionally
        // discloses the unwrap amount on-chain — privacy ends when the user
        // chooses to convert back to plaintext underlying.
        euint256 amountHandle = Nox.toEuint256(amount);

        euint256 balance = _balances[msg.sender];
        if (!Nox.isInitialized(balance)) {
            balance = Nox.toEuint256(0);
        }

        // Atomic encrypted burn: returns success bool + new balance + new supply.
        // If the user's balance < amount, success encrypts `false` and balance
        // is unchanged (Nox semantics).
        ebool success;
        euint256 newBalance;
        euint256 newSupply;
        (success, newBalance, newSupply) = Nox.burn(balance, amountHandle, _totalSupply);

        _balances[msg.sender] = newBalance;
        Nox.allowThis(newBalance);
        Nox.allow(newBalance, msg.sender);

        _totalSupply = newSupply;
        Nox.allowThis(newSupply);

        // Mark `success` publicly decryptable so the gateway will issue a public
        // decryption proof for it. allowPublicDecryption requires this contract
        // to first hold ACL on the handle, so allowThis must come first.
        Nox.allowThis(success);
        Nox.allowPublicDecryption(success);

        // The success-bool handle (as bytes32) is the request id. Different
        // unwrap calls produce different success handles (Nox handles are
        // unique per TEE op), so collisions are avoided by the protocol.
        requestId = ebool.unwrap(success);
        _pendingUnwraps[requestId] = PendingUnwrap({user: msg.sender, amount: amount});

        emit UnwrapRequested(msg.sender, requestId, amount);
    }

    function finalizeUnwrap(bytes32 requestId, bytes calldata decryptionProof) external nonReentrant {
        PendingUnwrap memory req = _pendingUnwraps[requestId];
        if (req.user == address(0)) revert UnknownUnwrapRequest(requestId);

        // Effects: clear the pending request before the underlying transfer
        // (CEI ordering).
        delete _pendingUnwraps[requestId];

        // Verify the public decryption proof on the burn-success ebool.
        bool burnSucceeded = Nox.publicDecrypt(ebool.wrap(requestId), decryptionProof);
        if (!burnSucceeded) revert UnwrapBurnFailed(requestId);

        // Interaction: transfer underlying back to the user.
        _underlying.safeTransfer(req.user, req.amount);

        emit Unwrapped(req.user, requestId, req.amount);
    }

    function pendingUnwrap(bytes32 requestId) external view returns (address user, uint256 amount) {
        PendingUnwrap memory req = _pendingUnwraps[requestId];
        return (req.user, req.amount);
    }

    // ====================================================================
    // Confidential transfer (ERC-7984 surface)
    // ====================================================================

    function confidentialTransfer(
        address to,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external nonReentrant returns (euint256 transferred) {
        return _transfer(msg.sender, to, Nox.fromExternal(encryptedAmount, inputProof));
    }

    function confidentialTransfer(
        address to,
        euint256 amount
    ) external nonReentrant returns (euint256 transferred) {
        if (!Nox.isAllowed(amount, msg.sender)) {
            revert UnauthorizedUseOfEncryptedAmount(amount, msg.sender);
        }
        return _transfer(msg.sender, to, amount);
    }

    // ====================================================================
    // Operator pattern (EIP-7984)
    // ====================================================================

    function setOperator(address operator, uint48 until) external {
        if (operator == address(0)) revert InvalidOperator(operator);
        _operatorUntil[msg.sender][operator] = until;
        emit OperatorSet(msg.sender, operator, until);
    }

    function isOperator(address holder, address operator) public view returns (bool) {
        return _operatorUntil[holder][operator] > block.timestamp;
    }

    function confidentialTransferFrom(
        address from,
        address to,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external nonReentrant returns (euint256 transferred) {
        if (from != msg.sender && !isOperator(from, msg.sender)) {
            revert UnauthorizedSpender(from, msg.sender);
        }
        return _transfer(from, to, Nox.fromExternal(encryptedAmount, inputProof));
    }

    function confidentialTransferFrom(
        address from,
        address to,
        euint256 amount
    ) external nonReentrant returns (euint256 transferred) {
        if (from != msg.sender && !isOperator(from, msg.sender)) {
            revert UnauthorizedSpender(from, msg.sender);
        }
        if (!Nox.isAllowed(amount, msg.sender)) {
            revert UnauthorizedUseOfEncryptedAmount(amount, msg.sender);
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, euint256 amount) internal returns (euint256 transferred) {
        if (from == address(0)) revert InvalidSender(from);
        if (to == address(0)) revert InvalidReceiver(to);

        // safeSub on sender balance.
        euint256 fromBalance = _balances[from];
        if (!Nox.isInitialized(fromBalance)) {
            fromBalance = Nox.toEuint256(0);
        }

        ebool success;
        euint256 newFromBalance;
        (success, newFromBalance) = Nox.safeSub(fromBalance, amount);

        _balances[from] = newFromBalance;
        Nox.allowThis(newFromBalance);
        Nox.allow(newFromBalance, from);

        // The actual amount that moved is `amount` if success, else 0.
        transferred = Nox.select(success, amount, Nox.toEuint256(0));
        Nox.allowThis(transferred);

        // Add to recipient.
        euint256 toBalance = _balances[to];
        if (!Nox.isInitialized(toBalance)) {
            toBalance = Nox.toEuint256(0);
        }
        euint256 newToBalance = Nox.add(toBalance, transferred);

        _balances[to] = newToBalance;
        Nox.allowThis(newToBalance);
        Nox.allow(newToBalance, to);

        // Both parties get persistent ACL on the transferred amount handle so
        // either side can off-chain decrypt the actual moved amount.
        Nox.allow(transferred, from);
        Nox.allow(transferred, to);

        emit ConfidentialTransfer(from, to, transferred);
    }
}
