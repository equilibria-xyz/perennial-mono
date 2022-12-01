// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";

/// @dev Parameter type
struct Parameter {
    UFixed18 maintenance; // <= 429%
    UFixed18 fundingFee;  // <= 429%
    UFixed18 makerFee;    // <= 429%
    UFixed18 takerFee;    // <= 429%
    UFixed18 positionFee; // <= 429%
    UFixed18 makerLimit;  // <= 18.45bn
    bool closed;
    JumpRateUtilizationCurve utilizationCurve;
}
struct PackedParameter {
    uint32 maintenance; // <= 429%
    uint32 fundingFee;  // <= 429%
    uint32 makerFee;    // <= 429%
    uint32 takerFee;    // <= 429%
    uint32 positionFee; // <= 429%
    uint64 makerLimit;  // <= 18.45bn
    bool closed;

    bytes3 __unallocated__;

    JumpRateUtilizationCurve utilizationCurve;
}
type ParameterStorage is bytes32;
using ParameterStorageLib for ParameterStorage global;

library ParameterStorageLib {
    struct ParameterStoragePointer {
        PackedParameter value;
    }

    uint256 private constant OFFSET = 10 ** 9;

    error ParameterStorageOverflowError();

    function read(ParameterStorage self) internal view returns (Parameter memory) {
        PackedParameter memory value = _pointer(self).value;
        return Parameter(
            UFixed18.wrap(uint256(value.maintenance) * OFFSET),
            UFixed18.wrap(uint256(value.fundingFee) * OFFSET),
            UFixed18.wrap(uint256(value.makerFee) * OFFSET),
            UFixed18.wrap(uint256(value.takerFee) * OFFSET),
            UFixed18.wrap(uint256(value.positionFee) * OFFSET),
            UFixed18.wrap(uint256(value.makerLimit) * OFFSET),
            value.closed,
            value.utilizationCurve
        );
    }

    function store(ParameterStorage self, Parameter memory parameter) internal {
        //TODO: check mod for precision
        if (parameter.maintenance.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (parameter.fundingFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (parameter.makerFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (parameter.takerFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (parameter.positionFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (parameter.makerLimit.gt(UFixed18Lib.from(18_446_744_073))) revert ParameterStorageOverflowError();

        _pointer(self).value = PackedParameter(
            uint32(UFixed18.unwrap(parameter.maintenance) / OFFSET),
            uint32(UFixed18.unwrap(parameter.fundingFee) / OFFSET),
            uint32(UFixed18.unwrap(parameter.makerFee) / OFFSET),
            uint32(UFixed18.unwrap(parameter.takerFee) / OFFSET),
            uint32(UFixed18.unwrap(parameter.positionFee) / OFFSET),
            uint64(UFixed18.unwrap(parameter.makerLimit) / OFFSET),
            parameter.closed,
            bytes3(0x000000),
            parameter.utilizationCurve
        );
    }

    function _pointer(ParameterStorage self) private pure returns (ParameterStoragePointer storage pointer) {
        assembly ("memory-safe") { pointer.slot := self }
    }
}