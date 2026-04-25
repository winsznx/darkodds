// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {ClaimVerifier, AttestationPayload} from "../src/ClaimVerifier.sol";
import {IClaimVerifier} from "../src/interfaces/IClaimVerifier.sol";

contract ClaimVerifierTest is Test {
    ClaimVerifier private verifier;
    bytes32 private constant MEASUREMENT = keccak256("DARKODDS_F4_DEMO_MEASUREMENT");
    uint256 private constant SIGNER_KEY = 0xA770C7A7;
    address private signer;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        verifier = new ClaimVerifier(MEASUREMENT, signer);
    }

    function _sign(AttestationPayload memory p) internal view returns (bytes memory data, bytes memory sig) {
        data = abi.encode(p);
        bytes32 digest = keccak256(data);
        bytes32 ethSigned = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, ethSigned);
        sig = abi.encodePacked(r, s, v);
    }

    function _baseAttestation() internal view returns (AttestationPayload memory) {
        return
            AttestationPayload({
                user: address(0xB0B),
                marketId: 7,
                outcome: 1,
                payoutCommitment: keccak256("payout"),
                timestamp: block.timestamp,
                recipient: address(0xC0FFEE),
                nonce: 1,
                tdxMeasurement: MEASUREMENT
            });
    }

    function test_Constructor_RevertsOnZeroMeasurement() public {
        vm.expectRevert(bytes("measurement=0"));
        new ClaimVerifier(bytes32(0), signer);
    }

    function test_Constructor_RevertsOnZeroSigner() public {
        vm.expectRevert(bytes("signer=0"));
        new ClaimVerifier(MEASUREMENT, address(0));
    }

    function test_VerifyAttestation_HappyPath() public view {
        AttestationPayload memory p = _baseAttestation();
        (bytes memory data, bytes memory sig) = _sign(p);
        (
            address user,
            uint256 marketId,
            uint8 outcome,
            bytes32 payoutCommitment,
            uint256 timestamp,
            address recipient,
            uint256 nonce
        ) = verifier.verifyAttestation(data, sig);
        assertEq(user, p.user);
        assertEq(marketId, p.marketId);
        assertEq(outcome, p.outcome);
        assertEq(payoutCommitment, p.payoutCommitment);
        assertEq(timestamp, p.timestamp);
        assertEq(recipient, p.recipient);
        assertEq(nonce, p.nonce);
    }

    function test_VerifyAttestation_BearerMode() public view {
        AttestationPayload memory p = _baseAttestation();
        p.recipient = address(0); // bearer mode opt-in
        (bytes memory data, bytes memory sig) = _sign(p);
        (, , , , , address recipient, ) = verifier.verifyAttestation(data, sig);
        assertEq(recipient, address(0));
    }

    function test_VerifyAttestation_RevertsOnInvalidSigner() public {
        AttestationPayload memory p = _baseAttestation();
        bytes memory data = abi.encode(p);
        // Sign with a DIFFERENT key.
        bytes32 digest = keccak256(data);
        bytes32 ethSigned = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(uint256(0xDEADBEEF), ethSigned);
        bytes memory wrongSig = abi.encodePacked(r, s, v);
        vm.expectRevert();
        verifier.verifyAttestation(data, wrongSig);
    }

    function test_VerifyAttestation_RevertsOnMismatchedMeasurement() public {
        AttestationPayload memory p = _baseAttestation();
        p.tdxMeasurement = keccak256("DIFFERENT");
        (bytes memory data, bytes memory sig) = _sign(p);
        vm.expectRevert();
        verifier.verifyAttestation(data, sig);
    }

    function test_VerifyAttestation_RevertsOnInvalidSigLength() public {
        AttestationPayload memory p = _baseAttestation();
        bytes memory data = abi.encode(p);
        bytes memory tooShort = new bytes(64);
        vm.expectRevert(abi.encodeWithSelector(IClaimVerifier.InvalidSignatureLength.selector, uint256(64)));
        verifier.verifyAttestation(data, tooShort);
    }
}
