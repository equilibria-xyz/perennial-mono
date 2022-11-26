// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../../interfaces/IProduct.sol";
import "../../interfaces/types/PrePosition.sol";
import "./Version.sol";

/// @dev Account type
struct Account {
    /// @dev The current settled position of the account
    PackedFixed18 _pre;

    /// @dev The current settled position of the account
    PackedFixed18 _position;
}
using AccountLib for Account global;

/**
 * @title AccountLib
 * @notice Library that manages an account-level position.
 */
library AccountLib {

    function update(Account memory account, Fixed18 amount) internal pure {
        account._pre = account._pre.unpack().add(amount).pack();
    }

    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param account The struct to operate on
     */
    function settle(Account memory account) internal pure {
        account._position = next(account).pack();
        account._pre = Fixed18Lib.ZERO.pack();
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
        Fixed18 _position = position(account);
        if (_position.sign() == 1) {
            newValueAccumulator = valueAccumulator.add(_position.mul(toVersion.value().taker.sub(fromVersion.value().taker)));
        } else {
            newValueAccumulator = valueAccumulator.add(_position.mul(toVersion.value().maker.sub(fromVersion.value().maker)));
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
        return _maintenance(position(self), currentOracleVersion, maintenanceRatio);
    }

    /**
     * @notice Returns the maintenance requirement after the next oracle version settlement
     * @dev Includes the current pending-settlement position delta, assumes no price change
     * @param self The struct to operate on
     * @return Next maintenance requirement for the account
     */
    function maintenanceNext(
        Account memory self,
        IOracleProvider.OracleVersion memory currentOracleVersion,
        UFixed18 maintenanceRatio
    ) internal pure returns (UFixed18) {
        return _maintenance(next(self), currentOracleVersion, maintenanceRatio);
    }

    /**
     * @notice Returns the maintenance requirement for a given `position`
     * @dev Internal helper
     * @param _position The position to compete the maintenance requirement for
     * @return Next maintenance requirement for the account
     */
    function _maintenance(
        Fixed18 _position,
        IOracleProvider.OracleVersion memory currentOracleVersion,
        UFixed18 maintenanceRatio
    ) private pure returns (UFixed18) {
        UFixed18 notionalMax = _position.mul(currentOracleVersion.price).abs();
        return notionalMax.mul(maintenanceRatio);
    }

    function pre(Account memory self) internal pure returns (Fixed18) {
        return self._pre.unpack();
    }

    function position(Account memory self) internal pure returns (Fixed18) {
        return self._position.unpack();
    }

    function next(Account memory self) internal pure returns (Fixed18) {
        return self._position.unpack().add(self._pre.unpack());
    }
}