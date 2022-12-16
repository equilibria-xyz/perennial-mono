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
    /// @dev Accumulator value at each settled oracle version
    Accumulator value;

    /// @dev Accumulator reward at each settled oracle version
    Accumulator reward;
    
    /// @dev Global position at each version
    Position position;
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
        // load
        UFixed18 feeAccumulator;

        // accumulate funding
        feeAccumulator = _accumulateFunding(versionAccumulator, feeAccumulator, period, protocolParameter, marketParameter);

        // accumulate position
        _accumulatePosition(versionAccumulator, period, marketParameter);

        // accumulate reward
        _accumulateReward(versionAccumulator, period, marketParameter); //TODO: auto-shutoff if not enough reward ERC20s in contract?

        // accumulate position fee
        feeAccumulator = _accumulatePositionFee(versionAccumulator, feeAccumulator, pre, marketParameter);

        // update
        versionAccumulator.position = versionAccumulator.position.next(pre);
        pre.clear();
        fee.update(feeAccumulator, protocolParameter.protocolFee);
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
        Version memory versionAccumulator,
        UFixed18 feeAccumulator,
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
        if (!versionAccumulator.position.maker().isZero()) {
            versionAccumulator.value.incrementMaker(Fixed18Lib.from(takerPositionFee), versionAccumulator.position.maker());
        } else {
            newFeeAccumulator = newFeeAccumulator.add(takerPositionFee);
        }

        // If there are takers to distribute the maker's position fee to, distribute. Otherwise give it to the protocol
        if (!versionAccumulator.position.taker().isZero()) {
            versionAccumulator.value.incrementTaker(Fixed18Lib.from(makerPositionFee), versionAccumulator.position.taker());
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
        Version memory versionAccumulator,
        UFixed18 feeAccumulator,
        Period memory period,
        ProtocolParameter memory protocolParameter,
        MarketParameter memory marketParameter
    ) private pure returns (UFixed18 newFeeAccumulator) {
        if (marketParameter.closed) return feeAccumulator;
        if (versionAccumulator.position.taker().isZero()) return feeAccumulator;
        if (versionAccumulator.position.maker().isZero()) return feeAccumulator;

        UFixed18 takerNotional = Fixed18Lib.from(versionAccumulator.position.taker()).mul(period.fromVersion.price).abs();
        UFixed18 socializedNotional = takerNotional.mul(versionAccumulator.position.socializationFactor());

        Fixed18 fundingAccumulated = marketParameter.utilizationCurve.compute(versionAccumulator.position.utilization())     // yearly funding rate
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
        versionAccumulator.value.incrementMaker(
            makerPaysFunding ? fundingAccumulated : fundingAccumulatedWithoutFee, versionAccumulator.position.maker());
        versionAccumulator.value.decrementTaker(
            makerPaysFunding ? fundingAccumulatedWithoutFee : fundingAccumulated, versionAccumulator.position.taker());

        newFeeAccumulator = feeAccumulator.add(newFeeAccumulator);
    }

    /**
     * @notice Globally accumulates position PNL since last oracle update
     * @param period The oracle version period to settle for
     */
    function _accumulatePosition(
        Version memory versionAccumulator,
        Period memory period,
        MarketParameter memory marketParameter
    ) private pure {
        if (marketParameter.closed) return;
        if (versionAccumulator.position.taker().isZero()) return;
        if (versionAccumulator.position.maker().isZero()) return;

        Fixed18 totalTakerDelta = period.priceDelta().mul(Fixed18Lib.from(versionAccumulator.position.taker()));
        Fixed18 socializedTakerDelta = totalTakerDelta.mul(Fixed18Lib.from(versionAccumulator.position.socializationFactor()));

        //TODO: can combine stuff like this into one accumulate
        versionAccumulator.value.decrementMaker(socializedTakerDelta, versionAccumulator.position.maker());
        versionAccumulator.value.incrementTaker(socializedTakerDelta, versionAccumulator.position.taker());
    }

    /**
     * @notice Globally accumulates position's reward since last oracle update
     * @dev This is used to compute incentivization rewards based on market participation
     * @param period The oracle version period to settle for
     */
    function _accumulateReward(
        Version memory versionAccumulator,
        Period memory period,
        MarketParameter memory marketParameter
    ) private pure {
        UFixed18 elapsed = period.timestampDelta();

        if (!versionAccumulator.position.maker().isZero()) versionAccumulator.reward
            .incrementMaker(Fixed18Lib.from(elapsed).mul(marketParameter.rewardRate.taker()), versionAccumulator.position.maker());
        if (!versionAccumulator.position.taker().isZero()) versionAccumulator.reward
            .incrementTaker(Fixed18Lib.from(elapsed).mul(marketParameter.rewardRate.maker()), versionAccumulator.position.taker());
    }
}
