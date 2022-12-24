// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "../interfaces/IPayoffProvider.sol";
import "../interfaces/IOracleProvider.sol";
import "./Accumulator.sol";
import "./Payoff.sol";

/// @dev MarketParameter type
struct MarketParameter {
    UFixed18 maintenance; // <= 429496%
    UFixed18 fundingFee;  // <= 429496%
    UFixed18 makerFee;    // <= 429496%
    UFixed18 takerFee;    // <= 429496%
    UFixed18 positionFee; // <= 429496%
    UFixed18 makerLimit;  // <= 18.45tn
    bool closed;
    Accumulator rewardRate; //TODO: better to represent as non-negative accumulator?
    JumpRateUtilizationCurve utilizationCurve;
    IOracleProvider oracle;
    Payoff payoff;
}
struct PackedMarketParameter {
    /* slot 1 */
    address oracle;
    uint24 maintenance; // <= 1677%
    uint24 fundingFee;  // <= 1677%
    uint24 makerFee;    // <= 1677%
    uint24 takerFee;    // <= 1677%

    /* slot 2 */
    address payoffProvider;
    bool payoffShort;
    int32 rewardRateMaker;  // <= 2147.48 / s
    int32 rewardRateTaker;  // <= 2147.48 / s
    uint24 positionFee;     // <= 1677%

    /* slot 3 */
    uint48 makerLimit;  // <= 281m
    int32 utilizationCurveMinRate;            // <= 214748%
    int32 utilizationCurveMaxRate;            // <= 214748%
    int32 utilizationCurveTargetRate;         // <= 214748%
    uint24 utilizationCurveTargetUtilization; // <= 1677%
    bool closed;
    bytes10 __unallocated0__;
}
type MarketParameterStorage is bytes32;
using MarketParameterStorageLib for MarketParameterStorage global;

library MarketParameterStorageLib {
    struct MarketParameterStoragePointer { PackedMarketParameter value; }

    error MarketParameterStorageOverflowError();

    function read(MarketParameterStorage self) internal view returns (MarketParameter memory) {
        PackedMarketParameter memory value = _pointer(self).value;
        return MarketParameter(
            UFixed18.wrap(uint256(value.maintenance) * 1e12),
            UFixed18.wrap(uint256(value.fundingFee) * 1e12),
            UFixed18.wrap(uint256(value.makerFee) * 1e12),
            UFixed18.wrap(uint256(value.takerFee) * 1e12),
            UFixed18.wrap(uint256(value.positionFee) * 1e12),
            UFixed18.wrap(uint256(value.makerLimit) * 1e12),
            value.closed,
            Accumulator(
                Fixed18.wrap(int256(value.rewardRateMaker) * 1e12),
                Fixed18.wrap(int256(value.rewardRateTaker) * 1e12)
            ),
            JumpRateUtilizationCurve(
                PackedFixed18.wrap(int128(value.utilizationCurveMinRate) * 1e12),
                PackedFixed18.wrap(int128(value.utilizationCurveMaxRate) * 1e12),
                PackedFixed18.wrap(int128(value.utilizationCurveTargetRate) * 1e12),
                PackedUFixed18.wrap(uint128(value.utilizationCurveTargetUtilization) * 1e12)
            ),
            IOracleProvider(value.oracle),
            Payoff(IPayoffProvider(value.payoffProvider), value.payoffShort)
        );
    }

    function store(MarketParameterStorage self, MarketParameter memory parameter) internal {
        //TODO: check mod for precision
        if (parameter.maintenance.gt(UFixed18Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.fundingFee.gt(UFixed18Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.makerFee.gt(UFixed18Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.takerFee.gt(UFixed18Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.positionFee.gt(UFixed18Lib.ONE)) revert MarketParameterStorageOverflowError();

        _pointer(self).value = PackedMarketParameter({
            maintenance: uint24(UFixed18.unwrap(parameter.maintenance) / 1e12),
            fundingFee: uint24(UFixed18.unwrap(parameter.fundingFee) / 1e12),
            makerFee: uint24(UFixed18.unwrap(parameter.makerFee) / 1e12),
            takerFee: uint24(UFixed18.unwrap(parameter.takerFee) / 1e12),
            positionFee: uint24(UFixed18.unwrap(parameter.positionFee) / 1e12),
            makerLimit: uint48(UFixed18.unwrap(parameter.makerLimit) / 1e12),
            closed: parameter.closed,
            rewardRateMaker: int32(Fixed18.unwrap(parameter.rewardRate.maker) / 1e12),
            rewardRateTaker: int32(Fixed18.unwrap(parameter.rewardRate.taker) / 1e12),
            utilizationCurveMinRate: int32(PackedFixed18.unwrap(parameter.utilizationCurve.minRate) / 1e12),
            utilizationCurveMaxRate: int32(PackedFixed18.unwrap(parameter.utilizationCurve.maxRate) / 1e12),
            utilizationCurveTargetRate: int32(PackedFixed18.unwrap(parameter.utilizationCurve.targetRate) / 1e12),
            utilizationCurveTargetUtilization: uint24(PackedUFixed18.unwrap(parameter.utilizationCurve.targetUtilization) / 1e12),
            oracle: address(parameter.oracle),
            payoffProvider: address(parameter.payoff.provider),
            payoffShort: parameter.payoff.short,
            __unallocated0__: bytes10(0x00000000000000000000)
        });
    }

    function _pointer(MarketParameterStorage self) private pure returns (MarketParameterStoragePointer storage pointer) {
        assembly ("memory-safe") { pointer.slot := self }
    }
}