// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "./Accumulator.sol";

/// @dev MarketParameter type
struct MarketParameter {
    UFixed18 maintenance; // <= 429%
    UFixed18 fundingFee;  // <= 429%
    UFixed18 makerFee;    // <= 429%
    UFixed18 takerFee;    // <= 429%
    UFixed18 positionFee; // <= 429%
    UFixed18 makerLimit;  // <= 18.45bn
    bool closed;
    JumpRateUtilizationCurve utilizationCurve;
    Accumulator rewardRate;
}
struct PackedMarketParameter {
    uint32 maintenance; // <= 429%
    uint32 fundingFee;  // <= 429%
    uint32 makerFee;    // <= 429%
    uint32 takerFee;    // <= 429%
    uint32 positionFee; // <= 429%
    uint64 makerLimit;  // <= 18.45bn
    bool closed;

    bytes3 __unallocated__;

    JumpRateUtilizationCurve utilizationCurve;
    Accumulator rewardRate;
}
type MarketParameterStorage is bytes32;
using MarketParameterStorageLib for MarketParameterStorage global;

library MarketParameterStorageLib {
    struct MarketParameterStoragePointer {
        PackedMarketParameter value;
    }

    uint256 private constant OFFSET = 10 ** 9;

    error MarketParameterStorageOverflowError();

    function read(MarketParameterStorage self) internal view returns (MarketParameter memory) {
        PackedMarketParameter memory value = _pointer(self).value;
        return MarketParameter(
            UFixed18.wrap(uint256(value.maintenance) * OFFSET),
            UFixed18.wrap(uint256(value.fundingFee) * OFFSET),
            UFixed18.wrap(uint256(value.makerFee) * OFFSET),
            UFixed18.wrap(uint256(value.takerFee) * OFFSET),
            UFixed18.wrap(uint256(value.positionFee) * OFFSET),
            UFixed18.wrap(uint256(value.makerLimit) * OFFSET),
            value.closed,
            value.utilizationCurve,
            value.rewardRate
        );
    }

    function store(MarketParameterStorage self, MarketParameter memory parameter) internal {
        //TODO: check mod for precision
        if (parameter.maintenance.gt(UFixed18Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.fundingFee.gt(UFixed18Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.makerFee.gt(UFixed18Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.takerFee.gt(UFixed18Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.positionFee.gt(UFixed18Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.makerLimit.gt(UFixed18Lib.from(18_446_744_073))) revert MarketParameterStorageOverflowError();

        _pointer(self).value = PackedMarketParameter(
            uint32(UFixed18.unwrap(parameter.maintenance) / OFFSET),
            uint32(UFixed18.unwrap(parameter.fundingFee) / OFFSET),
            uint32(UFixed18.unwrap(parameter.makerFee) / OFFSET),
            uint32(UFixed18.unwrap(parameter.takerFee) / OFFSET),
            uint32(UFixed18.unwrap(parameter.positionFee) / OFFSET),
            uint64(UFixed18.unwrap(parameter.makerLimit) / OFFSET),
            parameter.closed,
            bytes3(0x000000),
            parameter.utilizationCurve,
            parameter.rewardRate
        );
    }

    function _pointer(MarketParameterStorage self) private pure returns (MarketParameterStoragePointer storage pointer) {
        assembly ("memory-safe") { pointer.slot := self }
    }
}