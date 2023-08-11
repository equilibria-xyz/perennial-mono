// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../../../interfaces/IProduct.sol";
import "../../../interfaces/types/Accumulator.sol";
import "../position/VersionedPosition.sol";

/// @dev VersionedAccumulator type
struct VersionedAccumulator {
    /// @dev Latest synced oracle version
    uint256 latestVersion;

    /// @dev Mapping of accumulator value at each settled oracle version
    mapping(uint256 => PackedAccumulator) _valueAtVersion;

    /// @dev Mapping of accumulator share at each settled oracle version
    mapping(uint256 => PackedAccumulator) _shareAtVersion;
}
using VersionedAccumulatorLib for VersionedAccumulator global;

/**
 * @title VersionedAccumulatorLib
 * @notice Library that manages global versioned accumulator state.
 * @dev Manages two accumulators: value and share. The value accumulator measures the change in position value
 *      over time. The share accumulator measures the change in liquidity ownership over time (for tracking
 *      incentivization rewards).
 *
 *      Both accumulators are stamped for historical lookup anytime there is a global settlement, which services
 *      the delayed-position accounting. It is not guaranteed that every version will have a value stamped, but
 *      only versions when a settlement occurred are needed for this historical computation.
 */
library VersionedAccumulatorLib {
    event FundingAccumulated(uint256 latestVersion, uint256 toVersion, Accumulator value, UFixed18 fee);
    event PositionAccumulated(uint256 latestVersion, uint256 toVersion, Accumulator value);
    event PositionFeeAccumulated(uint256 latestVersion, uint256 toVersion, Accumulator value, UFixed18 fee);

    /**
     * @notice Returns the stamped value accumulator at `oracleVersion`
     * @param self The struct to operate on
     * @param oracleVersion The oracle version to retrieve the value at
     * @return The stamped value accumulator at the requested version
     */
    function valueAtVersion(VersionedAccumulator storage self, uint256 oracleVersion) internal view returns (Accumulator memory) {
        return self._valueAtVersion[oracleVersion].unpack();
    }

    /**
     * @notice Returns the stamped share accumulator at `oracleVersion`
     * @param self The struct to operate on
     * @param oracleVersion The oracle version to retrieve the share at
     * @return The stamped share accumulator at the requested version
     */
    function shareAtVersion(VersionedAccumulator storage self, uint256 oracleVersion) internal view returns (Accumulator memory) {
        return self._shareAtVersion[oracleVersion].unpack();
    }

    /**
     * @notice Globally accumulates all value (position + funding) and share since last oracle update
     * @param self The struct to operate on
     * @param fundingFee The funding fee rate for the product
     * @param position Pointer to global position
     * @param latestOracleVersion The oracle version to accumulate from
     * @param toOracleVersion The oracle version to accumulate to
     * @return accumulatedFee The total fee accrued from accumulation
     */
    function accumulate(
        VersionedAccumulator storage self,
        UFixed18 fundingFee,
        VersionedPosition storage position,
        IOracleProvider.OracleVersion memory latestOracleVersion,
        IOracleProvider.OracleVersion memory toOracleVersion
    ) internal returns (UFixed18 accumulatedFee) {
        Position memory latestPosition = position.positionAtVersion(latestOracleVersion.version);

        // accumulate funding
        Accumulator memory accumulatedPosition;
        (Accumulator memory accumulatedFunding, UFixed18 protocolFundingFee) =
            _accumulateFunding(fundingFee, latestPosition, latestOracleVersion, toOracleVersion);
        (accumulatedPosition, accumulatedFee) =
            (accumulatedPosition.add(accumulatedFunding), accumulatedFee.add(protocolFundingFee));

        // accumulate position
        Accumulator memory accumulatedPositionPnl = _accumulatePosition(latestPosition, latestOracleVersion, toOracleVersion);
        accumulatedPosition = accumulatedPosition.add(accumulatedPositionPnl);


        // accumulate position fee
        (Accumulator memory accumulatedPositionFee, UFixed18 protocolPositionFee) =
            _accumulatePositionFee(latestPosition, position.pre, latestOracleVersion);
        (accumulatedPosition, accumulatedFee) =
            (accumulatedPosition.add(accumulatedPositionFee), accumulatedFee.add(protocolPositionFee));

        // accumulate share
        Accumulator memory accumulatedShare =
            _accumulateShare(latestPosition, latestOracleVersion, toOracleVersion);

        // save update
        self._valueAtVersion[toOracleVersion.version] = valueAtVersion(self, latestOracleVersion.version)
            .add(accumulatedPosition)
            .pack();
        self._shareAtVersion[toOracleVersion.version] = shareAtVersion(self, latestOracleVersion.version)
            .add(accumulatedShare)
            .pack();
        self.latestVersion = toOracleVersion.version;

        emit FundingAccumulated(latestOracleVersion.version, toOracleVersion.version, accumulatedFunding, protocolFundingFee);
        emit PositionAccumulated(latestOracleVersion.version, toOracleVersion.version, accumulatedPositionPnl);
        emit PositionFeeAccumulated(latestOracleVersion.version, toOracleVersion.version, accumulatedPositionFee, protocolPositionFee);
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
        if (_product().closed() || latestPosition.taker.isZero() || latestPosition.maker.isZero())
            return (accumulatedFunding, accumulatedFee);

        uint256 elapsed = toOracleVersion.timestamp - latestOracleVersion.timestamp;

        UFixed18 takerNotional = latestPosition.taker.mul(latestOracleVersion.price.abs());
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
        if (_product().closed() || latestPosition.taker.isZero() || latestPosition.maker.isZero())
            return accumulatedPosition;

        Fixed18 oracleDelta = toOracleVersion.price.sub(latestOracleVersion.price);
        Fixed18 totalTakerDelta = oracleDelta.mul(Fixed18Lib.from(latestPosition.taker));
        Fixed18 socializedTakerDelta = totalTakerDelta.mul(Fixed18Lib.from(latestPosition.socializationFactor()));

        accumulatedPosition.maker = socializedTakerDelta.div(Fixed18Lib.from(latestPosition.maker)).mul(Fixed18Lib.NEG_ONE);
        accumulatedPosition.taker = socializedTakerDelta.div(Fixed18Lib.from(latestPosition.taker));
    }

    /**
     * @notice Globally accumulates position fees since last oracle update
     * @dev Position fees are calculated based on the price at `latestOracleVersion` as that is the price used to
     *      calculate the user's fee total. In the event that settlement is occurring over multiple oracle versions
     *      (i.e. from a -> b -> c) it is safe to use the latestOracleVersion because in the a -> b case, a is always
     *      b - 1, and in the b -> c case the `PrePosition` is always empty so this is skipped.
     * @param latestPosition The latest global position
     * @param pre The global pre-position
     * @param latestOracleVersion The latest oracle version
     * @return accumulatedPosition The total amount accumulated from position PNL
     * @return fee The position fee that is retained by the protocol and product
     */
    function _accumulatePositionFee(
        Position memory latestPosition,
        PrePosition memory pre,
        IOracleProvider.OracleVersion memory latestOracleVersion
    ) private view returns (Accumulator memory accumulatedPosition, UFixed18 fee) {
        if (pre.isEmpty()) return (accumulatedPosition, fee);

        Position memory positionFee = pre.computeFee(latestOracleVersion);
        Position memory protocolFee = positionFee.mul(_product().positionFee());
        positionFee = positionFee.sub(protocolFee);
        fee = protocolFee.sum();

        // If there are makers to distribute the position fee to, distribute. Otherwise give it to the protocol
        if (!latestPosition.maker.isZero()) {
            accumulatedPosition.maker = Fixed18Lib.from(positionFee.sum().div(latestPosition.maker));
        } else {
            fee = fee.add(positionFee.sum());
        }
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

    function _product() private view returns (IProduct) {
        return IProduct(address(this));
    }
}
