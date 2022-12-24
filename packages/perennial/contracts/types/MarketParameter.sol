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
    uint24 maintenance; // <= 1677%
    uint24 fundingFee;  // <= 1677%
    uint24 makerFee;    // <= 1677%
    uint24 takerFee;    // <= 1677%
    uint24 positionFee; // <= 1677%
    uint48 makerLimit;  // <= 281m
    bool closed;
    bytes11 __unallocated0__;

    /* slot 2 */
    int32 rewardRateMaker;                    // <= 2147.48 / s
    int32 rewardRateTaker;                    // <= 2147.48 / s
    int32 utilizationCurveMinRate;            // <= 214748%
    int32 utilizationCurveMaxRate;            // <= 214748%
    int32 utilizationCurveTargetRate;         // <= 214748%
    uint24 utilizationCurveTargetUtilization; // <= 1677%
    bytes9 __unallocated1__;

    /* slot 3 */
    address oracle;
    bytes12 __unallocated2__;

    /* slot 4 */
    address payoffProvider;
    bool payoffShort;
    bytes11 __unallocated3__;
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

        _pointer(self).value = PackedMarketParameter(
            uint24(UFixed18.unwrap(parameter.maintenance) / 1e12),
            uint24(UFixed18.unwrap(parameter.fundingFee) / 1e12),
            uint24(UFixed18.unwrap(parameter.makerFee) / 1e12),
            uint24(UFixed18.unwrap(parameter.takerFee) / 1e12),
            uint24(UFixed18.unwrap(parameter.positionFee) / 1e12),
            uint48(UFixed18.unwrap(parameter.makerLimit) / 1e12),
            parameter.closed,
            bytes6(0x000000000000),
            int32(Fixed18.unwrap(parameter.rewardRate.maker) / 1e12),
            int32(Fixed18.unwrap(parameter.rewardRate.taker) / 1e12),
            int32(PackedFixed18.unwrap(parameter.utilizationCurve.minRate) / 1e12),
            int32(PackedFixed18.unwrap(parameter.utilizationCurve.maxRate) / 1e12),
            int32(PackedFixed18.unwrap(parameter.utilizationCurve.targetRate) / 1e12),
            uint24(PackedUFixed18.unwrap(parameter.utilizationCurve.targetUtilization) / 1e12),
            bytes8(0x00000000000000),
            address(parameter.oracle),
            bytes12(0x0000000000000000000000),
            address(parameter.payoff.provider),
            parameter.payoff.short,
            bytes11(0x00000000000000000000)
        );
    }

    function _pointer(MarketParameterStorage self) private pure returns (MarketParameterStoragePointer storage pointer) {
        assembly ("memory-safe") { pointer.slot := self }
    }
}