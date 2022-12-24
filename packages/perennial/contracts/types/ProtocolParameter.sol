// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./number/UFixed6.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";

/// @dev ProtocolParameter type
struct ProtocolParameter {
    UFixed6 protocolFee;    // <= 1677%
    UFixed6 minFundingFee;  // <= 1677%
    UFixed6 minCollateral;  // <= 281mn
    bool paused;
}
struct PackedProtocolParameter {
    uint24 protocolFee;     // <= 1677%
    uint24 minFundingFee;   // <= 1677%
    uint48 minCollateral;   // <= 281mn
    bool paused;

    bytes19 __unallocated__;
}
type ProtocolParameterStorage is bytes32;
using ProtocolParameterStorageLib for ProtocolParameterStorage global;

library ProtocolParameterStorageLib {
    struct ProtocolParameterStoragePointer {
        PackedProtocolParameter value;
    }

    error ProtocolParameterStorageOverflowError();

    function read(ProtocolParameterStorage self) internal view returns (ProtocolParameter memory) {
        PackedProtocolParameter memory value = _pointer(self).value;
        return ProtocolParameter(
            UFixed6.wrap(uint256(value.protocolFee)),
            UFixed6.wrap(uint256(value.minFundingFee)),
            UFixed6.wrap(uint256(value.minCollateral)),
            value.paused
        );
    }

    function store(ProtocolParameterStorage self, ProtocolParameter memory parameter) internal {
        //TODO: check mod for precision
        if (parameter.protocolFee.gt(UFixed6Lib.ONE)) revert ProtocolParameterStorageOverflowError();
        if (parameter.minFundingFee.gt(UFixed6Lib.ONE)) revert ProtocolParameterStorageOverflowError();
        if (parameter.minCollateral.gt(UFixed6Lib.from(281_474_976))) revert ProtocolParameterStorageOverflowError();

        _pointer(self).value = PackedProtocolParameter(
            uint24(UFixed6.unwrap(parameter.protocolFee)),
            uint24(UFixed6.unwrap(parameter.minFundingFee)),
            uint48(UFixed6.unwrap(parameter.minCollateral)),
            parameter.paused,
            bytes19(0x00000000000000000000000000000000000000)
        );
    }

    function _pointer(ProtocolParameterStorage self) private pure returns (ProtocolParameterStoragePointer storage pointer) {
        assembly ("memory-safe") { pointer.slot := self }
    }
}