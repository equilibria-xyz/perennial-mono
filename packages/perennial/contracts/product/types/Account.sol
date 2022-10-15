// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "../../interfaces/IProduct.sol";
import "../../interfaces/types/PrePosition.sol";
import "./Version.sol";

/// @dev Account type
struct Account {
    /// @dev The current settled position of the account
    Position position;

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
     * @param account The struct to operate on
     */
    function accumulateAndSettle(
        Account memory account,
        Fixed18 valueAccumulator,
        PrePosition memory pre,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure returns (Account memory newAccount, Fixed18 newValueAccumulator) {
        newValueAccumulator = valueAccumulator.add(account.position.mul(toVersion.value().sub(fromVersion.value())).sum());
        newAccount = Account(account.position.next(pre), false);
    }

    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param account The struct to operate on
     * @return newValueAccumulator The value accrued from settling the position
     */
    function accumulate(
        Account memory account,
        Fixed18 valueAccumulator,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure returns (Fixed18 newValueAccumulator) {
        newValueAccumulator = valueAccumulator.add(account.position.mul(toVersion.value().sub(fromVersion.value())).sum());
    }

    /**
     * @notice Returns the current maintenance requirement for the account
     * @dev Must be called from a valid product to get the proper maintenance value
     * @param self The struct to operate on
     * @return Current maintenance requirement for the account
     */
    function maintenance(
        Account memory self,
        IOracleProvider.OracleVersion memory currentOracleVersion,
        UFixed18 maintenanceRatio
    ) internal pure returns (UFixed18) {
        if (self.liquidation) return UFixed18Lib.ZERO;
        return _maintenance(self.position, currentOracleVersion, maintenanceRatio);
    }

    /**
     * @notice Returns the maintenance requirement after the next oracle version settlement
     * @dev Includes the current pending-settlement position delta, assumes no price change
     * @param self The struct to operate on
     * @return Next maintenance requirement for the account
     */
    function maintenanceNext(
        Account memory self,
        PrePosition memory pre,
        IOracleProvider.OracleVersion memory currentOracleVersion,
        UFixed18 maintenanceRatio
    ) internal pure returns (UFixed18) {
        return _maintenance(self.position.next(pre), currentOracleVersion, maintenanceRatio);
    }

    /**
     * @notice Returns the maintenance requirement for a given `position`
     * @dev Internal helper
     * @param position The position to compete the maintenance requirement for
     * @return Next maintenance requirement for the account
     */
    function _maintenance(
        Position memory position,
        IOracleProvider.OracleVersion memory currentOracleVersion,
        UFixed18 maintenanceRatio
    ) private pure returns (UFixed18) {
        Fixed18 oraclePrice = currentOracleVersion.price;
        UFixed18 notionalMax = Fixed18Lib.from(position.max()).mul(oraclePrice).abs();
        return notionalMax.mul(maintenanceRatio);
    }

    /**
     * @notice Returns whether an account has opened position on both sides of the market (maker vs taker)
     * @dev Used to verify the invariant that a single account can only have a position on one side of the
     *      market at a time
     * @param self The struct to operate on
     * @return Whether the account is currently doubled sided
     */
    function isDoubleSided(Account memory self, PrePosition memory pre) internal pure returns (bool) {
        bool makerEmpty = self.position.maker.isZero() && pre.openPosition.maker.isZero() && pre.closePosition.maker.isZero();
        bool takerEmpty = self.position.taker.isZero() && pre.openPosition.taker.isZero() && pre.closePosition.taker.isZero();

        return !makerEmpty && !takerEmpty;
    }

    /**
     * @notice Returns whether the account's pending-settlement delta closes more position than is open
     * @dev Used to verify the invariant that an account cannot settle into having a negative position
     * @param self The struct to operate on
     * @return Whether the account is currently over closed
     */
    function isOverClosed(Account memory self, PrePosition memory pre) internal pure returns (bool) {
        Position memory nextOpen = self.position.add(pre.openPosition);

        return  pre.closePosition.maker.gt(nextOpen.maker) || pre.closePosition.taker.gt(nextOpen.taker);
    }
}
