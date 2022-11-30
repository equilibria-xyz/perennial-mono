// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../../interfaces/IProduct.sol";
import "../../interfaces/types/PrePosition.sol";
import "./Version.sol";

/// @dev Account type
struct Account {

    PackedFixed18 _pre;

    /// @dev The current settled position of the account
    PackedFixed18 _position;

    UFixed18 collateral;
}
using AccountLib for Account global;

/**
 * @title AccountLib
 * @notice Library that manages an account-level position.
 */
library AccountLib {
    error AccountShortfallError();

    function update(
        Account memory account,
        Fixed18 positionAmount,
        Fixed18 collateralAmount,
        IOracleProvider.OracleVersion memory currentOracleVersion,
        UFixed18 makerFee,
        UFixed18 takerFee
    ) internal pure returns (Fixed18 makerAmount, Fixed18 takerAmount) {
        // compute position update
        Fixed18 currentNext = next(account);
        (Fixed18 currentMaker, Fixed18 currentTaker) =
            (currentNext.min(Fixed18Lib.ZERO).mul(Fixed18Lib.NEG_ONE), currentNext.max(Fixed18Lib.ZERO));

        Fixed18 nextNext = currentNext.add(positionAmount);
        (Fixed18 nextMaker, Fixed18 nextTaker) =
            (nextNext.min(Fixed18Lib.ZERO).mul(Fixed18Lib.NEG_ONE), nextNext.max(Fixed18Lib.ZERO));

        (makerAmount, takerAmount) = (nextMaker.sub(currentMaker), nextTaker.sub(currentTaker));

        // compute collateral update
        collateralAmount = collateralAmount
            .sub(Fixed18Lib.from(makerAmount.mul(currentOracleVersion.price).abs().mul(makerFee)))
            .sub(Fixed18Lib.from(takerAmount.mul(currentOracleVersion.price).abs().mul(takerFee)));

        // update collateral
        UFixed18 shortfall = settleCollateral(account, UFixed18Lib.ZERO, collateralAmount);
        if (!shortfall.isZero()) revert AccountShortfallError();

        // update position
        account._pre = account._pre.unpack().add(positionAmount).pack();
    }

    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param account The struct to operate on
     * @return newShortfallAccumulator The value accrued from settling the position
     */
    function accumulate(
        Account memory account,
        UFixed18 shortfallAccumulator,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure returns (UFixed18 newShortfallAccumulator) {
        Fixed18 _position = position(account);
        Fixed18 versionDelta = (_position.sign() == 1)
            ? toVersion.value().taker.sub(fromVersion.value().taker)
            : toVersion.value().maker.sub(fromVersion.value().maker);
        newShortfallAccumulator = settleCollateral(account, shortfallAccumulator, _position.mul(versionDelta));

        account._position = next(account).pack();
        account._pre = Fixed18Lib.ZERO.pack();
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

    /**
     * @notice Credits `account` with `amount` collateral
     * @dev Funds come from inside the product, not totals are updated
     *      Shortfall is created if more funds are debited from an account than exist
     * @param self The struct to operate on
     * @param amount Amount of collateral to credit
     * @return newShortfallAccumulator Any new shortfall incurred during this settlement
     */
    function settleCollateral(Account memory self, UFixed18 shortfallAccumulator, Fixed18 amount)
    internal pure returns (UFixed18 newShortfallAccumulator) {
        Fixed18 newBalance = Fixed18Lib.from(self.collateral).add(amount);

        newShortfallAccumulator = newBalance.min(Fixed18Lib.ZERO).abs().add(shortfallAccumulator);
        newBalance = newBalance.max(Fixed18Lib.ZERO);

        self.collateral = UFixed18Lib.from(newBalance);
    }
}
