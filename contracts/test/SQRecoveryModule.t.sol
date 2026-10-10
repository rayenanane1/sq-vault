// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {CoinbaseSmartWallet} from "smart-wallet/CoinbaseSmartWallet.sol";
import {CoinbaseSmartWalletFactory} from "smart-wallet/CoinbaseSmartWalletFactory.sol";
import {SQRecoveryModule} from "../src/SQRecoveryModule.sol";

contract SQRecoveryModuleTest is Test {
    CoinbaseSmartWallet wallet;
    SQRecoveryModule module;

    address owner = makeAddr("owner"); // stands in for the passkey on the lost phone
    uint256 bankPk = 0xB4A1;
    uint256 contactPk = 0xC0A7;
    uint256 kitPk = 0x4177;
    uint256 attackerPk = 0xBAD;
    address bank;
    address contact;
    address kit;

    bytes32 constant NEW_X = bytes32(uint256(0x1111));
    bytes32 constant NEW_Y = bytes32(uint256(0x2222));
    uint32 constant DELAY = 48 hours;

    function setUp() public {
        bank = vm.addr(bankPk);
        contact = vm.addr(contactPk);
        kit = vm.addr(kitPk);

        CoinbaseSmartWalletFactory factory = new CoinbaseSmartWalletFactory(address(new CoinbaseSmartWallet()));
        bytes[] memory owners = new bytes[](1);
        owners[0] = abi.encode(owner);
        wallet = factory.createAccount(owners, 0);
        module = new SQRecoveryModule();

        address[] memory guardians = new address[](3);
        guardians[0] = bank;
        guardians[1] = contact;
        guardians[2] = kit;

        CoinbaseSmartWallet.Call[] memory calls = new CoinbaseSmartWallet.Call[](2);
        calls[0] = CoinbaseSmartWallet.Call(address(wallet), 0, abi.encodeCall(wallet.addOwnerAddress, (address(module))));
        calls[1] = CoinbaseSmartWallet.Call(address(module), 0, abi.encodeCall(module.setup, (guardians, 2, DELAY)));
        vm.prank(owner);
        wallet.executeBatch(calls);
    }

    function _sig(uint256 pk, bytes32 x, bytes32 y) internal view returns (bytes memory) {
        bytes32 h = module.recoveryHash(address(wallet), x, y);
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sorted(uint256 pkA, uint256 pkB) internal view returns (bytes[] memory sigs) {
        sigs = new bytes[](2);
        (uint256 lo, uint256 hi) = vm.addr(pkA) < vm.addr(pkB) ? (pkA, pkB) : (pkB, pkA);
        sigs[0] = _sig(lo, NEW_X, NEW_Y);
        sigs[1] = _sig(hi, NEW_X, NEW_Y);
    }

    function test_setup() public view {
        (address[] memory g, uint8 t, uint32 d,) = module.getConfig(address(wallet));
        assertEq(g.length, 3);
        assertEq(t, 2);
        assertEq(d, DELAY);
        assertTrue(wallet.isOwnerAddress(address(module)));
    }

    function test_fullRecovery() public {
        module.initiateRecovery(address(wallet), NEW_X, NEW_Y, _sorted(bankPk, contactPk));
        vm.expectRevert();
        module.executeRecovery(address(wallet)); // timelock still active

        vm.warp(block.timestamp + DELAY);
        module.executeRecovery(address(wallet));
        assertTrue(wallet.isOwnerPublicKey(NEW_X, NEW_Y));
    }

    function test_kitAndContact() public {
        module.initiateRecovery(address(wallet), NEW_X, NEW_Y, _sorted(kitPk, contactPk));
        vm.warp(block.timestamp + DELAY);
        module.executeRecovery(address(wallet));
        assertTrue(wallet.isOwnerPublicKey(NEW_X, NEW_Y));
    }

    function test_bankAloneCannotRecover() public {
        bytes[] memory one = new bytes[](1);
        one[0] = _sig(bankPk, NEW_X, NEW_Y);
        vm.expectRevert(abi.encodeWithSelector(SQRecoveryModule.ThresholdNotMet.selector, 1, 2));
        module.initiateRecovery(address(wallet), NEW_X, NEW_Y, one);
    }

    function test_duplicateSignatureRejected() public {
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(bankPk, NEW_X, NEW_Y);
        sigs[1] = _sig(bankPk, NEW_X, NEW_Y);
        vm.expectRevert(SQRecoveryModule.SignaturesNotSortedOrDuplicate.selector);
        module.initiateRecovery(address(wallet), NEW_X, NEW_Y, sigs);
    }

    function test_attackerIsNotGuardian() public {
        bytes[] memory sigs = _sorted(attackerPk, contactPk);
        vm.expectRevert();
        module.initiateRecovery(address(wallet), NEW_X, NEW_Y, sigs);
    }

    function test_signaturesBoundToNewKey() public {
        // guardians approved key (NEW_X, NEW_Y). An attacker cannot reuse it for another key.
        bytes[] memory sigs = _sorted(bankPk, contactPk);
        vm.expectRevert();
        module.initiateRecovery(address(wallet), bytes32(uint256(0xdead)), NEW_Y, sigs);
    }

    function test_ownerCancels() public {
        module.initiateRecovery(address(wallet), NEW_X, NEW_Y, _sorted(bankPk, contactPk));
        vm.prank(owner);
        wallet.execute(address(module), 0, abi.encodeCall(module.cancelRecovery, ()));
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(SQRecoveryModule.NoPendingRecovery.selector);
        module.executeRecovery(address(wallet));
        assertFalse(wallet.isOwnerPublicKey(NEW_X, NEW_Y));
    }

    function test_noReplayAfterCancel() public {
        bytes[] memory sigs = _sorted(bankPk, contactPk);
        module.initiateRecovery(address(wallet), NEW_X, NEW_Y, sigs);
        vm.prank(owner);
        wallet.execute(address(module), 0, abi.encodeCall(module.cancelRecovery, ()));
        vm.expectRevert(); // nonce moved on, old approvals are dead
        module.initiateRecovery(address(wallet), NEW_X, NEW_Y, sigs);
    }

    function test_guardiansCannotMoveFunds() public {
        vm.deal(address(wallet), 1 ether);
        vm.prank(bank);
        vm.expectRevert();
        wallet.execute(bank, 1 ether, "");
        assertEq(address(wallet).balance, 1 ether);
    }

    function test_onlyOneRecoveryAtATime() public {
        module.initiateRecovery(address(wallet), NEW_X, NEW_Y, _sorted(bankPk, contactPk));
        bytes32 otherX = bytes32(uint256(0x3333));
        bytes[] memory sigs = new bytes[](2);
        (uint256 lo, uint256 hi) = kit < contact ? (kitPk, contactPk) : (contactPk, kitPk);
        sigs[0] = _sig(lo, otherX, NEW_Y);
        sigs[1] = _sig(hi, otherX, NEW_Y);
        vm.expectRevert(SQRecoveryModule.RecoveryAlreadyPending.selector);
        module.initiateRecovery(address(wallet), otherX, NEW_Y, sigs);
    }
}
