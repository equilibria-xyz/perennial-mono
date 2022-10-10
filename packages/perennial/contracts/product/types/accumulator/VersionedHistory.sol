// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "../../../interfaces/IProduct.sol";
import "../../../interfaces/types/Accumulator.sol";
import "../Period.sol";

/// @dev VersionedHistory type
struct VersionedHistory {
    /// @dev Current global pending-settlement position delta
    PrePosition pre;

    /// @dev Mapping of accumulator value at each settled oracle version
    mapping(uint256 => PackedAccumulator) _valueAtVersion;

    /// @dev Mapping of accumulator share at each settled oracle version
    mapping(uint256 => PackedAccumulator) _shareAtVersion;
    
    /// @dev Mapping of global position at each version
    mapping(uint256 => PackedPosition) _positionAtVersion;
}
using VersionedHistoryLib for VersionedHistory global;

/**
 * @title VersionedHistoryLib
 * @notice Library that manages global versioned accumulator state.
 * @dev Manages two accumulators: value and share. The value accumulator measures the change in position value
 *      over time. The share accumulator measures the change in liquidity ownership over time (for tracking
 *      incentivization rewards).
 *
 *      Both accumulators are stamped for historical lookup anytime there is a global settlement, which services
 *      the delayed-position accounting. It is not guaranteed that every version will have a value stamped, but
 *      only versions when a settlement occurred are needed for this historical computation.
 */
library VersionedHistoryLib {
    /**
     * @notice Returns the stamped value accumulator at `oracleVersion`
     * @param self The struct to operate on
     * @param oracleVersion The oracle version to retrieve the value at
     * @return The stamped value accumulator at the requested version
     */
    function valueAtVersion(VersionedHistory storage self, uint256 oracleVersion) internal view returns (Accumulator memory) {
        return self._valueAtVersion[oracleVersion].unpack();
    }

    /**
     * @notice Returns the stamped share accumulator at `oracleVersion`
     * @param self The struct to operate on
     * @param oracleVersion The oracle version to retrieve the share at
     * @return The stamped share accumulator at the requested version
     */
    function shareAtVersion(VersionedHistory storage self, uint256 oracleVersion) internal view returns (Accumulator memory) {
        return self._shareAtVersion[oracleVersion].unpack();
    }

    /**
     * @notice Returns the current global position
     * @return Current global position
     */
    function positionAtVersion(VersionedHistory storage self, uint256 oracleVersion) internal view returns (Position memory) {
        return self._positionAtVersion[oracleVersion].unpack();
    }
    
    /**
     * @notice Settles the global state for the period from `period.fromVersion` to `period.toVersion`
     * @param self The struct to operate on
     * @param period The oracle version period to settle for
     * @param utilizationCurve The utilization curve for the funding computation
     * @param fundingFee The funding fee parameter
     * @param closed Whether the product is closed
     * @return accumulatedFee The fee accrued from opening or closing a new position
     */
    function settle(
        VersionedHistory storage self,
        Period memory period,
        JumpRateUtilizationCurve memory utilizationCurve,
        UFixed18 fundingFee,
        bool closed
    ) internal returns (UFixed18 accumulatedFee) {
        Position memory latestPosition = positionAtVersion(self, period.fromVersion.version);

        // accumulate funding
        Accumulator memory accumulatedPosition;
        (accumulatedPosition, accumulatedFee) =
            _accumulateFunding(fundingFee, latestPosition, period, utilizationCurve, closed);

        // accumulate position
        accumulatedPosition = accumulatedPosition.add(_accumulatePosition(latestPosition, period, closed));

        // accumulate share
        Accumulator memory accumulatedShare = _accumulateShare(latestPosition, period);

        // accumulate position
        (Position memory newPosition, UFixed18 positionFee, bool settled) =
            latestPosition.settled(self.pre, period.toVersion);
        accumulatedFee = accumulatedFee.add(positionFee);
        if (settled) delete self.pre;

        // save update
        self._valueAtVersion[period.toVersion.version] = valueAtVersion(self, period.fromVersion.version)
            .add(accumulatedPosition)
            .pack();
        self._shareAtVersion[period.toVersion.version] = shareAtVersion(self, period.fromVersion.version)
            .add(accumulatedShare)
            .pack();
        self._positionAtVersion[period.toVersion.version] = newPosition.pack();
        
        return positionFee;
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
