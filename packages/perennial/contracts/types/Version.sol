// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "./number/UFixed6.sol";
import "./Position.sol";
import "./Accumulator.sol";
import "./OracleVersion.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./Fee.sol";

/// @dev Version type
struct Version {
    int64 _makerValue;
    int64 _takerValue;

    int64 _makerReward;
    int64 _takerReward;
}
using VersionLib for Version global;

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

    function value(Version memory self) internal pure returns (Accumulator memory) {
        return Accumulator(
            Fixed6.wrap(int256(self._makerValue)),
            Fixed6.wrap(int256(self._takerValue))
        );
    }

    function reward(Version memory self) internal pure returns (Accumulator memory) {
        return Accumulator(
            Fixed6.wrap(int256(self._makerReward)),
            Fixed6.wrap(int256(self._takerReward))
        );
    }

    function _update(Version memory self, Accumulator memory newValue, Accumulator memory newReward) private pure {
        self._makerValue = int64(Fixed6.unwrap(newValue.maker));
        self._takerValue = int64(Fixed6.unwrap(newValue.taker));
        self._makerReward = int64(Fixed6.unwrap(newReward.maker));
        self._takerReward = int64(Fixed6.unwrap(newReward.taker));
    }

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
        Accumulator memory valueAccumulator = self.value();
        (UFixed6 makerProtocolFee, UFixed6 takerProtocolFee) =
            (marketParameter.positionFee.mul(makerFee), marketParameter.positionFee.mul(takerFee));
        (makerFee, takerFee) = (makerFee.sub(makerProtocolFee), takerFee.sub(takerProtocolFee));
        positionFee = makerProtocolFee.add(takerProtocolFee);

        // If there are makers to distribute the taker's position fee to, distribute. Otherwise give it to the protocol
        if (!position.maker().isZero()) {
            valueAccumulator.incrementMaker(Fixed6Lib.from(takerFee), position.maker());
        } else {
            positionFee = protocolParameter.protocolFee.add(takerFee);
        }

        // If there are takers to distribute the maker's position fee to, distribute. Otherwise give it to the protocol
        if (!position.taker().isZero()) {
            valueAccumulator.incrementTaker(Fixed6Lib.from(makerFee), position.taker());
        } else {
            positionFee = protocolParameter.protocolFee.add(makerFee);
        }

        _update(self, valueAccumulator, self.reward());
    }

    /**
     * @notice Accumulates the global state for the period from `fromVersion` to `toOracleVersion`
     * @param versionAccumulator The struct to operate on
     */
    function accumulate(
        Version memory versionAccumulator,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6 fundingFeeAmount) {
        // load
        (Accumulator memory valueAccumulator, Accumulator memory rewardAccumulator) =
            (versionAccumulator.value(), versionAccumulator.reward());

        // accumulate funding
        fundingFeeAmount = _accumulateFunding(
            valueAccumulator,
            position,
            fromOracleVersion,
            toOracleVersion,
            protocolParameter,
            marketParameter
        );

        // accumulate position
        _accumulatePosition(valueAccumulator, position, fromOracleVersion, toOracleVersion, marketParameter);

        // accumulate reward
        _accumulateReward(rewardAccumulator, position, fromOracleVersion, toOracleVersion, marketParameter); //TODO: auto-shutoff if not enough reward ERC20s in contract?

        // update
        _update(versionAccumulator, valueAccumulator, rewardAccumulator);
    }

    /**
     * @notice Globally accumulates all funding since last oracle update
     * @dev If an oracle version is skipped due to no pre positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @return fundingFeeAmount The total fee accrued from funding accumulation
     */
    function _accumulateFunding(
        Accumulator memory valueAccumulator,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed6 fundingFeeAmount) {
        if (marketParameter.closed) return UFixed6Lib.ZERO;
        if (position.taker().isZero()) return UFixed6Lib.ZERO;
        if (position.maker().isZero()) return UFixed6Lib.ZERO;

        UFixed6 takerNotional = Fixed6Lib.from(position.taker()).mul(fromOracleVersion.price).abs();
        UFixed6 socializedNotional = takerNotional.mul(position.socializationFactor());
        Fixed18 annualizedRate =
            marketParameter.utilizationCurve.compute(UFixed18.wrap(UFixed6.unwrap(position.utilization()) * 1e12)); //TODO: cleanup curve with UFixed6

        Fixed6 fundingAccumulated = Fixed6.wrap(Fixed18.unwrap(annualizedRate) / 1e12)                 // yearly funding rate
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
        valueAccumulator.incrementMaker(
            makerPaysFunding ? fundingAccumulated : fundingAccumulatedWithoutFee, position.maker());
        valueAccumulator.decrementTaker(
            makerPaysFunding ? fundingAccumulatedWithoutFee : fundingAccumulated, position.taker());
    }

    /**
     * @notice Globally accumulates position PNL since last oracle update
     */
    function _accumulatePosition(
        Accumulator memory valueAccumulator,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter
    ) private pure {
        if (marketParameter.closed) return;
        if (position.taker().isZero()) return;
        if (position.maker().isZero()) return;

        Fixed6 totalTakerDelta =
            toOracleVersion.price.sub(fromOracleVersion.price).mul(Fixed6Lib.from(position.taker()));
        Fixed6 socializedTakerDelta = totalTakerDelta.mul(Fixed6Lib.from(position.socializationFactor()));

        //TODO: can combine stuff like this into one accumulate
        valueAccumulator.decrementMaker(socializedTakerDelta, position.maker());
        valueAccumulator.incrementTaker(socializedTakerDelta, position.taker());
    }

    /**
     * @notice Globally accumulates position's reward since last oracle update
     * @dev This is used to compute incentivization rewards based on market participation
     */
    function _accumulateReward(
        Accumulator memory rewardAccumulator,
        Position memory position,
        OracleVersion memory fromOracleVersion,
        OracleVersion memory toOracleVersion,
        MarketParameter memory marketParameter
    ) private pure {
        UFixed6 elapsed = UFixed6Lib.from(toOracleVersion.timestamp - fromOracleVersion.timestamp);

        if (!position.maker().isZero()) rewardAccumulator
            .incrementMaker(Fixed6Lib.from(elapsed).mul(marketParameter.rewardRate.taker), position.maker());
        if (!position.taker().isZero()) rewardAccumulator
            .incrementTaker(Fixed6Lib.from(elapsed).mul(marketParameter.rewardRate.maker), position.taker());
    }
}
