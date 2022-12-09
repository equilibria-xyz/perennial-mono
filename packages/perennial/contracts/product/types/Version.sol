// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "../../interfaces/types/Accumulator.sol";
import "../../interfaces/types/PackedAccumulator.sol";
import "../../interfaces/types/PackedPosition.sol";
import "../../interfaces/types/PrePosition.sol";
import "./Period.sol";
import "../../controller/types/ProtocolParameter.sol";
import "./Fee.sol";

/// @dev Version type
struct Version {
    /// @dev Accumulator value at each settled oracle version
    PackedAccumulator _value;

    /// @dev Accumulator reward at each settled oracle version
    PackedAccumulator _reward;
    
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
     * @notice Returns the value accumulator
     * @param self The struct to operate on
     * @return The stamped value accumulator at the requested version
     */
    function value(Version memory self) internal pure returns (Accumulator memory) {
        return self._value.unpack();
    }

    /**
     * @notice Returns the reward accumulator
     * @param self The struct to operate on
     * @return The stamped reward accumulator at the requested version
     */
    function reward(Version memory self) internal pure returns (Accumulator memory) {
        return self._reward.unpack();
    }

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
        Parameter memory parameter
    ) internal pure {
        // unpack
        UFixed18 feeAccumulator;
        (Accumulator memory valueAccumulator, Accumulator memory rewardAccumulator, Position memory latestPosition) =
            (versionAccumulator.value(), versionAccumulator.reward(), versionAccumulator.position());

        // accumulate funding
        feeAccumulator = _accumulateFunding(
            valueAccumulator,
            feeAccumulator,
            latestPosition,
            period,
            protocolParameter,
            parameter
        );

        // accumulate position
        _accumulatePosition(valueAccumulator, latestPosition, period, parameter);

        // accumulate reward
        _accumulateReward(rewardAccumulator, latestPosition, period, parameter); //TODO: auto-shutoff if not enough reward ERC20s in contract?

        // accumulate position fee
        feeAccumulator = _accumulatePositionFee(valueAccumulator, feeAccumulator, latestPosition, pre, parameter);

        // update
        versionAccumulator._value = valueAccumulator.pack();
        versionAccumulator._reward = rewardAccumulator.pack();
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
        Parameter memory parameter
    ) private pure returns (UFixed18 newFeeAccumulator) {
        if (pre.isEmpty()) return feeAccumulator;

        Position memory positionFeeAmount = pre.fees();
        Position memory protocolFeeAmount = positionFeeAmount.mul(parameter.positionFee);  //TODO: move this to update also?
        positionFeeAmount = positionFeeAmount.sub(protocolFeeAmount);
        newFeeAccumulator = protocolFeeAmount.sum();

        // If there are makers to distribute the taker's position fee to, distribute. Otherwise give it to the protocol
        if (!latestPosition.maker.isZero()) {
            valueAccumulator.maker = valueAccumulator.maker
                .add(Fixed18Lib.from(positionFeeAmount.taker.div(latestPosition.maker)));
        } else {
            newFeeAccumulator = newFeeAccumulator.add(positionFeeAmount.taker);
        }

        // If there are takers to distribute the maker's position fee to, distribute. Otherwise give it to the protocol
        if (!latestPosition.taker.isZero()) {
            valueAccumulator.taker = valueAccumulator.taker
                .add(Fixed18Lib.from(positionFeeAmount.maker.div(latestPosition.taker)));
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
        Parameter memory parameter
    ) private pure returns (UFixed18 newFeeAccumulator) {
        if (parameter.closed) return feeAccumulator;
        if (latestPosition.taker.isZero()) return feeAccumulator;
        if (latestPosition.maker.isZero()) return feeAccumulator;

        UFixed18 takerNotional = Fixed18Lib.from(latestPosition.taker).mul(period.fromVersion.price).abs();
        UFixed18 socializedNotional = takerNotional.mul(latestPosition.socializationFactor());

        Fixed18 fundingAccumulated = parameter.utilizationCurve.compute(latestPosition.utilization())     // yearly funding rate
            .mul(Fixed18Lib.from(period.timestampDelta()))                                                // multiply by seconds in period
            .div(Fixed18Lib.from(365 days))                                                               // divide by seconds in year (funding rate for period)
            .mul(Fixed18Lib.from(socializedNotional));                                                    // multiply by socialized notion (funding for period)
        UFixed18 boundedFundingFee = UFixed18Lib.max(parameter.fundingFee, protocolParameter.minFundingFee);
        newFeeAccumulator = fundingAccumulated.abs().mul(boundedFundingFee);

        Fixed18 fundingAccumulatedWithoutFee = Fixed18Lib.from(
            fundingAccumulated.sign(),
            fundingAccumulated.abs().sub(newFeeAccumulator)
        );

        bool makerPaysFunding = fundingAccumulated.sign() < 0;
        valueAccumulator.maker = valueAccumulator.maker
            .add(makerPaysFunding ? fundingAccumulated : fundingAccumulatedWithoutFee)
            .div(Fixed18Lib.from(latestPosition.maker));
        valueAccumulator.taker = valueAccumulator.taker
            .add(makerPaysFunding ? fundingAccumulatedWithoutFee : fundingAccumulated)
            .div(Fixed18Lib.from(latestPosition.taker))
            .mul(Fixed18Lib.NEG_ONE);

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
        Parameter memory parameter
    ) private pure {
        if (parameter.closed) return;
        if (latestPosition.taker.isZero()) return;
        if (latestPosition.maker.isZero()) return;

        Fixed18 totalTakerDelta = period.priceDelta().mul(Fixed18Lib.from(latestPosition.taker));
        Fixed18 socializedTakerDelta = totalTakerDelta.mul(Fixed18Lib.from(latestPosition.socializationFactor()));

        valueAccumulator.maker = valueAccumulator.maker
            .add(socializedTakerDelta)
            .div(Fixed18Lib.from(latestPosition.maker))
            .mul(Fixed18Lib.NEG_ONE);
        valueAccumulator.taker = valueAccumulator.taker
            .add(socializedTakerDelta)
            .div(Fixed18Lib.from(latestPosition.taker));
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
        Parameter memory parameter
    ) private pure {
        UFixed18 elapsed = period.timestampDelta();

        rewardAccumulator.maker = latestPosition.maker.isZero() ?
            rewardAccumulator.maker :
            rewardAccumulator.maker.add(
                Fixed18Lib.from(elapsed)
                    .mul(parameter.rewardRate.taker)
                    .div(Fixed18Lib.from(latestPosition.maker))
            );
        rewardAccumulator.taker = latestPosition.taker.isZero() ?
            rewardAccumulator.taker :
            rewardAccumulator.taker.add(
                Fixed18Lib.from(elapsed)
                    .mul(parameter.rewardRate.taker)
                    .div(Fixed18Lib.from(latestPosition.taker))
            );
    }
}
