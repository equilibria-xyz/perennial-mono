// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "./Accumulator.sol";
import "./PrePosition.sol";
import "./ProtocolParameter.sol";
import "./Period.sol";
import "./Fee.sol";

/// @dev Version type
struct Version {
    int64 _makerValue; //TODO: standardize Fixed6 for 4-value-per-slot packing (USD amounts)
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
            PackedFixed18.wrap(int128(self._makerValue * 1e12)),
            PackedFixed18.wrap(int128(self._takerValue * 1e12))
        );
    }

    function reward(Version memory self) internal pure returns (Accumulator memory) {
        return Accumulator(
            PackedFixed18.wrap(int128(self._makerReward * 1e12)),
            PackedFixed18.wrap(int128(self._takerReward * 1e12))
        );
    }

    function _update(Version memory self, Accumulator memory newValue, Accumulator memory newReward) private pure {
        self._makerValue = int64(PackedFixed18.unwrap(newValue._maker) / 1e12);
        self._takerValue = int64(PackedFixed18.unwrap(newValue._taker) / 1e12);
        self._makerReward = int64(PackedFixed18.unwrap(newReward._maker) / 1e12);
        self._takerReward = int64(PackedFixed18.unwrap(newReward._taker) / 1e12);
    }

    /**
     * @notice Accumulates the global state for the period from `period.fromVersion` to `period.toVersion`
     * @param versionAccumulator The struct to operate on
     * @param period The oracle version period to settle for
     */
    function accumulate(
        Version memory versionAccumulator,
        Position memory position,
        PrePosition memory pre,
        Fee memory fee,
        Period memory period,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) internal pure {
        // load
        UFixed18 feeAccumulator;
        (Accumulator memory valueAccumulator, Accumulator memory rewardAccumulator) =
            (versionAccumulator.value(), versionAccumulator.reward());

        // accumulate funding
        feeAccumulator = _accumulateFunding(valueAccumulator, feeAccumulator, position, period, protocolParameter, marketParameter);

        // accumulate position
        _accumulatePosition(valueAccumulator, position, period, marketParameter);

        // accumulate reward
        _accumulateReward(rewardAccumulator, position, period, marketParameter); //TODO: auto-shutoff if not enough reward ERC20s in contract?

        // accumulate position fee
        feeAccumulator = _accumulatePositionFee(valueAccumulator, feeAccumulator, position, pre, marketParameter);

        // update
        _update(versionAccumulator, valueAccumulator, rewardAccumulator);
        fee.update(feeAccumulator, protocolParameter.protocolFee); //TODO: pull out?
    }

    /**
     * @notice Globally accumulates position fees since last oracle update
     * @dev Position fees are calculated based on the price at `latestOracleVersion` as that is the price used to
     *      calculate the user's fee total. In the event that settlement is occurring over multiple oracle versions
     *      (i.e. from a -> b -> c) it is safe to use the latestOracleVersion because in the a -> b case, a is always
     *      b - 1, and in the b -> c case the `PrePosition` is always empty so this is skipped.
     * @param pre The global pre-position
     * @return newFeeAccumulator The position fee that is retained by the protocol and product
     */
    function _accumulatePositionFee(
        Accumulator memory valueAccumulator,
        UFixed18 feeAccumulator,
        Position memory position,
        PrePosition memory pre,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed18 newFeeAccumulator) {
        if (pre.isEmpty()) return feeAccumulator;

        (UFixed18 makerPositionFee, UFixed18 takerPositionFee) = (pre.makerFee(), pre.takerFee());
        (UFixed18 makerProtocolFee, UFixed18 takerProtocolFee) =
            (marketParameter.positionFee.mul(makerPositionFee), marketParameter.positionFee.mul(takerPositionFee));
        (makerPositionFee, takerPositionFee) =
            (makerPositionFee.sub(makerProtocolFee), takerPositionFee.sub(takerProtocolFee));
        newFeeAccumulator = makerProtocolFee.add(takerProtocolFee);

        // If there are makers to distribute the taker's position fee to, distribute. Otherwise give it to the protocol
        if (!position.maker().isZero()) {
            valueAccumulator.incrementMaker(Fixed18Lib.from(takerPositionFee), position.maker());
        } else {
            newFeeAccumulator = newFeeAccumulator.add(takerPositionFee);
        }

        // If there are takers to distribute the maker's position fee to, distribute. Otherwise give it to the protocol
        if (!position.taker().isZero()) {
            valueAccumulator.incrementTaker(Fixed18Lib.from(makerPositionFee), position.taker());
        } else {
            newFeeAccumulator = newFeeAccumulator.add(makerPositionFee);
        }

        newFeeAccumulator = feeAccumulator.add(newFeeAccumulator);
    }

    /**
     * @notice Globally accumulates all funding since last oracle update
     * @dev If an oracle version is skipped due to no pre positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @param period The oracle version period to settle for
     * @return newFeeAccumulator The total fee accrued from funding accumulation
     */
    function _accumulateFunding(
        Accumulator memory valueAccumulator,
        UFixed18 feeAccumulator,
        Position memory position,
        Period memory period,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed18 newFeeAccumulator) {
        if (marketParameter.closed) return feeAccumulator;
        if (position.taker().isZero()) return feeAccumulator;
        if (position.maker().isZero()) return feeAccumulator;

        UFixed18 takerNotional = Fixed18Lib.from(position.taker()).mul(period.fromVersion.price).abs();
        UFixed18 socializedNotional = takerNotional.mul(position.socializationFactor());

        Fixed18 fundingAccumulated = marketParameter.utilizationCurve.compute(position.utilization())     // yearly funding rate
            .mul(Fixed18Lib.from(period.timestampDelta()))                                                      // multiply by seconds in period
            .div(Fixed18Lib.from(365 days))                                                                     // divide by seconds in year (funding rate for period)
            .mul(Fixed18Lib.from(socializedNotional));                                                          // multiply by socialized notion (funding for period)
        UFixed18 boundedFundingFee = UFixed18Lib.max(marketParameter.fundingFee, protocolParameter.minFundingFee);
        newFeeAccumulator = fundingAccumulated.abs().mul(boundedFundingFee);

        Fixed18 fundingAccumulatedWithoutFee = Fixed18Lib.from(
            fundingAccumulated.sign(),
            fundingAccumulated.abs().sub(newFeeAccumulator)
        );

        bool makerPaysFunding = fundingAccumulated.sign() < 0;
        valueAccumulator.incrementMaker(
            makerPaysFunding ? fundingAccumulated : fundingAccumulatedWithoutFee, position.maker());
        valueAccumulator.decrementTaker(
            makerPaysFunding ? fundingAccumulatedWithoutFee : fundingAccumulated, position.taker());

        newFeeAccumulator = feeAccumulator.add(newFeeAccumulator);
    }

    /**
     * @notice Globally accumulates position PNL since last oracle update
     * @param period The oracle version period to settle for
     */
    function _accumulatePosition(
        Accumulator memory valueAccumulator,
        Position memory position,
        Period memory period,
        MarketParameter memory marketParameter
    ) private pure {
        if (marketParameter.closed) return;
        if (position.taker().isZero()) return;
        if (position.maker().isZero()) return;

        Fixed18 totalTakerDelta = period.priceDelta().mul(Fixed18Lib.from(position.taker()));
        Fixed18 socializedTakerDelta = totalTakerDelta.mul(Fixed18Lib.from(position.socializationFactor()));

        //TODO: can combine stuff like this into one accumulate
        valueAccumulator.decrementMaker(socializedTakerDelta, position.maker());
        valueAccumulator.incrementTaker(socializedTakerDelta, position.taker());
    }

    /**
     * @notice Globally accumulates position's reward since last oracle update
     * @dev This is used to compute incentivization rewards based on market participation
     * @param period The oracle version period to settle for
     */
    function _accumulateReward(
        Accumulator memory rewardAccumulator,
        Position memory position,
        Period memory period,
        MarketParameter memory marketParameter
    ) private pure {
        UFixed18 elapsed = period.timestampDelta();

        if (!position.maker().isZero()) rewardAccumulator
            .incrementMaker(Fixed18Lib.from(elapsed).mul(marketParameter.rewardRate.taker()), position.maker());
        if (!position.taker().isZero()) rewardAccumulator
            .incrementTaker(Fixed18Lib.from(elapsed).mul(marketParameter.rewardRate.maker()), position.taker());
    }
}
