// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../../interfaces/IProduct.sol";
import "../../interfaces/types/PrePosition.sol";
import "./Version.sol";

/// @dev Account type
struct Account {
    /// @dev The current settled position of the account
    Fixed18 position;

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
        Fixed18 pre,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure returns (Fixed18 newValueAccumulator) {
        newValueAccumulator = accumulate(account, valueAccumulator, fromVersion, toVersion);
        account.position = account.position.add(pre);
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
        if (account.position.sign() == 1) {
            newValueAccumulator = valueAccumulator.add(account.position.mul(toVersion.value().taker.sub(fromVersion.value().taker)));
        } else {
            newValueAccumulator = valueAccumulator.add(account.position.mul(toVersion.value().maker.sub(fromVersion.value().maker)));
        }
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
        Fixed18 pre,
        IOracleProvider.OracleVersion memory currentOracleVersion,
        UFixed18 maintenanceRatio
    ) internal pure returns (UFixed18) {
        return _maintenance(self.position.add(pre), currentOracleVersion, maintenanceRatio);
    }

    /**
     * @notice Returns the maintenance requirement for a given `position`
     * @dev Internal helper
     * @param position The position to compete the maintenance requirement for
     * @return Next maintenance requirement for the account
     */
    function _maintenance(
        Fixed18 position,
        IOracleProvider.OracleVersion memory currentOracleVersion,
        UFixed18 maintenanceRatio
    ) private pure returns (UFixed18) {
        UFixed18 notionalMax = position.mul(currentOracleVersion.price).abs();
        return notionalMax.mul(maintenanceRatio);
    }
}
