// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./Version.sol";

/// @dev Account type
struct StoredAccount {
    int64 _position; // 6 decimals
    int64 _next; // 6 decimals
    int64 _collateral; // 6 decimals
    uint64 _liquidationAndReward; // 6 decimals
}
struct StoredAccountStorage { StoredAccount value; }
using StoredAccountStorageLib for StoredAccountStorage global;
struct Account {
    Fixed18 position; // 6 decimals
    Fixed18 next; // 6 decimals
    Fixed18 collateral; // 6 decimals
    UFixed18 reward; // 6 decimals
    bool liquidation;
}
using AccountLib for Account global;

/**
 * @title AccountLib
 * @notice Library that manages an account-level position.
 */
library AccountLib {
    function update(
        Account memory self,
        Fixed18 newPosition,
        Fixed18 newCollateral,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (
        Fixed18 makerAmount,
        Fixed18 takerAmount,
        UFixed18 makerFee,
        UFixed18 takerFee,
        Fixed18 collateralAmount
    ) {
        // compute position update
        (Fixed18 currentMaker, Fixed18 currentTaker) = _splitPosition(self.next);
        (Fixed18 nextMaker, Fixed18 nextTaker) = _splitPosition(newPosition);
        (makerAmount, takerAmount) = (nextMaker.sub(currentMaker), nextTaker.sub(currentTaker));

        // compute collateral update
        (makerFee, takerFee) = (
            makerAmount.mul(currentOracleVersion.price).abs().mul(marketParameter.makerFee),
            takerAmount.mul(currentOracleVersion.price).abs().mul(marketParameter.takerFee)
        );
        collateralAmount = newCollateral.sub(self.collateral).sub(Fixed18Lib.from(makerFee.add(takerFee)));

        // update position
        self.next = newPosition;
        self.collateral = newCollateral;
    }

    function _splitPosition(Fixed18 newPosition) private pure returns (Fixed18, Fixed18) {
        return (newPosition.min(Fixed18Lib.ZERO).mul(Fixed18Lib.NEG_ONE), newPosition.max(Fixed18Lib.ZERO));
    }

    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param self The struct to operate on
     */
    function accumulate(Account memory self, Version memory fromVersion, Version memory toVersion) internal pure {
        Fixed18 valueDelta = (self.position.sign() == 1)
            ? toVersion.value().taker.sub(fromVersion.value().taker)
            : toVersion.value().maker.sub(fromVersion.value().maker);
        Fixed18 rewardDelta = (self.position.sign() == 1)
            ? toVersion.reward().taker.sub(fromVersion.reward().taker)
            : toVersion.reward().maker.sub(fromVersion.reward().maker);

        self.collateral = self.collateral.add(Fixed18Lib.from(self.position.abs()).mul(valueDelta));
        self.reward = self.reward.add(self.position.abs().mul(UFixed18Lib.from(rewardDelta)));
        self.position = self.next;
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
        OracleVersion memory currentOracleVersion,
        UFixed18 maintenanceRatio
    ) internal pure returns (UFixed18) {
        return _maintenance(self.next, currentOracleVersion, maintenanceRatio);
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
        return _position.mul(currentOracleVersion.price).abs().mul(maintenanceRatio);
    }
}

library StoredAccountStorageLib {
    uint64 constant LIQUIDATION_MASK = uint64(1 << 63);

    function read(StoredAccountStorage storage self) internal view returns (Account memory) {
        StoredAccount memory storedValue =  self.value;
        return Account(
            Fixed18.wrap(int256(storedValue._position) * 1e12),
            Fixed18.wrap(int256(storedValue._next) * 1e12),
            Fixed18.wrap(int256(storedValue._collateral) * 1e12),
            UFixed18.wrap(uint256(storedValue._liquidationAndReward & ~LIQUIDATION_MASK) * 1e12),
            bool(storedValue._liquidationAndReward & LIQUIDATION_MASK != 0)
        );
    }

    function store(StoredAccountStorage storage self, Account memory newValue) internal {
        //TODO: validation on bounds
        self.value = StoredAccount(
            int64(Fixed18.unwrap(newValue.position) / 1e12),
            int64(Fixed18.unwrap(newValue.next) / 1e12),
            int64(Fixed18.unwrap(newValue.collateral) / 1e12),
            uint64((UFixed18.unwrap(newValue.reward) / 1e12) | (uint64(newValue.liquidation ? 1 : 0) << 63))
        );
    }
}