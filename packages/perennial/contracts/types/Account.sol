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
    Fixed6 position; // 6 decimals
    Fixed6 next; // 6 decimals
    Fixed6 collateral; // 6 decimals
    UFixed6 reward; // 6 decimals
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
        Fixed6 newPosition,
        Fixed6 newCollateral,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (
        Fixed6 makerAmount,
        Fixed6 takerAmount,
        UFixed6 makerFee,
        UFixed6 takerFee,
        Fixed6 collateralAmount
    ) {
        // compute position update
        (Fixed6 currentMaker, Fixed6 currentTaker) = _splitPosition(self.next);
        (Fixed6 nextMaker, Fixed6 nextTaker) = _splitPosition(newPosition);
        (makerAmount, takerAmount) = (nextMaker.sub(currentMaker), nextTaker.sub(currentTaker));

        // compute collateral update
        (makerFee, takerFee) = (
            makerAmount.mul(currentOracleVersion.price).abs().mul(marketParameter.makerFee),
            takerAmount.mul(currentOracleVersion.price).abs().mul(marketParameter.takerFee)
        );
        collateralAmount = newCollateral.sub(self.collateral).sub(Fixed6Lib.from(makerFee.add(takerFee)));

        // update position
        self.next = newPosition;
        self.collateral = newCollateral;
    }

    function _splitPosition(Fixed6 newPosition) private pure returns (Fixed6, Fixed6) {
        return (newPosition.min(Fixed6Lib.ZERO).mul(Fixed6Lib.NEG_ONE), newPosition.max(Fixed6Lib.ZERO));
    }

    /**
     * @notice Settled the account's position to oracle version `toOracleVersion`
     * @param self The struct to operate on
     */
    function accumulate(Account memory self, Version memory fromVersion, Version memory toVersion) internal pure {
        Fixed6 valueDelta = (self.position.sign() == 1)
            ? toVersion.value().taker.sub(fromVersion.value().taker)
            : toVersion.value().maker.sub(fromVersion.value().maker);
        Fixed6 rewardDelta = (self.position.sign() == 1)
            ? toVersion.reward().taker.sub(fromVersion.reward().taker)
            : toVersion.reward().maker.sub(fromVersion.reward().maker);

        self.collateral = self.collateral.add(Fixed6Lib.from(self.position.abs()).mul(valueDelta));
        self.reward = self.reward.add(self.position.abs().mul(UFixed6Lib.from(rewardDelta)));
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
        UFixed6 maintenanceRatio
    ) internal pure returns (UFixed6) {
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
        UFixed6 maintenanceRatio
    ) internal pure returns (UFixed6) {
        return _maintenance(self.next, currentOracleVersion, maintenanceRatio);
    }

    /**
     * @notice Returns the maintenance requirement for a given `position`
     * @dev Internal helper
     * @param _position The position to compete the maintenance requirement for
     * @return Next maintenance requirement for the account
     */
    function _maintenance(
        Fixed6 _position,
        OracleVersion memory currentOracleVersion,
        UFixed6 maintenanceRatio
    ) private pure returns (UFixed6) {
        return _position.mul(currentOracleVersion.price).abs().mul(maintenanceRatio);
    }
}

library StoredAccountStorageLib {
    uint64 constant LIQUIDATION_MASK = uint64(1 << 63);

    function read(StoredAccountStorage storage self) internal view returns (Account memory) {
        StoredAccount memory storedValue =  self.value;
        return Account(
            Fixed6.wrap(int256(storedValue._position)),
            Fixed6.wrap(int256(storedValue._next)),
            Fixed6.wrap(int256(storedValue._collateral)),
            UFixed6.wrap(uint256(storedValue._liquidationAndReward & ~LIQUIDATION_MASK)),
            bool(storedValue._liquidationAndReward & LIQUIDATION_MASK != 0)
        );
    }

    function store(StoredAccountStorage storage self, Account memory newValue) internal {
        //TODO: validation on bounds
        self.value = StoredAccount(
            int64(Fixed6.unwrap(newValue.position)),
            int64(Fixed6.unwrap(newValue.next)),
            int64(Fixed6.unwrap(newValue.collateral)),
            uint64((UFixed6.unwrap(newValue.reward)) | (uint64(newValue.liquidation ? 1 : 0) << 63))
        );
    }
}