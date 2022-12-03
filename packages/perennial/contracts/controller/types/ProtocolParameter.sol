// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";

/// @dev ProtocolParameter type
struct ProtocolParameter {
    UFixed18 protocolFee;    // <= 429%
    UFixed18 minFundingFee;  // <= 429%
    UFixed18 minCollateral;  // <= 18.45bn
    bool paused;
}
struct PackedProtocolParameter {
    uint32 protocolFee; // <= 429%
    uint32 minFundingFee;  // <= 429%
    uint32 minCollateral;    // <= 429%
    bool paused;

    bytes19 __unallocated__;
}
type ProtocolParameterStorage is bytes32;
using ProtocolParameterStorageLib for ProtocolParameterStorage global;

library ProtocolParameterStorageLib {
    struct ProtocolParameterStoragePointer {
        PackedProtocolParameter value;
    }

    uint256 private constant OFFSET = 10 ** 9;

    error ProtocolParameterStorageOverflowError();

    function read(ProtocolParameterStorage self) internal view returns (ProtocolParameter memory) {
        PackedProtocolParameter memory value = _pointer(self).value;
        return ProtocolParameter(
            UFixed18.wrap(uint256(value.protocolFee) * OFFSET),
            UFixed18.wrap(uint256(value.minFundingFee) * OFFSET),
            UFixed18.wrap(uint256(value.minCollateral) * OFFSET),
            value.paused
        );
    }

    function store(ProtocolParameterStorage self, ProtocolParameter memory parameter) internal {
        //TODO: check mod for precision
        if (parameter.protocolFee.gt(UFixed18Lib.ONE)) revert ProtocolParameterStorageOverflowError();
        if (parameter.minFundingFee.gt(UFixed18Lib.ONE)) revert ProtocolParameterStorageOverflowError();
        if (parameter.minCollateral.gt(UFixed18Lib.from(18_446_744_073))) revert ProtocolParameterStorageOverflowError();

        _pointer(self).value = PackedProtocolParameter(
            uint32(UFixed18.unwrap(parameter.protocolFee) / OFFSET),
            uint32(UFixed18.unwrap(parameter.minFundingFee) / OFFSET),
            uint32(UFixed18.unwrap(parameter.minCollateral) / OFFSET),
            parameter.paused,
            bytes19(0x00000000000000000000000000000000000000)
        );
    }

    function _pointer(ProtocolParameterStorage self) private pure returns (ProtocolParameterStoragePointer storage pointer) {
        assembly ("memory-safe") { pointer.slot := self }
    }
}