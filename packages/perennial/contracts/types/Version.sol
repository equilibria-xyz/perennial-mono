// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "./Accumulator.sol";
import "./PackedPosition.sol";
import "./PrePosition.sol";
import "./ProtocolParameter.sol";
import "./Period.sol";
import "./Fee.sol";

/// @dev Version type
struct Version {
    /// @dev Accumulator value at each settled oracle version
    Accumulator value;

    /// @dev Accumulator reward at each settled oracle version
    Accumulator reward;
    
    /// @dev Global position at each version
    PackedPosition _position;
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
    /**
     * @notice Returns the global position
     * @param self The struct to operate on
     * @return Current global position
     */
    function position(Version memory self) internal pure returns (Position memory) {
        return self._position.unpack();
    }

    /**
     * @notice Accumulates the global state for the period from `period.fromVersion` to `period.toVersion`
     * @param versionAccumulator The struct to operate on
     * @param period The oracle version period to settle for
     */
    function accumulate(
        Version memory versionAccumulator,
        PrePosition memory pre,
        Fee memory fee,
        Period memory period,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) internal pure {
        // unpack
        UFixed18 feeAccumulator;
        //TODO: can pass the whole object around
        (Accumulator memory valueAccumulator, Accumulator memory rewardAccumulator, Position memory latestPosition) =
            (versionAccumulator.value, versionAccumulator.reward, versionAccumulator.position());

        // accumulate funding
        feeAccumulator = _accumulateFunding(
            valueAccumulator,
            feeAccumulator,
            latestPosition,
            period,
            protocolParameter,
            marketParameter
        );

        // accumulate position
        _accumulatePosition(valueAccumulator, latestPosition, period, marketParameter);

        // accumulate reward
        _accumulateReward(rewardAccumulator, latestPosition, period, marketParameter); //TODO: auto-shutoff if not enough reward ERC20s in contract?

        // accumulate position fee
        feeAccumulator = _accumulatePositionFee(valueAccumulator, feeAccumulator, latestPosition, pre, marketParameter);

        // update
        versionAccumulator.value = valueAccumulator;
        versionAccumulator.reward = rewardAccumulator;
        versionAccumulator._position = latestPosition.next(pre).pack();

        // external
        pre.clear();
        fee.update(feeAccumulator, protocolParameter.protocolFee);
    }

    /**
     * @notice Globally accumulates position fees since last oracle update
     * @dev Position fees are calculated based on the price at `latestOracleVersion` as that is the price used to
     *      calculate the user's fee total. In the event that settlement is occurring over multiple oracle versions
     *      (i.e. from a -> b -> c) it is safe to use the latestOracleVersion because in the a -> b case, a is always
     *      b - 1, and in the b -> c case the `PrePosition` is always empty so this is skipped.
     * @param latestPosition The latest global position
     * @param pre The global pre-position
     * @return newFeeAccumulator The position fee that is retained by the protocol and product
     */
    function _accumulatePositionFee(
        Accumulator memory valueAccumulator,
        UFixed18 feeAccumulator,
        Position memory latestPosition,
        PrePosition memory pre,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed18 newFeeAccumulator) {
        if (pre.isEmpty()) return feeAccumulator;

        Position memory positionFeeAmount = pre.fees();
        Position memory protocolFeeAmount = positionFeeAmount.mul(marketParameter.positionFee);  //TODO: move this to update also?
        positionFeeAmount = positionFeeAmount.sub(protocolFeeAmount);
        newFeeAccumulator = protocolFeeAmount.sum();

        // If there are makers to distribute the taker's position fee to, distribute. Otherwise give it to the protocol
        if (!latestPosition.maker.isZero()) {
            valueAccumulator.incrementMaker(Fixed18Lib.from(positionFeeAmount.taker), latestPosition.maker);
        } else {
            newFeeAccumulator = newFeeAccumulator.add(positionFeeAmount.taker);
        }

        // If there are takers to distribute the maker's position fee to, distribute. Otherwise give it to the protocol
        if (!latestPosition.taker.isZero()) {
            valueAccumulator.incrementTaker(Fixed18Lib.from(positionFeeAmount.maker), latestPosition.taker);
        } else {
            newFeeAccumulator = newFeeAccumulator.add(positionFeeAmount.maker);
        }

        newFeeAccumulator = feeAccumulator.add(newFeeAccumulator);
    }

    /**
     * @notice Globally accumulates all funding since last oracle update
     * @dev If an oracle version is skipped due to no pre positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @param latestPosition The latest global position
     * @param period The oracle version period to settle for
     * @return newFeeAccumulator The total fee accrued from funding accumulation
     */
    function _accumulateFunding(
        Accumulator memory valueAccumulator,
        UFixed18 feeAccumulator,
        Position memory latestPosition,
        Period memory period,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed18 newFeeAccumulator) {
        if (marketParameter.closed) return feeAccumulator;
        if (latestPosition.taker.isZero()) return feeAccumulator;
        if (latestPosition.maker.isZero()) return feeAccumulator;

        UFixed18 takerNotional = Fixed18Lib.from(latestPosition.taker).mul(period.fromVersion.price).abs();
        UFixed18 socializedNotional = takerNotional.mul(latestPosition.socializationFactor());

        Fixed18 fundingAccumulated = marketParameter.utilizationCurve.compute(latestPosition.utilization())     // yearly funding rate
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
        valueAccumulator
            .incrementMaker(makerPaysFunding ? fundingAccumulated : fundingAccumulatedWithoutFee, latestPosition.maker);
        valueAccumulator
            .decrementTaker(makerPaysFunding ? fundingAccumulatedWithoutFee : fundingAccumulated, latestPosition.taker);

        newFeeAccumulator = feeAccumulator.add(newFeeAccumulator);
    }

    /**
     * @notice Globally accumulates position PNL since last oracle update
     * @param latestPosition The latest global position
     * @param period The oracle version period to settle for
     */
    function _accumulatePosition(
        Accumulator memory valueAccumulator,
        Position memory latestPosition,
        Period memory period,
        MarketParameter memory marketParameter
    ) private pure {
        if (marketParameter.closed) return;
        if (latestPosition.taker.isZero()) return;
        if (latestPosition.maker.isZero()) return;

        Fixed18 totalTakerDelta = period.priceDelta().mul(Fixed18Lib.from(latestPosition.taker));
        Fixed18 socializedTakerDelta = totalTakerDelta.mul(Fixed18Lib.from(latestPosition.socializationFactor()));

        //TODO: can combine stuff like this into one accumulate
        valueAccumulator.decrementMaker(socializedTakerDelta, latestPosition.maker);
        valueAccumulator.incrementTaker(socializedTakerDelta, latestPosition.taker);
    }

    /**
     * @notice Globally accumulates position's reward since last oracle update
     * @dev This is used to compute incentivization rewards based on market participation
     * @param latestPosition The latest global position
     * @param period The oracle version period to settle for
     */
    function _accumulateReward(
        Accumulator memory rewardAccumulator,
        Position memory latestPosition,
        Period memory period,
        MarketParameter memory marketParameter
    ) private pure {
        UFixed18 elapsed = period.timestampDelta();

        if (!latestPosition.maker.isZero()) rewardAccumulator
            .incrementMaker(Fixed18Lib.from(elapsed).mul(marketParameter.rewardRate.taker()), latestPosition.maker);
        if (!latestPosition.taker.isZero()) rewardAccumulator
            .incrementTaker(Fixed18Lib.from(elapsed).mul(marketParameter.rewardRate.maker()), latestPosition.taker);
    }
}
