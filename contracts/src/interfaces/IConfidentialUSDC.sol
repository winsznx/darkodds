// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import "encrypted-types/EncryptedTypes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC7984} from "./IERC7984.sol";

/// @title IConfidentialUSDC
/// @notice Public surface of the DarkOdds Nox-native confidential USDC wrapper.
///         Adds wrap/unwrap on top of the ERC-7984 confidential transfer surface.
///
/// Wrap is single-tx: user supplies plaintext amount + a Nox-gateway-encrypted
/// handle of that amount + the gateway's EIP-712 proof, contract pulls plaintext
/// underlying and credits the encrypted balance via `Nox.mint`.
///
/// Unwrap is 2-tx (mirroring the OpenZeppelin FHEVM wrapper pattern, adapted to
/// Nox primitives). `requestUnwrap` burns the encrypted balance and exposes the
/// burn-success ebool for public decryption; `finalizeUnwrap` consumes the
/// gateway-issued decryption proof and releases the underlying ERC-20.
interface IConfidentialUSDC is IERC7984 {
    /// @dev Emitted when underlying is locked and confidential balance credited.
    event Wrapped(address indexed user, uint256 amount, euint256 newBalance);

    /// @dev Emitted in tx 1 of unwrap. `requestId == ebool.unwrap(burnSuccessHandle)`.
    event UnwrapRequested(address indexed user, bytes32 indexed requestId, uint256 amount);

    /// @dev Emitted in tx 2 of unwrap when the burn is confirmed and underlying transferred.
    event Unwrapped(address indexed user, bytes32 indexed requestId, uint256 amount);

    /// @dev The underlying ERC-20 backing this confidential token.
    function underlying() external view returns (IERC20);

    /// @notice Lock `amount` of underlying ERC-20 and credit a confidential balance.
    /// @param amount  Plaintext underlying amount transferred from the caller.
    /// @param encryptedAmount  Gateway-issued external handle encoding `amount`.
    /// @param inputProof  EIP-712 gateway proof binding `encryptedAmount` to caller + this contract.
    /// @return newBalance The caller's resulting encrypted balance handle.
    function wrap(
        uint256 amount,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint256 newBalance);

    /// @notice Tx 1 of unwrap. Burns `amount` from the caller's confidential balance and
    ///         marks the burn-success ebool publicly decryptable. Callers must invoke
    ///         {finalizeUnwrap} with the gateway's decryption proof to receive underlying.
    /// @return requestId The bytes32 representation of the burn-success ebool handle.
    function requestUnwrap(uint256 amount) external returns (bytes32 requestId);

    /// @notice Tx 2 of unwrap. Verifies the public-decryption proof on the burn-success
    ///         ebool and, if the burn succeeded, transfers `amount` underlying back.
    function finalizeUnwrap(bytes32 requestId, bytes calldata decryptionProof) external;

    /// @notice Pending unwrap request mapping; returns address(0) for unknown ids.
    function pendingUnwrap(bytes32 requestId) external view returns (address user, uint256 amount);
}
