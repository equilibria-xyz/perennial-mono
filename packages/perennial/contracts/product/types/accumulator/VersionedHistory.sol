// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "../../../interfaces/IProduct.sol";
import "../../../interfaces/types/Accumulator.sol";

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
     * @notice Settles the global state for the period from `latestOracleVersion` to `toOracleVersion`
     * @param self The struct to operate on
     * @param latestOracleVersion The latest settled oracle version
     * @param toOracleVersion The oracle version to settle to
     * @param fundingFee The funding fee parameter
     * @return accumulatedFee The fee accrued from opening or closing a new position
     */
    function settle(
        VersionedHistory storage self,
        IOracleProvider.OracleVersion memory latestOracleVersion,
        IOracleProvider.OracleVersion memory toOracleVersion,
        UFixed18 fundingFee
    ) internal returns (UFixed18 accumulatedFee) {
        Position memory latestPosition = positionAtVersion(self, latestOracleVersion.version);

        // accumulate funding
        Accumulator memory accumulatedPosition;
        (accumulatedPosition, accumulatedFee) =
            _accumulateFunding(fundingFee, latestPosition, latestOracleVersion, toOracleVersion);

        // accumulate position
        accumulatedPosition = accumulatedPosition.add(
            _accumulatePosition(latestPosition, latestOracleVersion, toOracleVersion));

        // accumulate share
        Accumulator memory accumulatedShare =
            _accumulateShare(latestPosition, latestOracleVersion, toOracleVersion);

        // accumulate position
        (Position memory newPosition, UFixed18 positionFee, bool settled) =
            latestPosition.settled(self.pre, toOracleVersion);
        accumulatedFee = accumulatedFee.add(positionFee);
        if (settled) delete self.pre;

        // save update
        self._valueAtVersion[toOracleVersion.version] = valueAtVersion(self, latestOracleVersion.version)
            .add(accumulatedPosition)
            .pack();
        self._shareAtVersion[toOracleVersion.version] = shareAtVersion(self, latestOracleVersion.version)
            .add(accumulatedShare)
            .pack();
        self._positionAtVersion[toOracleVersion.version] = newPosition.pack();
        
        return positionFee;
    }

    /**
     * @notice Globally accumulates all funding since last oracle update
     * @dev If an oracle version is skipped due to no pre positions, funding will continue to be
     *      pegged to the price of the last snapshotted oracleVersion until a new one is accumulated.
     *      This is an acceptable approximation.
     * @param fundingFee The funding fee rate for the product
     * @param latestPosition The latest global position
     * @param latestOracleVersion The oracle version to accumulate from
     * @param toOracleVersion The oracle version to accumulate to
     * @return accumulatedFunding The total amount accumulated from funding
     * @return accumulatedFee The total fee accrued from funding accumulation
     */
    function _accumulateFunding(
        UFixed18 fundingFee,
        Position memory latestPosition,
        IOracleProvider.OracleVersion memory latestOracleVersion,
        IOracleProvider.OracleVersion memory toOracleVersion
    ) private view returns (Accumulator memory accumulatedFunding, UFixed18 accumulatedFee) {
        if (_product().closed()) return (Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO), UFixed18Lib.ZERO);
        if (latestPosition.taker.isZero()) return (Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO), UFixed18Lib.ZERO);
        if (latestPosition.maker.isZero()) return (Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO), UFixed18Lib.ZERO);

        uint256 elapsed = toOracleVersion.timestamp - latestOracleVersion.timestamp;

        UFixed18 takerNotional = Fixed18Lib.from(latestPosition.taker).mul(latestOracleVersion.price).abs();
        UFixed18 socializedNotional = takerNotional.mul(latestPosition.socializationFactor());

        Fixed18 rateAccumulated = _product().rate(latestPosition)
            .mul(Fixed18Lib.from(UFixed18Lib.from(elapsed)));
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
     * @param latestOracleVersion The oracle version to accumulate from
     * @param toOracleVersion The oracle version to accumulate to
     * @return accumulatedPosition The total amount accumulated from position PNL
     */
    function _accumulatePosition(
        Position memory latestPosition,
        IOracleProvider.OracleVersion memory latestOracleVersion,
        IOracleProvider.OracleVersion memory toOracleVersion
    ) private view returns (Accumulator memory accumulatedPosition) {
        if (_product().closed()) return Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO);
        if (latestPosition.taker.isZero()) return Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO);
        if (latestPosition.maker.isZero()) return Accumulator(Fixed18Lib.ZERO, Fixed18Lib.ZERO);

        Fixed18 oracleDelta = toOracleVersion.price.sub(latestOracleVersion.price);
        Fixed18 totalTakerDelta = oracleDelta.mul(Fixed18Lib.from(latestPosition.taker));
        Fixed18 socializedTakerDelta = totalTakerDelta.mul(Fixed18Lib.from(latestPosition.socializationFactor()));

        accumulatedPosition.maker = socializedTakerDelta.div(Fixed18Lib.from(latestPosition.maker)).mul(Fixed18Lib.NEG_ONE);
        accumulatedPosition.taker = socializedTakerDelta.div(Fixed18Lib.from(latestPosition.taker));
    }

    /**
     * @notice Globally accumulates position's share of the total market since last oracle update
     * @dev This is used to compute incentivization rewards based on market participation
     * @param latestPosition The latest global position
     * @param latestOracleVersion The oracle version to accumulate from
     * @param toOracleVersion The oracle version to accumulate to
     * @return accumulatedShare The total share amount accumulated per position
     */
    function _accumulateShare(
        Position memory latestPosition,
        IOracleProvider.OracleVersion memory latestOracleVersion,
        IOracleProvider.OracleVersion memory toOracleVersion
    ) private pure returns (Accumulator memory accumulatedShare) {
        uint256 elapsed = toOracleVersion.timestamp - latestOracleVersion.timestamp;

        accumulatedShare.maker = latestPosition.maker.isZero() ?
            Fixed18Lib.ZERO :
            Fixed18Lib.from(UFixed18Lib.from(elapsed).div(latestPosition.maker));
        accumulatedShare.taker = latestPosition.taker.isZero() ?
            Fixed18Lib.ZERO :
            Fixed18Lib.from(UFixed18Lib.from(elapsed).div(latestPosition.taker));
    }

    function _product() private view returns (IProduct) { //TODO take in anywhere this is read
        return IProduct(address(this));
    }
}
