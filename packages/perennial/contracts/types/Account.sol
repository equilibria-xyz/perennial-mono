// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./Version.sol";

/// @dev Account type
struct Account {
    int64 _position; // 6 decimals

    int64 _next; // 6 decimals

    int64 _collateral; // 6 decimals

    uint64 _reward; // 6 decimals
}
using AccountLib for Account global;

/**
 * @title AccountLib
 * @notice Library that manages an account-level position.
 */
library AccountLib {
    function update(
        Account memory account,
        Fixed18 newPosition,
        Fixed18 newCollateral,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (Fixed18 makerAmount, Fixed18 takerAmount, Fixed18 collateralAmount) {
        // compute position update
        (Fixed18 currentMaker, Fixed18 currentTaker) = _splitPosition(next(account));
        (Fixed18 nextMaker, Fixed18 nextTaker) = _splitPosition(newPosition);
        (makerAmount, takerAmount, collateralAmount) = //TODO: rounding errors here
            (nextMaker.sub(currentMaker), nextTaker.sub(currentTaker), newCollateral.sub(collateral(account)));

        // compute collateral update
        collateralAmount = collateralAmount
            .sub(Fixed18Lib.from(makerAmount.mul(currentOracleVersion.price).abs().mul(marketParameter.makerFee)))
            .sub(Fixed18Lib.from(takerAmount.mul(currentOracleVersion.price).abs().mul(marketParameter.takerFee)));

        // update position
        account._next = int64(Fixed18.unwrap(newPosition) / 1e12);
        account._collateral = int64(Fixed18.unwrap(newCollateral) / 1e12);
    }

    function _splitPosition(Fixed18 newPosition) private pure returns (Fixed18, Fixed18) {
        return (newPosition.min(Fixed18Lib.ZERO).mul(Fixed18Lib.NEG_ONE), newPosition.max(Fixed18Lib.ZERO));
    }

    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param account The struct to operate on
     */
    function accumulate(
        Account memory account,
        Version memory fromVersion,
        Version memory toVersion
    ) internal pure {
        Fixed18 _position = position(account);
        Fixed18 valueDelta = (_position.sign() == 1)
            ? toVersion.value().taker().sub(fromVersion.value().taker())
            : toVersion.value().maker().sub(fromVersion.value().maker());
        Fixed18 rewardDelta = (_position.sign() == 1)
            ? toVersion.reward().taker().sub(fromVersion.reward().taker())
            : toVersion.reward().maker().sub(fromVersion.reward().maker());

        account._position = account._next;
        account._collateral += int64(Fixed18.unwrap(Fixed18Lib.from(_position.abs()).mul(valueDelta)) / 1e12);
        account._reward += uint64(UFixed18.unwrap(_position.abs().mul(UFixed18Lib.from(rewardDelta))) / 1e12);
    }

    /**
     * @notice Returns the current maintenance requirement for the account
     * @dev Must be called from a valid product to get the proper maintenance value
     * @param self The struct to operate on
     * @return Current maintenance requirement for the account
     */
    function maintenance(
        Account memory self,
        OracleVersion memory currentOracleVersion,
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
        OracleVersion memory currentOracleVersion,
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
        OracleVersion memory currentOracleVersion,
        UFixed18 maintenanceRatio
    ) private pure returns (UFixed18) {
        UFixed18 notionalMax = _position.mul(currentOracleVersion.price).abs();
        return notionalMax.mul(maintenanceRatio);
    }

    function position(Account memory self) internal pure returns (Fixed18) {
        return Fixed18.wrap(int256(self._position) * 1e12);
    }

    function next(Account memory self) internal pure returns (Fixed18) {
        return Fixed18.wrap(int256(self._next) * 1e12);
    }

    function collateral(Account memory self) internal pure returns (Fixed18) {
        return Fixed18.wrap(int256(self._collateral) * 1e12);
    }

    function reward(Account memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._reward) * 1e12);
    }
}
