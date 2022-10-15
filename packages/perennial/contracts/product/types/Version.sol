// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "../../interfaces/IProduct.sol";
import "../../interfaces/types/Accumulator.sol";
import "./Period.sol";

/// @dev Version type
struct Version {
    /// @dev Accumulator value at each settled oracle version
    PackedAccumulator _value;

    /// @dev Accumulator share at each settled oracle version
    PackedAccumulator _share;
    
    /// @dev Global position at each version
    PackedPosition _position;
}
using VersionLib for Version global;

/**
 * @title VersionLib
 * @notice Library that manages global versioned accumulator state.
 * @dev Manages two accumulators: value and share. The value accumulator measures the change in position value
 *      over time. The share accumulator measures the change in liquidity ownership over time (for tracking
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
     * @notice Returns the share accumulator
     * @param self The struct to operate on
     * @return The stamped share accumulator at the requested version
     */
    function share(Version memory self) internal pure returns (Accumulator memory) {
        return self._share.unpack();
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
     * @return newVersionAccumulator The resulting version after accumulation
     * @return newFeeAccumulator The fee accrued from opening or closing a new position
     */
    function accumulateAndSettle(
        Version memory versionAccumulator,
        UFixed18 feeAccumulator,
        PrePosition memory pre,
        Period memory period,
        UFixed18 makerFee,
        UFixed18 takerFee,
        UFixed18 positionFee,
        ProductParams memory params
    ) internal pure returns (Version memory newVersionAccumulator, UFixed18 newFeeAccumulator) {
        // unpack
        (Accumulator memory valueAccumulator, Accumulator memory shareAccumulator, Position memory latestPosition) =
            (versionAccumulator.value(), versionAccumulator.share(), versionAccumulator.position());

        // accumulate funding
        (valueAccumulator, feeAccumulator) =
            _accumulateFunding(valueAccumulator, feeAccumulator, latestPosition, period, params.utilizationCurve, params.fundingFee, params.closed);

        // accumulate position
        (valueAccumulator) = _accumulatePosition(valueAccumulator, latestPosition, period, params.closed);

        // accumulate share
        (shareAccumulator) = _accumulateShare(shareAccumulator, latestPosition, period);

        // accumulate position fee
        (valueAccumulator, feeAccumulator) =
            _accumulatePositionFee(valueAccumulator, feeAccumulator, period, latestPosition, pre, makerFee, takerFee, positionFee);

        // pack
        newVersionAccumulator = Version(valueAccumulator.pack(), shareAccumulator.pack(), latestPosition.next(pre).pack());
        newFeeAccumulator = feeAccumulator.add(newFeeAccumulator);
    }

    struct ProductParams {
        JumpRateUtilizationCurve utilizationCurve;
        UFixed18 fundingFee;
        bool closed;
    }

    function accumulate(
        Version memory versionAccumulator,
        UFixed18 feeAccumulator,
        Period memory period,
        ProductParams memory params
    ) internal pure returns (Version memory newVersionAccumulator, UFixed18 newFeeAccumulator) {
        // unpack
        (Accumulator memory valueAccumulator, Accumulator memory shareAccumulator, Position memory latestPosition) =
            (versionAccumulator.value(), versionAccumulator.share(), versionAccumulator.position());

        // accumulate funding
        (valueAccumulator, feeAccumulator) =
            _accumulateFunding(valueAccumulator, feeAccumulator, latestPosition, period, params.utilizationCurve, params.fundingFee, params.closed);

        // accumulate position
        (valueAccumulator) = _accumulatePosition(valueAccumulator, latestPosition, period, params.closed);

        // accumulate share
        (shareAccumulator) = _accumulateShare(shareAccumulator, latestPosition, period);

        // unpack
        newVersionAccumulator = Version(valueAccumulator.pack(), shareAccumulator.pack(), versionAccumulator._position);
        newFeeAccumulator = feeAccumulator.add(newFeeAccumulator);
    }

    /**
     * @notice Globally accumulates position fees since last oracle update
     * @dev Position fees are calculated based on the price at `latestOracleVersion` as that is the price used to
     *      calculate the user's fee total. In the event that settlement is occurring over multiple oracle versions
     *      (i.e. from a -> b -> c) it is safe to use the latestOracleVersion because in the a -> b case, a is always
     *      b - 1, and in the b -> c case the `PrePosition` is always empty so this is skipped.
     * @param latestPosition The latest global position
     * @param pre The global pre-position
     * @return newValueAccumulator The total amount accumulated from position PNL
     * @return newFeeAccumulator The position fee that is retained by the protocol and product
     */
    function _accumulatePositionFee(
        Accumulator memory valueAccumulator,
        UFixed18 feeAccumulator,
        Period memory period,
        Position memory latestPosition,
        PrePosition memory pre,
        UFixed18 makerFee,
        UFixed18 takerFee,
        UFixed18 positionFee
    ) private pure returns (Accumulator memory newValueAccumulator, UFixed18 newFeeAccumulator) {
        if (pre.isEmpty()) return (valueAccumulator, feeAccumulator);

        Position memory positionFeeAmount = pre.computeFee(period.fromVersion, makerFee, takerFee);
        Position memory protocolFeeAmount = positionFeeAmount.mul(positionFee);
        positionFeeAmount = positionFeeAmount.sub(protocolFeeAmount);
        newFeeAccumulator = protocolFeeAmount.sum();

        // If there are makers to distribute the taker's position fee to, distribute. Otherwise give it to the protocol
        if (!latestPosition.maker.isZero()) {
            newValueAccumulator.maker = Fixed18Lib.from(positionFeeAmount.taker.div(latestPosition.maker));
        } else {
            newFeeAccumulator = newFeeAccumulator.add(positionFeeAmount.taker);
        }

        // If there are takers to distribute the maker's position fee to, distribute. Otherwise give it to the protocol
        if (!latestPosition.taker.isZero()) {
            newValueAccumulator.taker = Fixed18Lib.from(positionFeeAmount.maker.div(latestPosition.taker));
        } else {
            newFeeAccumulator = newFeeAccumulator.add(positionFeeAmount.maker);
        }

        newValueAccumulator = valueAccumulator.add(newValueAccumulator);
        newFeeAccumulator = feeAccumulator.add(newFeeAccumulator);
    }

    /**
     * @notice Globally accumulates all funding since last oracle update
     * @dev If an oracle version is skipped due to no pre positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @param fundingFee The funding fee rate for the product
     * @param latestPosition The latest global position
     * @param period The oracle version period to settle for
     * @param closed Whether the product is closed
     * @return newValueAccumulator The total amount accumulated from funding
     * @return newFeeAccumulator The total fee accrued from funding accumulation
     */
    function _accumulateFunding(
        Accumulator memory valueAccumulator,
        UFixed18 feeAccumulator,
        Position memory latestPosition,
        Period memory period,
        JumpRateUtilizationCurve memory utilizationCurve,
        UFixed18 fundingFee,
        bool closed
    ) private pure returns (Accumulator memory newValueAccumulator, UFixed18 newFeeAccumulator) {
        if (closed) return (valueAccumulator, feeAccumulator);
        if (latestPosition.taker.isZero()) return (valueAccumulator, feeAccumulator);
        if (latestPosition.maker.isZero()) return (valueAccumulator, feeAccumulator);

        UFixed18 takerNotional = Fixed18Lib.from(latestPosition.taker).mul(period.fromVersion.price).abs();
        UFixed18 socializedNotional = takerNotional.mul(latestPosition.socializationFactor());

        Fixed18 fundingAccumulated = utilizationCurve.compute(latestPosition.utilization())     // yearly funding rate
            .mul(Fixed18Lib.from(period.timestampDelta()))                                      // multiply by seconds in period
            .div(Fixed18Lib.from(365 days))                                                     // divide by seconds in year (funding rate for period)
            .mul(Fixed18Lib.from(socializedNotional));                                          // multiply by socialized notion (funding for period)
        newFeeAccumulator = fundingAccumulated.abs().mul(fundingFee);

        Fixed18 fundingAccumulatedWithoutFee = Fixed18Lib.from(
            fundingAccumulated.sign(),
            fundingAccumulated.abs().sub(newFeeAccumulator)
        );

        bool makerPaysFunding = fundingAccumulated.sign() < 0;
        newValueAccumulator.maker = (makerPaysFunding ? fundingAccumulated : fundingAccumulatedWithoutFee)
            .div(Fixed18Lib.from(latestPosition.maker));
        newValueAccumulator.taker = (makerPaysFunding ? fundingAccumulatedWithoutFee : fundingAccumulated)
            .div(Fixed18Lib.from(latestPosition.taker)).mul(Fixed18Lib.NEG_ONE);

        newValueAccumulator = valueAccumulator.add(newValueAccumulator);
        newFeeAccumulator = feeAccumulator.add(newFeeAccumulator);
    }

    /**
     * @notice Globally accumulates position PNL since last oracle update
     * @param latestPosition The latest global position
     * @param period The oracle version period to settle for
     * @param closed Whether the product is closed
     * @return newValueAccumulator The total amount accumulated from position PNL
     */
    function _accumulatePosition(
        Accumulator memory valueAccumulator,
        Position memory latestPosition,
        Period memory period,
        bool closed
    ) private pure returns (Accumulator memory newValueAccumulator) {
        if (closed) return valueAccumulator;
        if (latestPosition.taker.isZero()) return valueAccumulator;
        if (latestPosition.maker.isZero()) return valueAccumulator;

        Fixed18 totalTakerDelta = period.priceDelta().mul(Fixed18Lib.from(latestPosition.taker));
        Fixed18 socializedTakerDelta = totalTakerDelta.mul(Fixed18Lib.from(latestPosition.socializationFactor()));

        newValueAccumulator.maker = socializedTakerDelta.div(Fixed18Lib.from(latestPosition.maker)).mul(Fixed18Lib.NEG_ONE);
        newValueAccumulator.taker = socializedTakerDelta.div(Fixed18Lib.from(latestPosition.taker));

        newValueAccumulator = valueAccumulator.add(newValueAccumulator);
    }

    /**
     * @notice Globally accumulates position's share of the total market since last oracle update
     * @dev This is used to compute incentivization rewards based on market participation
     * @param latestPosition The latest global position
     * @param period The oracle version period to settle for
     * @return newShareAccumulator The total share amount accumulated per position
     */
    function _accumulateShare(
        Accumulator memory shareAccumulator,
        Position memory latestPosition,
        Period memory period
    ) private pure returns (Accumulator memory newShareAccumulator) {
        UFixed18 elapsed = UFixed18Lib.from(period.toVersion.timestamp - period.fromVersion.timestamp);

        newShareAccumulator.maker = latestPosition.maker.isZero() ?
            Fixed18Lib.ZERO :
            Fixed18Lib.from(elapsed.div(latestPosition.maker));
        newShareAccumulator.taker = latestPosition.taker.isZero() ?
            Fixed18Lib.ZERO :
            Fixed18Lib.from(elapsed.div(latestPosition.taker));

        newShareAccumulator = shareAccumulator.add(newShareAccumulator);
    }
}
