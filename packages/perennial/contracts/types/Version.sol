// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./root/Accumulator6.sol";
import "./root/UAccumulator6.sol";
import "./Position.sol";
import "./OracleVersion.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./Fee.sol";

/// @dev Version type
struct Version {
    Accumulator6 makerValue;
    Accumulator6 takerValue;
    UAccumulator6 makerReward;
    UAccumulator6 takerReward;
}
using VersionLib for Version global;
struct StoredVersion {
    int64 _makerValue;
    int64 _takerValue;
    uint64 _makerReward;
    uint64 _takerReward;
}
struct VersionStorage { StoredVersion value; }
using VersionStorageLib for VersionStorage global;

/**
 * @title VersionLib
 * @notice Library that manages global versioned accumulator state.
 * @dev Manages two accumulators: value and reward. The value accumulator measures the change in position value
 *      over time. The reward accumulator measures the change in liquidity ownership over time (for tracking
 *      incentivization rewards).
 *
 *      Both accumulators are stamped for historical lookup anytime there is a global settlement, which services
 *      the delayed-position accounting. It is not guaranteed that every version will have a value stamped, but
 *      only versions when a settlement occurred are needed for this historical computation.
 */
library VersionLib {
    /**
     * @notice Globally accumulates position fees since last oracle update
     * @dev Position fees are calculated based on the price at `latestOracleVersion` as that is the price used to
     *      calculate the user's fee total. In the event that settlement is occurring over multiple oracle versions
     *      (i.e. from a -> b -> c) it is safe to use the latestOracleVersion because in the a -> b case, a is always
     *      b - 1, and in the b -> c case the `PrePosition` is always empty so this is skipped.
     * @return positionFee The position fee that is retained by the protocol and product
     */
    function update(
        Version memory self,
        Position memory position,
        UFixed6 makerFee,
        UFixed6 takerFee,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6 positionFee) {
        (UFixed6 makerProtocolFee, UFixed6 takerProtocolFee) =
            (marketParameter.positionFee.mul(makerFee), marketParameter.positionFee.mul(takerFee));
        (makerFee, takerFee) = (makerFee.sub(makerProtocolFee), takerFee.sub(takerProtocolFee));
        positionFee = makerProtocolFee.add(takerProtocolFee);

        // If there are makers to distribute the taker's position fee to, distribute. Otherwise give it to the protocol
        if (!position.maker.isZero()) {
            self.makerValue.increment(Fixed6Lib.from(takerFee), position.maker);
        } else {
            positionFee = protocolParameter.protocolFee.add(takerFee);
        }

        // If there are takers to distribute the maker's position fee to, distribute. Otherwise give it to the protocol
        if (!position.taker.isZero()) {
            self.takerValue.increment(Fixed6Lib.from(makerFee), position.taker);
        } else {
            positionFee = protocolParameter.protocolFee.add(makerFee);
        }
    }

    /**
     * @notice Accumulates the global state for the period from `fromVersion` to `toOracleVersion`
     * @param self The struct to operate on
     */
    function accumulate(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6 fundingFeeAmount) {
        // accumulate funding
        fundingFeeAmount =
            _accumulateFunding(self, position, fromOracleVersion, toOracleVersion, protocolParameter, marketParameter);

        // accumulate position
        _accumulatePosition(self, position, fromOracleVersion, toOracleVersion, marketParameter);

        // accumulate reward
        _accumulateReward(self, position, fromOracleVersion, toOracleVersion, marketParameter); //TODO: auto-shutoff if not enough reward ERC20s in contract?
    }

    /**
     * @notice Globally accumulates all funding since last oracle update
     * @dev If an oracle version is skipped due to no pre positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @return fundingFeeAmount The total fee accrued from funding accumulation
     */
    function _accumulateFunding(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed6 fundingFeeAmount) {
        if (marketParameter.closed) return UFixed6Lib.ZERO;
        if (position.taker.isZero()) return UFixed6Lib.ZERO;
        if (position.maker.isZero()) return UFixed6Lib.ZERO;

        UFixed6 takerNotional = Fixed6Lib.from(position.taker).mul(fromOracleVersion.price).abs();
        UFixed6 socializedNotional = takerNotional.mul(position.socializationFactor());

        Fixed6 fundingAccumulated = marketParameter.utilizationCurve.compute(position.utilization())     // yearly funding rate
            .mul(Fixed6Lib.from(int256(toOracleVersion.timestamp - fromOracleVersion.timestamp)))        // multiply by seconds in period
            .div(Fixed6Lib.from(365 days))                                                               // divide by seconds in year (funding rate for period)
            .mul(Fixed6Lib.from(socializedNotional));                                                    // multiply by socialized notion (funding for period)
        UFixed6 boundedFundingFee = UFixed6Lib.max(marketParameter.fundingFee, protocolParameter.minFundingFee);
        fundingFeeAmount = fundingAccumulated.abs().mul(boundedFundingFee);

        Fixed6 fundingAccumulatedWithoutFee = Fixed6Lib.from(
            fundingAccumulated.sign(),
            fundingAccumulated.abs().sub(fundingFeeAmount)
        );

        bool makerPaysFunding = fundingAccumulated.sign() < 0;
        self.makerValue.increment(
            makerPaysFunding ? fundingAccumulated : fundingAccumulatedWithoutFee, position.maker);
        self.takerValue.decrement(
            makerPaysFunding ? fundingAccumulatedWithoutFee : fundingAccumulated, position.taker);
    }

    /**
     * @notice Globally accumulates position PNL since last oracle update
     */
    function _accumulatePosition(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter
    ) private pure {
        if (marketParameter.closed) return;
        if (position.taker.isZero()) return;
        if (position.maker.isZero()) return;

        Fixed6 totalTakerDelta =
            toOracleVersion.price.sub(fromOracleVersion.price).mul(Fixed6Lib.from(position.taker));
        Fixed6 socializedTakerDelta = totalTakerDelta.mul(Fixed6Lib.from(position.socializationFactor()));

        self.makerValue.decrement(socializedTakerDelta, position.maker);
        self.takerValue.increment(socializedTakerDelta, position.taker);
    }

    /**
     * @notice Globally accumulates position's reward since last oracle update
     * @dev This is used to compute incentivization rewards based on market participation
     */
    function _accumulateReward(
        Version memory self,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter
    ) private pure {
        UFixed6 elapsed = UFixed6Lib.from(toOracleVersion.timestamp - fromOracleVersion.timestamp);

        if (!position.maker.isZero())
            self.makerReward.increment(elapsed.mul(marketParameter.takerRewardRate), position.maker);
        if (!position.taker.isZero())
            self.takerReward.increment(elapsed.mul(marketParameter.makerRewardRate), position.taker);
    }
}

library VersionStorageLib {
    function read(VersionStorage storage self) internal view returns (Version memory) {
        StoredVersion memory storedValue =  self.value;
        return Version(
            Accumulator6(Fixed6.wrap(int256(storedValue._makerValue))),
            Accumulator6(Fixed6.wrap(int256(storedValue._takerValue))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._makerReward))),
            UAccumulator6(UFixed6.wrap(uint256(storedValue._takerReward)))
        );
    }

    function store(VersionStorage storage self, Version memory newValue) internal {
        self.value = StoredVersion(
            int64(Fixed6.unwrap(newValue.makerValue._value)),
            int64(Fixed6.unwrap(newValue.takerValue._value)),
            uint64(UFixed6.unwrap(newValue.makerReward._value)),
            uint64(UFixed6.unwrap(newValue.takerReward._value))
        );
    }
}
