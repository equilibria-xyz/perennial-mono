// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./root/UFixed6.sol";
import "./root/JumpRateUtilizationCurve6.sol";
import "../interfaces/IPayoffProvider.sol";
import "../interfaces/IOracleProvider.sol";
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
    UFixed6 makerRewardRate;
    UFixed6 takerRewardRate;
    JumpRateUtilizationCurve6 utilizationCurve;
    IOracleProvider oracle;
    Payoff payoff;
}
struct StoredMarketParameter {
    /* slot 1 */
    address oracle;
    uint24 maintenance; // <= 1677%
    uint24 fundingFee;  // <= 1677%
    uint24 makerFee;    // <= 1677%
    uint24 takerFee;    // <= 1677%

    /* slot 2 */
    address payoffProvider;
    bool payoffShort;
    uint32 makerRewardRate;  // <= 2147.48 / s
    uint32 takerRewardRate;  // <= 2147.48 / s
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
struct MarketParameterStorage { StoredMarketParameter value; }
using MarketParameterStorageLib for MarketParameterStorage global;

library MarketParameterStorageLib {
    error MarketParameterStorageOverflowError();

    function read(MarketParameterStorage storage self) internal view returns (MarketParameter memory) {
        StoredMarketParameter memory value = self.value;
        return MarketParameter(
            UFixed6.wrap(uint256(value.maintenance)),
            UFixed6.wrap(uint256(value.fundingFee)),
            UFixed6.wrap(uint256(value.makerFee)),
            UFixed6.wrap(uint256(value.takerFee)),
            UFixed6.wrap(uint256(value.positionFee)),
            UFixed6.wrap(uint256(value.makerLimit)),
            value.closed,
            UFixed6.wrap(uint256(value.makerRewardRate)),
            UFixed6.wrap(uint256(value.takerRewardRate)),
            JumpRateUtilizationCurve6(
                Fixed6.wrap(int128(value.utilizationCurveMinRate)),
                Fixed6.wrap(int128(value.utilizationCurveMaxRate)),
                Fixed6.wrap(int128(value.utilizationCurveTargetRate)),
                UFixed6.wrap(uint128(value.utilizationCurveTargetUtilization))
            ),
            IOracleProvider(value.oracle),
            Payoff(IPayoffProvider(value.payoffProvider), value.payoffShort)
        );
    }

    function store(MarketParameterStorage storage self, MarketParameter memory parameter) internal {
        //TODO: check mod for precision
        if (parameter.maintenance.gt(UFixed6Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.fundingFee.gt(UFixed6Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.makerFee.gt(UFixed6Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.takerFee.gt(UFixed6Lib.ONE)) revert MarketParameterStorageOverflowError();
        if (parameter.positionFee.gt(UFixed6Lib.ONE)) revert MarketParameterStorageOverflowError();

        self.value = StoredMarketParameter({
            maintenance: uint24(UFixed6.unwrap(parameter.maintenance)),
            fundingFee: uint24(UFixed6.unwrap(parameter.fundingFee)),
            makerFee: uint24(UFixed6.unwrap(parameter.makerFee)),
            takerFee: uint24(UFixed6.unwrap(parameter.takerFee)),
            positionFee: uint24(UFixed6.unwrap(parameter.positionFee)),
            makerLimit: uint48(UFixed6.unwrap(parameter.makerLimit)),
            closed: parameter.closed,
            makerRewardRate: uint32(UFixed6.unwrap(parameter.makerRewardRate)),
            takerRewardRate: uint32(UFixed6.unwrap(parameter.takerRewardRate)),
            utilizationCurveMinRate: int32(Fixed6.unwrap(parameter.utilizationCurve.minRate)),
            utilizationCurveMaxRate: int32(Fixed6.unwrap(parameter.utilizationCurve.maxRate)),
            utilizationCurveTargetRate: int32(Fixed6.unwrap(parameter.utilizationCurve.targetRate)),
            utilizationCurveTargetUtilization: uint24(UFixed6.unwrap(parameter.utilizationCurve.targetUtilization)),
            oracle: address(parameter.oracle),
            payoffProvider: address(parameter.payoff.provider),
            payoffShort: parameter.payoff.short,
            __unallocated0__: bytes10(0x00000000000000000000)
        });
    }
}