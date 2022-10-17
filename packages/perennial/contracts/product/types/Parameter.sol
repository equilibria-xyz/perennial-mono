// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";

/// @dev Parameter type
struct Parameter {
    uint48 maintenance;
    uint48 fundingFee;
    uint48 makerFee;
    uint48 takerFee;
    uint48 positionFee;
    bool closed;
}
type ParameterStorage is bytes32;
using ParameterStorageLib for ParameterStorage global;

library ParameterStorageLib {
    uint256 private constant OFFSET = 10 ** 9;

    error ParameterStorageOverflowError();

    function _storagePointer(ParameterStorage self)
    private pure returns (Parameter storage pointer) {
        assembly { pointer.slot := self }
    }

    function read(ParameterStorage self) internal view returns (
        UFixed18 maintenance,
        UFixed18 fundingFee,
        UFixed18 makerFee,
        UFixed18 takerFee,
        UFixed18 positionFee,
        bool closed
    ) {
        Parameter memory value = _storagePointer(self);
        return (
            UFixed18.wrap(uint256(value.maintenance) * OFFSET),
            UFixed18.wrap(uint256(value.fundingFee) * OFFSET),
            UFixed18.wrap(uint256(value.makerFee) * OFFSET),
            UFixed18.wrap(uint256(value.takerFee) * OFFSET),
            UFixed18.wrap(uint256(value.positionFee) * OFFSET),
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
        bool closed
    ) internal {
        if (maintenance.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (fundingFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (makerFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (takerFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();
        if (positionFee.gt(UFixed18Lib.ONE)) revert ParameterStorageOverflowError();

        Parameter memory value = Parameter(
            uint48(UFixed18.unwrap(maintenance) / OFFSET),
            uint48(UFixed18.unwrap(fundingFee) / OFFSET),
            uint48(UFixed18.unwrap(makerFee) / OFFSET),
            uint48(UFixed18.unwrap(takerFee) / OFFSET),
            uint48(UFixed18.unwrap(positionFee) / OFFSET),
            closed
        );
        assembly {
            sstore(self, value)
        }
    }
}