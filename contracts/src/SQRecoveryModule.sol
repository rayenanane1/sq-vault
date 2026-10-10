// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// Minimal interface of the Coinbase Smart Wallet (MultiOwnable).
interface IMultiOwnableWallet {
    function addOwnerPublicKey(bytes32 x, bytes32 y) external;
}

/// @title SQRecoveryModule
/// @notice Guardian based, time locked recovery for passkey smart wallets.
/// A wallet adds this module as one of its owners and calls `setup`.
/// The module can ONLY add a new passkey owner, and only after
///   1. `threshold` distinct guardians signed the exact request, and
///   2. `delay` seconds elapsed, during which any current owner can cancel.
/// No guardian, including the bank, can move funds or recover alone.
contract SQRecoveryModule {
    struct Config {
        address[] guardians;
        uint8 threshold;
        uint32 delay;
        uint64 nonce;
    }

    struct Pending {
        bytes32 x;
        bytes32 y;
        uint64 executeAfter;
    }

    mapping(address wallet => Config) internal _configs;
    mapping(address wallet => Pending) public pending;

    event GuardiansConfigured(address indexed wallet, address[] guardians, uint8 threshold, uint32 delay);
    event RecoveryInitiated(address indexed wallet, bytes32 x, bytes32 y, uint64 executeAfter);
    event RecoveryCancelled(address indexed wallet);
    event RecoveryExecuted(address indexed wallet, bytes32 x, bytes32 y);

    error InvalidConfig();
    error NotConfigured();
    error RecoveryAlreadyPending();
    error NoPendingRecovery();
    error TimelockActive(uint64 executeAfter);
    error SignaturesNotSortedOrDuplicate();
    error NotAGuardian(address signer);
    error ThresholdNotMet(uint256 valid, uint8 threshold);

    /// @notice Called by the wallet itself to set or rotate its guardians.
    function setup(address[] calldata guardians, uint8 threshold, uint32 delay) external {
        if (threshold == 0 || threshold > guardians.length) revert InvalidConfig();
        for (uint256 i; i < guardians.length; ++i) {
            if (guardians[i] == address(0)) revert InvalidConfig();
            for (uint256 j = i + 1; j < guardians.length; ++j) {
                if (guardians[i] == guardians[j]) revert InvalidConfig();
            }
        }
        Config storage c = _configs[msg.sender];
        c.guardians = guardians;
        c.threshold = threshold;
        c.delay = delay;
        unchecked { c.nonce++; }
        if (pending[msg.sender].executeAfter != 0) {
            delete pending[msg.sender];
            emit RecoveryCancelled(msg.sender);
        }
        emit GuardiansConfigured(msg.sender, guardians, threshold, delay);
    }

    function getConfig(address wallet)
        external
        view
        returns (address[] memory guardians, uint8 threshold, uint32 delay, uint64 nonce)
    {
        Config storage c = _configs[wallet];
        return (c.guardians, c.threshold, c.delay, c.nonce);
    }

    /// @notice The message each guardian signs (EIP-191 personal_sign over this hash).
    function recoveryHash(address wallet, bytes32 x, bytes32 y) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, wallet, x, y, _configs[wallet].nonce));
    }

    /// @notice Anyone can submit guardian approvals. Signatures must be sorted by signer address.
    function initiateRecovery(address wallet, bytes32 x, bytes32 y, bytes[] calldata signatures) external {
        Config storage c = _configs[wallet];
        if (c.threshold == 0) revert NotConfigured();
        if (pending[wallet].executeAfter != 0) revert RecoveryAlreadyPending();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(recoveryHash(wallet, x, y));
        address last;
        uint256 valid;
        for (uint256 i; i < signatures.length; ++i) {
            address signer = ECDSA.recover(digest, signatures[i]);
            if (signer <= last) revert SignaturesNotSortedOrDuplicate();
            if (!_isGuardian(c, signer)) revert NotAGuardian(signer);
            last = signer;
            ++valid;
        }
        if (valid < c.threshold) revert ThresholdNotMet(valid, c.threshold);

        unchecked { c.nonce++; } // signatures can never be replayed
        uint64 executeAfter = uint64(block.timestamp) + c.delay;
        pending[wallet] = Pending(x, y, executeAfter);
        emit RecoveryInitiated(wallet, x, y, executeAfter);
    }

    /// @notice The legitimate owner (still holding a passkey) vetoes a recovery.
    function cancelRecovery() external {
        if (pending[msg.sender].executeAfter == 0) revert NoPendingRecovery();
        delete pending[msg.sender];
        emit RecoveryCancelled(msg.sender);
    }

    /// @notice After the timelock, anyone can finalize: the new passkey becomes an owner.
    function executeRecovery(address wallet) external {
        Pending memory p = pending[wallet];
        if (p.executeAfter == 0) revert NoPendingRecovery();
        if (block.timestamp < p.executeAfter) revert TimelockActive(p.executeAfter);
        delete pending[wallet];
        IMultiOwnableWallet(wallet).addOwnerPublicKey(p.x, p.y);
        emit RecoveryExecuted(wallet, p.x, p.y);
    }

    function _isGuardian(Config storage c, address a) private view returns (bool) {
        for (uint256 i; i < c.guardians.length; ++i) {
            if (c.guardians[i] == a) return true;
        }
        return false;
    }
}
