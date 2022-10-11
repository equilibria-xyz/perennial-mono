// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "../../interfaces/IProduct.sol";
import "../../interfaces/types/PrePosition.sol";
import "./Version.sol";

/// @dev Account type
struct Account {
    /// @dev latest version that the account was synced too
    uint256 latestVersion;

    /// @dev The current settled position of the account
    Position position;

    /// @dev The current position delta pending-settlement
    PrePosition pre;

    /// @dev Whether the account is currently locked for liquidation
    bool liquidation;
}
using AccountLib for Account global;

/**
 * @title AccountLib
 * @notice Library that manages an account-level position.
 */
library AccountLib {
    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param self The struct to operate on
     * @param toOracleVersion The oracle version to accumulate to
     * @param makerFee The fee for opening or closing a maker position
     * @param takerFee The fee for opening or closing a taker position
     * @return positionFee The fee accrued from opening or closing a new position
     */
    function settle(
        Account storage self,
        IOracleProvider.OracleVersion memory toOracleVersion,
        UFixed18 makerFee,
        UFixed18 takerFee
    ) internal returns (UFixed18 positionFee) {
        bool settled;
        (self.position, positionFee, settled) = self.position.settled(self.pre, toOracleVersion, makerFee, takerFee);
        if (settled) {
            delete self.pre;
            self.liquidation = false;
        }
    }

    /**
     * @notice Syncs the account to oracle version `versionTo`
     * @param self The struct to operate on
     * @param versions Pointer to the global versions mapping
     * @param position Pointer to global position
     * @param versionTo Oracle version to sync account to
     * @return value The value accumulated sync last sync
     */
    function syncTo(
        Account storage self,
        mapping(uint256 => Version) storage versions,
        Account storage position,
        uint256 versionTo
    ) internal returns (Accumulator memory value) {
        value = position.position.mul(versions[versionTo].value().sub(versions[self.latestVersion].value()));
        self.latestVersion = versionTo;
    }

    /**
     * @notice Returns the current maintenance requirement for the account
     * @dev Must be called from a valid product to get the proper maintenance value
     * @param self The struct to operate on
     * @return Current maintenance requirement for the account
     */
    function maintenance(Account storage self) internal view returns (UFixed18) {
        if (self.liquidation) return UFixed18Lib.ZERO;
        return _maintenance(self.position);
    }

    /**
     * @notice Returns the maintenance requirement after the next oracle version settlement
     * @dev Includes the current pending-settlement position delta, assumes no price change
     * @param self The struct to operate on
     * @return Next maintenance requirement for the account
     */
    function maintenanceNext(Account storage self) internal view returns (UFixed18) {
        return _maintenance(self.position.next(self.pre));
    }

    /**
     * @notice Returns the maintenance requirement for a given `position`
     * @dev Internal helper
     * @param position The position to compete the maintenance requirement for
     * @return Next maintenance requirement for the account
     */
    function _maintenance(Position memory position) private view returns (UFixed18) {
        IProduct product = IProduct(address(this));
        Fixed18 oraclePrice = product.currentVersion().price;
        UFixed18 notionalMax = Fixed18Lib.from(position.max()).mul(oraclePrice).abs();
        return notionalMax.mul(product.maintenance());
    }

    /**
     * @notice Returns whether an account is completely closed, i.e. no position or pre-position
     * @param self The struct to operate on
     * @return Whether the account is closed
     */
    function isClosed(Account memory self) internal pure returns (bool) {
        return self.pre.isEmpty() && self.position.isEmpty();
    }

    /**
     * @notice Returns whether an account has opened position on both sides of the market (maker vs taker)
     * @dev Used to verify the invariant that a single account can only have a position on one side of the
     *      market at a time
     * @param self The struct to operate on
     * @return Whether the account is currently doubled sided
     */
    function isDoubleSided(Account storage self) internal view returns (bool) {
        bool makerEmpty = self.position.maker.isZero() && self.pre.openPosition.maker.isZero() && self.pre.closePosition.maker.isZero();
        bool takerEmpty = self.position.taker.isZero() && self.pre.openPosition.taker.isZero() && self.pre.closePosition.taker.isZero();

        return !makerEmpty && !takerEmpty;
    }

    /**
     * @notice Returns whether the account's pending-settlement delta closes more position than is open
     * @dev Used to verify the invariant that an account cannot settle into having a negative position
     * @param self The struct to operate on
     * @return Whether the account is currently over closed
     */
    function isOverClosed(Account storage self) internal view returns (bool) {
        Position memory nextOpen = self.position.add(self.pre.openPosition);

        return  self.pre.closePosition.maker.gt(nextOpen.maker) || self.pre.closePosition.taker.gt(nextOpen.taker);
    }
}
