// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "../../../interfaces/IProduct.sol";
import "../../../interfaces/types/Accumulator.sol";
import "../AccumulatorParams.sol";
import "../Period.sol";

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
     * @param self The struct to operate on
     * @param period The oracle version period to settle for
     * @param params The current set of market parameters
     * @return accumulatedVersion The resulting version after accumulation
     * @return accumulatedFee The fee accrued from opening or closing a new position
     * @return settled Whether the pre position should be cleared
     */
    function accumulate(
        Version memory self,
        PrePosition memory pre,
        Period memory period,
        AccumulatorParams memory params
    ) internal pure returns (Version memory accumulatedVersion, UFixed18 accumulatedFee, bool settled) {
        Position memory latestPosition = self.position();

        // accumulate funding
        Accumulator memory accumulatedPosition;
        (accumulatedPosition, accumulatedFee) =
            _accumulateFunding(params.funding, latestPosition, period, params.utilizationCurve, params.closed);

        // accumulate position
        accumulatedPosition = accumulatedPosition.add(_accumulatePosition(latestPosition, period, params.closed));

        // accumulate share
        Accumulator memory accumulatedShare = _accumulateShare(latestPosition, period);

        // accumulate position
        Position memory newPosition;
        UFixed18 positionFee;
        (newPosition, positionFee, settled) = latestPosition.settled(pre, period.toVersion, params.maker, params.taker);
        accumulatedFee = accumulatedFee.add(positionFee);

        // save update
        accumulatedVersion = Version(
            self.value().add(accumulatedPosition).pack(),
            self.share().add(accumulatedShare).pack(),
            newPosition.pack()
        );
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
     * @return accumulatedFunding The total amount accumulated from funding
     * @return accumulatedFee The total fee accrued from funding accumulation
     */
    function _accumulateFunding(
        UFixed18 fundingFee,
        Position memory latestPosition,
        Period memory period,
        JumpRateUtilizationCurve memory utilizationCurve,
        bool closed
    ) private pure returns (Accumulator memory accumulatedFunding, UFixed18 accumulatedFee) {
        if (closed) return (Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO), UFixed18Lib.ZERO);
        if (latestPosition.taker.isZero()) return (Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO), UFixed18Lib.ZERO);
        if (latestPosition.maker.isZero()) return (Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO), UFixed18Lib.ZERO);

        UFixed18 takerNotional = Fixed18Lib.from(latestPosition.taker).mul(period.fromVersion.price).abs();
        UFixed18 socializedNotional = takerNotional.mul(latestPosition.socializationFactor());

        Fixed18 rateAccumulated = utilizationCurve.compute(latestPosition.utilization())
            .mul(Fixed18Lib.from(period.timestampDelta()))
            .div(Fixed18Lib.from(365 days));
        Fixed18 fundingAccumulated = rateAccumulated.mul(Fixed18Lib.from(socializedNotional));
        accumulatedFee = fundingAccumulated.abs().mul(fundingFee);

        Fixed18 fundingAccumulatedWithoutFee = Fixed18Lib.from(
            fundingAccumulated.sign(),
            fundingAccumulated.abs().sub(accumulatedFee)
        );

        bool makerPaysFunding = fundingAccumulated.sign() < 0;
        accumulatedFunding.maker = (makerPaysFunding ? fundingAccumulated : fundingAccumulatedWithoutFee)
            .div(Fixed18Lib.from(latestPosition.maker));
        accumulatedFunding.taker = (makerPaysFunding ? fundingAccumulatedWithoutFee : fundingAccumulated)
            .div(Fixed18Lib.from(latestPosition.taker)).mul(Fixed18Lib.NEG_ONE);
    }

    /**
     * @notice Globally accumulates position PNL since last oracle update
     * @param latestPosition The latest global position
     * @param period The oracle version period to settle for
     * @param closed Whether the product is closed
     * @return accumulatedPosition The total amount accumulated from position PNL
     */
    function _accumulatePosition(
        Position memory latestPosition,
        Period memory period,
        bool closed
    ) private pure returns (Accumulator memory accumulatedPosition) {
        if (closed) return Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO);
        if (latestPosition.taker.isZero()) return Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO);
        if (latestPosition.maker.isZero()) return Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO);

        Fixed18 totalTakerDelta = period.priceDelta().mul(Fixed18Lib.from(latestPosition.taker));
        Fixed18 socializedTakerDelta = totalTakerDelta.mul(Fixed18Lib.from(latestPosition.socializationFactor()));

        accumulatedPosition.maker = socializedTakerDelta.div(Fixed18Lib.from(latestPosition.maker)).mul(Fixed18Lib.NEG_ONE);
        accumulatedPosition.taker = socializedTakerDelta.div(Fixed18Lib.from(latestPosition.taker));
    }

    /**
     * @notice Globally accumulates position's share of the total market since last oracle update
     * @dev This is used to compute incentivization rewards based on market participation
     * @param latestPosition The latest global position
     * @param period The oracle version period to settle for
     * @return accumulatedShare The total share amount accumulated per position
     */
    function _accumulateShare(
        Position memory latestPosition,
        Period memory period
    ) private pure returns (Accumulator memory accumulatedShare) {
        uint256 elapsed = period.toVersion.timestamp - period.fromVersion.timestamp;

        accumulatedShare.maker = latestPosition.maker.isZero() ?
            Fixed18Lib.ZERO :
            Fixed18Lib.from(UFixed18Lib.from(elapsed).div(latestPosition.maker));
        accumulatedShare.taker = latestPosition.taker.isZero() ?
            Fixed18Lib.ZERO :
            Fixed18Lib.from(UFixed18Lib.from(elapsed).div(latestPosition.taker));
    }
}
