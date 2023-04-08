//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/number/types/UFixed18.sol";
import "../../interfaces/IBalancedVaultDefinition.sol";

struct MarketVersion {
    UFixed18 longPosition;
    UFixed18 shortPosition;
    UFixed18 totalShares;
    UFixed18 longAssets;
    UFixed18 shortAssets;
    UFixed18 totalAssets;
}

struct VersionContext {
    uint256 market; //TODO: remove
    uint256 version;
    UFixed18 latestCollateral;
    UFixed18 latestShares;
}

/// @dev Accounting state for a long/short pair.
struct MarketAccount {
    /// @dev Mapping of shares of the vault per user
    mapping(address => UFixed18) balanceOf;

    /// @dev Total number of shares across all users
    UFixed18 totalSupply;

    /// @dev Mapping of unclaimed underlying of the vault per user
    mapping(address => UFixed18) unclaimed;

    /// @dev Total unclaimed underlying of the vault across all users
    UFixed18 totalUnclaimed;

    /// @dev Deposits that have not been settled, or have been settled but not yet processed by this contract
    UFixed18 deposit;

    /// @dev Redemptions that have not been settled, or have been settled but not yet processed by this contract
    UFixed18 redemption;

    /// @dev The latest version that a pending deposit or redemption has been placed
    uint256 latestVersion;

    /// @dev Mapping of pending (not yet converted to shares) per user
    mapping(address => UFixed18) deposits;

    /// @dev Mapping of pending (not yet withdrawn) per user
    mapping(address => UFixed18) redemptions;

    /// @dev Mapping of the latest version that a pending deposit or redemption has been placed per user
    mapping(address => uint256) latestVersions;

    /// @dev Mapping of versions of the vault state at a given oracle version
    mapping(uint256 => MarketVersion) versions;

    /// @dev For extending the struct without breaking storage
    uint256[20] __gap;
}
using MarketAccountLib for MarketAccount global;

library MarketAccountLib {
    /**
     * @notice Loads the context for the given `account`, settling the vault first
     * @param marketId Market ID
     * @param marketAccount The market account to operate on
     * @param marketDefinition The configuration of the market
     * @param account Account to load the context for
     * @return globalVersionContext global version context
     * @return accountVersionContext account version context
     */
    function loadContextForWrite(
        MarketAccount storage marketAccount,
        uint256 marketId,
        MarketDefinition memory marketDefinition,
        address account
    ) internal returns (VersionContext memory globalVersionContext, VersionContext memory accountVersionContext) {
        marketDefinition.long.settleAccount(address(this));
        marketDefinition.short.settleAccount(address(this));

        (globalVersionContext, accountVersionContext) =
            loadContextForRead(marketAccount, marketId, marketDefinition, account);
    }

    /**
     * @notice Loads the context for the given `account`
     * @param marketId Market ID
     * @param marketAccount The market account to operate on
     * @param marketDefinition The configuration of the market
     * @param account Account to load the context for
     * @return global version context
     * @return account version context
     */
    function loadContextForRead(
        MarketAccount storage marketAccount,
        uint256 marketId,
        MarketDefinition memory marketDefinition,
        address account
    ) internal view returns (VersionContext memory, VersionContext memory) {
        uint256 currentVersion = Math.min(marketDefinition.long.latestVersion(), marketDefinition.short.latestVersion());

        return (
            _buildVersionContext(marketAccount, marketId, marketDefinition, currentVersion, marketAccount.latestVersion),
            _buildVersionContext(marketAccount, marketId, marketDefinition, currentVersion, marketAccount.latestVersions[account])
        );
    }

    //TODO: natspec
    function _buildVersionContext(
        MarketAccount storage marketAccount,
        uint256 marketId,
        MarketDefinition memory marketDefinition,
        uint256 currentVersion,
        uint256 latestVersion
    ) private view returns (VersionContext memory) {
        return VersionContext(
            marketId,
            currentVersion,
            _assetsAt(marketAccount, marketDefinition, latestVersion),
            _sharesAt(marketAccount, latestVersion)
        );
    }

    /**
     * @notice Burns `amount` shares from `from`, adjusting totalSupply
     * @param marketAccount The market account to operate on
     * @param from Address to burn shares from
     * @param amount Amount of shares to burn
     */
    function burn(MarketAccount storage marketAccount, address from, UFixed18 amount) internal {
        marketAccount.balanceOf[from] = marketAccount.balanceOf[from].sub(amount);
        marketAccount.totalSupply = marketAccount.totalSupply.sub(amount);
    }

    /**
     * @notice Mints `amount` shares, adjusting totalSupply
     * @param marketAccount The market account to operate on
     * @param amount Amount of shares to mint
     */
    function delayedMint(MarketAccount storage marketAccount, UFixed18 amount) internal {
        marketAccount.totalSupply = marketAccount.totalSupply.add(amount);
    }

    /**
     * @notice Mints `amount` shares to `to`
     * @param marketAccount The market account to operate on
     * @param to Address to mint shares to
     * @param amount Amount of shares to mint
     */
    function delayedMintAccount(MarketAccount storage marketAccount, address to, UFixed18 amount) internal {
        marketAccount.balanceOf[to] = marketAccount.balanceOf[to].add(amount);
    }

    /**
     * @notice The total assets at the given version
     * @dev Calculates and adds accumulated PnL for `version` + 1
     * @param marketAccount The market account to operate on
     * @param marketDefinition The configuration of the market
     * @param version Version to get total assets at
     * @return Total assets in the vault at the given version
     */
    function _assetsAt(
        MarketAccount storage marketAccount,
        MarketDefinition memory marketDefinition,
        uint256 version
    ) private view returns (UFixed18) {
        MarketVersion memory marketVersion = marketAccount.versions[version];

        // accumulate value from version n + 1
        (Fixed18 longAccumulated, Fixed18 shortAccumulated) = (
            marketDefinition.long.valueAtVersion(version + 1).maker
                .sub(marketDefinition.long.valueAtVersion(version).maker)
                .mul(Fixed18Lib.from(marketVersion.longPosition)),
            marketDefinition.short.valueAtVersion(version + 1).maker
                .sub(marketDefinition.short.valueAtVersion(version).maker)
                .mul(Fixed18Lib.from(marketVersion.shortPosition))
        );

        // collateral can't go negative on a product
        longAccumulated = longAccumulated.max(Fixed18Lib.from(marketVersion.longAssets).mul(Fixed18Lib.NEG_ONE));
        shortAccumulated = shortAccumulated.max(Fixed18Lib.from(marketVersion.shortAssets).mul(Fixed18Lib.NEG_ONE));

        // collateral can't go negative within the vault, socializes into unclaimed if triggered
        return UFixed18Lib.from(
            Fixed18Lib.from(marketVersion.totalAssets).add(longAccumulated).add(shortAccumulated).max(Fixed18Lib.ZERO)
        );
    }

    /**
     * @notice The total shares at the given version
     * @param marketAccount The market account to operate on
     * @param version Version to get total shares at
     * @return Total shares at `version`
     */
    function _sharesAt(MarketAccount storage marketAccount, uint256 version) private view returns (UFixed18) {
        return marketAccount.versions[version].totalShares;
    }
}
