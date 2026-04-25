// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import "encrypted-types/EncryptedTypes.sol";

/// @title IERC7984 (Nox-typed)
/// @notice ERC-7984 confidential fungible token interface, function-shape compatible
///         with the EIP-7984 draft, but typed against `encrypted-types` (`euint256`)
///         for use with the iExec Nox protocol. The OpenZeppelin reference of this
///         interface is bound to Zama FHEVM (`euint64`); see PRD §5.1.1 for why
///         DarkOdds re-types against `euint256` instead of inheriting OZCC.
interface IERC7984 {
    /// @dev Emitted on every confidential balance movement. Amount is the
    ///      handle of the encrypted transferred amount.
    event ConfidentialTransfer(address indexed from, address indexed to, euint256 indexed amount);

    /// @dev Emitted when a holder grants/extends/revokes operator authorization.
    ///      `until` is a unix timestamp; setting it to 0 revokes.
    event OperatorSet(address indexed holder, address indexed operator, uint48 until);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function confidentialTotalSupply() external view returns (euint256);
    function confidentialBalanceOf(address account) external view returns (euint256);

    // ====================================================================
    // Operator pattern (EIP-7984)
    // ====================================================================

    /// @notice Authorize `operator` to move tokens on behalf of the caller until
    ///         the unix timestamp `until`. Pass 0 to revoke immediately.
    function setOperator(address operator, uint48 until) external;

    /// @notice True iff `operator` is currently authorized to move `holder`'s tokens.
    function isOperator(address holder, address operator) external view returns (bool);

    // ====================================================================
    // Confidential transfer
    // ====================================================================

    /// @dev Confidential transfer with a fresh externally-encrypted amount.
    function confidentialTransfer(
        address to,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint256);

    /// @dev Confidential transfer where the caller already holds ACL on `amount`.
    function confidentialTransfer(address to, euint256 amount) external returns (euint256 transferred);

    /// @dev Operator-authorized transferFrom with a fresh externally-encrypted amount.
    ///      `msg.sender` must be `from` or an active operator of `from`.
    function confidentialTransferFrom(
        address from,
        address to,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint256);

    /// @dev Operator-authorized transferFrom where the caller already holds ACL on `amount`.
    function confidentialTransferFrom(
        address from,
        address to,
        euint256 amount
    ) external returns (euint256 transferred);
}
