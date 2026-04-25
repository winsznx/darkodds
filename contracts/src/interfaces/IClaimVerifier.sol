// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title IClaimVerifier
/// @notice Verifies a TEE-signed JSON attestation against an immutably pinned
///         TDX measurement. See PRD §5.5 — no setters, ever; if the measurement
///         changes, deploy a new ClaimVerifier (trust-anchor migration pattern).
///
/// Attestation payload is ABI-encoded as the tuple
///     (address user,
///      uint256 marketId,
///      uint8   outcome,
///      bytes32 payoutCommitment,
///      uint256 timestamp,
///      address recipient,           // address(0) iff bearer mode
///      uint256 nonce,
///      bytes32 tdxMeasurement)
/// The `signature` (65 bytes, ECDSA over keccak256(attestationData)) MUST be
/// signed by `attestationSigner()`.
interface IClaimVerifier {
    error InvalidSignatureLength(uint256 length);
    error InvalidSigner(address recovered, address expected);
    error MeasurementMismatch(bytes32 attested, bytes32 pinned);

    function pinnedTdxMeasurement() external view returns (bytes32);
    function attestationSigner() external view returns (address);

    function verifyAttestation(
        bytes calldata attestationData,
        bytes calldata signature
    )
        external
        view
        returns (
            address user,
            uint256 marketId,
            uint8 outcome,
            bytes32 payoutCommitment,
            uint256 timestamp,
            address recipient,
            uint256 nonce
        );
}
