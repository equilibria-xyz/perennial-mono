// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";

/// @dev Parameter type
struct Parameter {
    uint32 maintenance; // <= 429%
    uint32 fundingFee;  // <= 429%
    uint32 makerFee;    // <= 429%
    uint32 takerFee;    // <= 429%
    uint32 positionFee; // <= 429%
    uint64 makerLimit;  // <= 18.45bn
    bool closed;

    bytes3 __unallocated__;
}
type ParameterStorage is bytes32;
using ParameterStorageLib for ParameterStorage global;

library ParameterStorageLib {
    uint256 private constant OFFSET = 10 ** 9;

    error ParameterStorageOverflowError();

    struct ParameterStoragePointer {
        Parameter value;
    }

    function _storagePointer(ParameterStorage self)
    private pure returns (ParameterStoragePointer storage pointer) {
        assembly ("memory-safe") { pointer.slot := self }
    }

    function read(ParameterStorage self) internal view returns (
        UFixed18 maintenance,
        UFixed18 fundingFee,
        UFixed18 makerFee,
        UFixed18 takerFee,
        UFixed18 positionFee,
        UFixed18 makerLimit,
        bool closed
    ) {
        Parameter memory value = _storagePointer(self).value;
        return (
            UFixed18.wrap(uint256(value.maintenance) * OFFSET),
            UFixed18.wrap(uint256(value.fundingFee) * OFFSET),
            UFixed18.wrap(uint256(value.makerFee) * OFFSET),
            UFixed18.wrap(uint256(value.takerFee) * OFFSET),
            UFixed18.wrap(uint256(value.positionFee) * OFFSET),
            UFixed18.wrap(uint256(value.makerLimit) * OFFSET),
            value.closed
        );
    }

    function store(
        ParameterStorage self,
        UFixed18 maintenance,
        UFixed18 fundingFee,
        UFixed18 makerFee,
        UFixed18 takerFee,
        UFixed18 positionFee,
        UFixed18 makerLimit,
        bool closed
    ) internal {
        if (maintenance.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (fundingFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (makerFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (takerFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (positionFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (makerLimit.gt(UFixed18Lib.from(18_446_744_073))) revert ParameterStorageOverflowError();

        Parameter memory parameter = Parameter(
            uint32(UFixed18.unwrap(maintenance) / OFFSET),
            uint32(UFixed18.unwrap(fundingFee) / OFFSET),
            uint32(UFixed18.unwrap(makerFee) / OFFSET),
            uint32(UFixed18.unwrap(takerFee) / OFFSET),
            uint32(UFixed18.unwrap(positionFee) / OFFSET),
            uint64(UFixed18.unwrap(makerLimit) / OFFSET),
            closed,
            bytes3(0x000000)
        );
        _storagePointer(self).value = parameter;
    }
}