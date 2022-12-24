// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./number/UFixed6.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "../interfaces/IPayoffProvider.sol";
import "../interfaces/IOracleProvider.sol";
import "./Accumulator.sol";
import "./Payoff.sol";

/// @dev MarketParameter type
struct MarketParameter {
    UFixed6 maintenance; // <= 429496%
    UFixed6 fundingFee;  // <= 429496%
    UFixed6 makerFee;    // <= 429496%
    UFixed6 takerFee;    // <= 429496%
    UFixed6 positionFee; // <= 429496%
    UFixed6 makerLimit;  // <= 18.45tn
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
            UFixed6.wrap(uint256(value.maintenance)),
            UFixed6.wrap(uint256(value.fundingFee)),
            UFixed6.wrap(uint256(value.makerFee)),
            UFixed6.wrap(uint256(value.takerFee)),
            UFixed6.wrap(uint256(value.positionFee)),
            UFixed6.wrap(uint256(value.makerLimit)),
            value.closed,
            Accumulator(
                Fixed6.wrap(int256(value.rewardRateMaker)),
                Fixed6.wrap(int256(value.rewardRateTaker))
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
        if (parameter.maintenance.gt(UFixed6Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.fundingFee.gt(UFixed6Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.makerFee.gt(UFixed6Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.takerFee.gt(UFixed6Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.positionFee.gt(UFixed6Lib.ONE)) revert MarketParameterStorageOverflowError();

        _pointer(self).value = PackedMarketParameter({
            maintenance: uint24(UFixed6.unwrap(parameter.maintenance)),
            fundingFee: uint24(UFixed6.unwrap(parameter.fundingFee)),
            makerFee: uint24(UFixed6.unwrap(parameter.makerFee)),
            takerFee: uint24(UFixed6.unwrap(parameter.takerFee)),
            positionFee: uint24(UFixed6.unwrap(parameter.positionFee)),
            makerLimit: uint48(UFixed6.unwrap(parameter.makerLimit)),
            closed: parameter.closed,
            rewardRateMaker: int32(Fixed6.unwrap(parameter.rewardRate.maker)),
            rewardRateTaker: int32(Fixed6.unwrap(parameter.rewardRate.taker)),
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