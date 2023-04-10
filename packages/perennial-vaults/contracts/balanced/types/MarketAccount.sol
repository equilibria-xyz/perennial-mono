//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/number/types/UFixed18.sol";
import "../../interfaces/IBalancedVaultDefinition.sol";

struct MarketEpoch {
    UFixed18 longPosition;
    UFixed18 shortPosition;
    UFixed18 __deprecated0__;
    UFixed18 longAssets;
    UFixed18 shortAssets;
    UFixed18 __deprecated1__;
}

/// @dev Accounting state for a long/short pair.
struct MarketAccount {
    /// @dev Mapping of versions of the vault state at a given oracle version
    mapping(uint256 => MarketEpoch) epochs;

    /// @dev Mapping of epoch of the vault to version of the market
    mapping(uint256 => uint256) versionOf;

    /// @dev For extending the struct without breaking storage
    uint256[20] __gap;
}
using MarketAccountLib for MarketAccount global;

library MarketAccountLib {
    /**
     * @notice The total assets at the given version
     * @dev Calculates and adds accumulated PnL for `version` + 1
     * @param marketAccount The market account to operate on
     * @param marketDefinition The configuration of the market
     * @param epoch Epoch to get total assets at
     * @return Total assets in the vault at the given version
     */
    function assetsAtEpoch(
        MarketAccount storage marketAccount,
        MarketDefinition memory marketDefinition,
        uint256 epoch
    ) internal view returns (UFixed18) {
        MarketEpoch memory marketEpoch = marketAccount.epochs[epoch];
        uint256 version = marketAccount.versionOf[epoch];

        // accumulate value from version n + 1
        (Fixed18 longAccumulated, Fixed18 shortAccumulated) = (
            marketDefinition.long.valueAtVersion(version + 1).maker
                .sub(marketDefinition.long.valueAtVersion(version).maker)
                .mul(Fixed18Lib.from(marketEpoch.longPosition)),
            marketDefinition.short.valueAtVersion(version + 1).maker
                .sub(marketDefinition.short.valueAtVersion(version).maker)
                .mul(Fixed18Lib.from(marketEpoch.shortPosition))
        );

        // collateral can't go negative on a product
        longAccumulated = longAccumulated.max(Fixed18Lib.from(marketEpoch.longAssets).mul(Fixed18Lib.NEG_ONE));
        shortAccumulated = shortAccumulated.max(Fixed18Lib.from(marketEpoch.shortAssets).mul(Fixed18Lib.NEG_ONE));

        // collateral can't go negative within the vault, socializes into unclaimed if triggered
        return UFixed18Lib.from(
            Fixed18Lib.from(marketEpoch.longAssets.add(marketEpoch.shortAssets))
                .add(longAccumulated)
                .add(shortAccumulated)
                .max(Fixed18Lib.ZERO)
        );
    }
}
