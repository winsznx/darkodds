// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IClaimVerifier} from "./interfaces/IClaimVerifier.sol";

/// @title ClaimVerifier
/// @notice Off-chain attestation verifier. Per PRD §5.5: both the TDX
///         measurement and the attestation signer are immutable — there is no
///         setter, ever. If the TEE upgrade changes the measurement, deploy a
///         NEW ClaimVerifier and let old attestations validate against the old
///         contract. Trust-anchor migration pattern.
///
///         The on-chain payload is the ABI-encoded tuple
///             (address user,
///              uint256 marketId,
///              uint8   outcome,
///              bytes32 payoutCommitment,
///              uint256 timestamp,
///              address recipient,        // address(0) iff bearer mode
///              uint256 nonce,
///              bytes32 tdxMeasurement)
///         and `signature` is a 65-byte ECDSA signature by `attestationSigner`
///         over `keccak256(attestationData)`.
/// @dev Decoded attestation payload. Helper struct for ClaimVerifier — the
///      ABI-encoded `attestationData` decodes into this in a single call,
///      sidestepping stack-too-deep in `verifyAttestation`'s return tuple.
struct AttestationPayload {
    address user;
    uint256 marketId;
    uint8 outcome;
    bytes32 payoutCommitment;
    uint256 timestamp;
    address recipient;
    uint256 nonce;
    bytes32 tdxMeasurement;
}

contract ClaimVerifier is IClaimVerifier {
    using ECDSA for bytes32;

    bytes32 public immutable pinnedTdxMeasurement;
    address public immutable attestationSigner;

    constructor(bytes32 pinnedMeasurement, address signer) {
        require(pinnedMeasurement != bytes32(0), "measurement=0");
        require(signer != address(0), "signer=0");
        pinnedTdxMeasurement = pinnedMeasurement;
        attestationSigner = signer;
    }

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
        )
    {
        if (signature.length != 65) revert InvalidSignatureLength(signature.length);

        // Recover the signer from the signature over keccak256(attestationData).
        // Wrap the digest as an EIP-191 personal-sign hash so that the same
        // payload can be produced by a standard wallet via personal_sign for
        // testing — production attestations from the TEE are produced the same
        // way (ethers/Wagmi standard signing).
        bytes32 ethSigned = MessageHashUtils_toEthSignedMessageHash(keccak256(attestationData));
        address recovered = ECDSA.recover(ethSigned, signature);
        if (recovered != attestationSigner) revert InvalidSigner(recovered, attestationSigner);

        AttestationPayload memory p = abi.decode(attestationData, (AttestationPayload));
        if (p.tdxMeasurement != pinnedTdxMeasurement) {
            revert MeasurementMismatch(p.tdxMeasurement, pinnedTdxMeasurement);
        }
        return (p.user, p.marketId, p.outcome, p.payoutCommitment, p.timestamp, p.recipient, p.nonce);
    }
}

/// @dev Inlined `MessageHashUtils.toEthSignedMessageHash` to avoid a second
///      OZ import path; keeps the verifier self-contained.
function MessageHashUtils_toEthSignedMessageHash(bytes32 hash) pure returns (bytes32) {
    return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
}
