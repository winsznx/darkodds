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

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function confidentialTotalSupply() external view returns (euint256);
    function confidentialBalanceOf(address account) external view returns (euint256);

    /// @dev Confidential transfer with a fresh externally-encrypted amount.
    function confidentialTransfer(
        address to,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint256);

    /// @dev Confidential transfer where the caller already holds ACL on `amount`.
    function confidentialTransfer(address to, euint256 amount) external returns (euint256 transferred);
}
