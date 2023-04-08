//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../interfaces/IBalancedVault.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./BalancedVaultDefinition.sol";
import "./types/MarketAccount.sol";
import "../PerennialLib.sol";

/**
 * @title BalancedVault
 * @notice ERC4626 vault that manages a 50-50 position between long-short markets of the same payoff on Perennial.
 * @dev Vault deploys and rebalances collateral between the corresponding long and short markets, while attempting to
 *      maintain `targetLeverage` with its open positions at any given time. Deposits are only gated in so much as to cap
 *      the maximum amount of assets in the vault.
 *
 *      The vault has a "delayed mint" mechanism for shares on deposit. After depositing to the vault, a user must wait
 *      until the next settlement of the underlying products in order for shares to be reflected in the getters.
 *      The shares will be fully reflected in contract state when the next settlement occurs on the vault itself.
 *      Similarly, when redeeming shares, underlying assets are not claimable until a settlement occurs.
 *      Each state changing interaction triggers the `settle` flywheel in order to bring the vault to the
 *      desired state.
 *      In the event that there is not a settlement for a long period of time, keepers can call the `sync` method to
 *      force settlement and rebalancing. This is most useful to prevent vault liquidation due to PnL changes
 *      causing the vault to be in an unhealthy state (far away from target leverage)
 */
contract BalancedVault is IBalancedVault, BalancedVaultDefinition, UInitializable {
    UFixed18 constant private TWO = UFixed18.wrap(2e18);

    /// @dev The name of the vault
    string public name;

    /// @dev Deprecated storage variable. Formerly `symbol`
    string private __unused0;

    /// @dev Deprecated storage variable. Formerly `allowance`
    uint256 private __unused1; // TODO: merge isApproved

    /// @dev Per-asset accounting state variables
    MarketAccount[100] marketAccounts;

    /// @dev Mapping of account => spender => whether spender is approved to spend account's shares
    mapping(address => mapping(address => bool)) public isApproved;

    constructor(
        Token18 asset_,
        IController controller_,
        UFixed18 targetLeverage_,
        UFixed18 maxCollateral_,
        MarketDefinition[1] memory marketDefinitions_
    )
    BalancedVaultDefinition(asset_, controller_, targetLeverage_, maxCollateral_, marketDefinitions_)
    { }

    /**
     * @notice Initializes the contract state
     * @param name_ ERC20 asset name
     */
    function initialize(string memory name_) external initializer(2) {
        name = name_;
        __unused0 = "";

        asset.approve(address(collateral));
    }

    /**
     * @notice Rebalances the collateral and position of the vault without a deposit or withdraw
     * @dev Should be called by a keeper when the vault approaches a liquidation state on either side
     */
    function sync() external {
        (VersionContext[] memory contexts, ) = _settle(address(0));
        _rebalance(contexts, UFixed18Lib.ZERO);
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `account` after the deposit settles.
     * @param assets The amount of assets to deposit
     * @param account The account to deposit on behalf of
     */
    function deposit(UFixed18 assets, address account) external {
        (VersionContext[] memory contexts, ) = _settle(account);
        if (assets.gt(_maxDepositAtVersion(contexts))) revert BalancedVaultDepositLimitExceeded();

        for (uint256 market = 0; market < contexts.length; ++market) {
            UFixed18 assetsToDeposit = assets.muldiv(markets(market).weight, totalWeight);

            marketAccounts[market].deposit = marketAccounts[market].deposit.add(assetsToDeposit);
            marketAccounts[market].latestVersion = contexts[market].version;
            marketAccounts[market].deposits[account] = marketAccounts[market].deposits[account].add(assetsToDeposit);
            marketAccounts[market].latestVersions[account] = contexts[market].version;

            emit Deposit(msg.sender, account, market, contexts[market].version, assets);
        }

        asset.pull(msg.sender, assets);

        _rebalance(contexts, UFixed18Lib.ZERO);
    }

    /**
     * @notice Redeems `proportion` of all shares from the vault
     * @dev Does not return any assets to the user due to delayed settlement. Use `claim` to claim assets
     *      If account is not msg.sender, requires prior spending approval
     * @param proportion The proportion of shares to redeem. Must be in [0, 1]
     * @param account The account to redeem on behalf of
     */
    function redeem(UFixed18 proportion, address account) external {
        if (proportion.gt(UFixed18Lib.ONE)) revert BalancedVaultRedemptionInvalidProportion();
        if (msg.sender != account && !isApproved[account][msg.sender]) revert BalancedVaultNotApproved();

        (VersionContext[] memory contexts, VersionContext[] memory accountContexts) = _settle(account);

        for (uint256 market = 0; market < totalMarkets; ++market) {
            UFixed18 shares = marketAccounts[market].balanceOf[account].mul(proportion);
            if (shares.gt(_maxRedeemAtVersion(contexts[market], accountContexts[market], account))) revert BalancedVaultRedemptionLimitExceeded();
            UFixed18 sharesToRedeem = shares.muldiv(markets(market).weight, totalWeight);

            marketAccounts[market].redemption = marketAccounts[market].redemption.add(sharesToRedeem);
            marketAccounts[market].latestVersion = contexts[market].version;
            marketAccounts[market].redemptions[account] = marketAccounts[market].redemptions[account].add(sharesToRedeem);
            marketAccounts[market].latestVersions[account] = contexts[market].version;
            marketAccounts[market].burn(account, shares);

            //TODO: emit event based on shares?

            emit Redemption(msg.sender, account, market, contexts[market].version, proportion);
        }

        _rebalance(contexts, UFixed18Lib.ZERO);
    }

    /**
     * @notice Claims all claimable assets for account, sending assets to account
     * @param account The account to claim for
     */
    function claim(address account) external {
        (VersionContext[] memory contexts, ) = _settle(account);

        UFixed18 claimAmount = UFixed18Lib.ZERO;
        UFixed18 unclaimedTotal = UFixed18Lib.ZERO;
        UFixed18 totalCollateral = UFixed18Lib.ZERO;
        for (uint256 market = 0; market < totalMarkets; ++market) {
            UFixed18 unclaimedAmount = marketAccounts[market].unclaimed[account];
            claimAmount = claimAmount.add(unclaimedAmount);
            UFixed18 unclaimedTotalForProduct = marketAccounts[market].totalUnclaimed;
            unclaimedTotal = unclaimedTotal.add(unclaimedTotalForProduct);
            marketAccounts[market].unclaimed[account] = UFixed18Lib.ZERO;
            marketAccounts[market].totalUnclaimed = unclaimedTotalForProduct.sub(unclaimedAmount);

            (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral(market);
            totalCollateral = totalCollateral.add(longCollateral).add(shortCollateral).add(idleCollateral);
        }

        emit Claim(msg.sender, account, claimAmount);

        // pro-rate if vault has less collateral than unclaimed
        if (totalCollateral.lt(unclaimedTotal)) claimAmount = claimAmount.muldiv(totalCollateral, unclaimedTotal);

        _rebalance(contexts, claimAmount);

        asset.push(account, claimAmount);
    }

    /**
     * @notice Enable or disable the ability of `spender` to transfer shares on behalf of `msg.sender`
     * @param spender Address to toggle approval of
     * @param approved True if `spender` is approved, false to revoke approval
     */
    function setApproval(address spender, bool approved) external {
        isApproved[msg.sender][spender] = approved;
        emit Approval(msg.sender, spender, approved);
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @return Maximum available deposit amount
     */
    function maxDeposit(address) external view returns (UFixed18) {
        VersionContext[] memory contexts = new VersionContext[](totalMarkets);
        for (uint256 market = 0; market < totalMarkets; ++market) {
            MarketDefinition memory marketDefinition = markets(market);
            (contexts[market], ) = marketAccounts[market].loadContextForRead(market, marketDefinition, address(0));
        }
        return _maxDepositAtVersion(contexts);
    }

    /**
     * @notice The maximum available redeemable amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param account The account to redeem for
     * @return Maximum available redeemable proportion
     */
    function maxRedeem(address account) external view returns (UFixed18) {
        for (uint256 market = 0; market < totalMarkets; ++market) {
            MarketDefinition memory marketDefinition = markets(market);
            (VersionContext memory context, ) = marketAccounts[market].loadContextForRead(market, marketDefinition, account);
            if (_unhealthyAtVersion(context)) return UFixed18Lib.ZERO;
        }
        return UFixed18Lib.ONE;
    }

    /**
     * @notice The total amount of assets currently held by the vault
     * @return Amount of assets held by the vault
     */
    function totalAssets() external view returns (UFixed18) {
        UFixed18 total = UFixed18Lib.ZERO;
        for (uint256 market = 0; market < totalMarkets; ++market) {
            MarketDefinition memory marketDefinition = markets(market);
            (VersionContext memory context, ) = marketAccounts[market].loadContextForRead(market, marketDefinition, address(0));
            total = total.add(_totalAssetsAtVersion(context));
        }
        return total;
    }

    /**
     * @notice Total unclaimed assets in vault
     * @return Total unclaimed assets in vault
     */
    function totalUnclaimed() external view returns (UFixed18) {
        UFixed18 total = UFixed18Lib.ZERO;
        for (uint256 market = 0; market < totalMarkets; ++market) {
            MarketDefinition memory marketDefinition = markets(market);
            (VersionContext memory context, ) = marketAccounts[market].loadContextForRead(market, marketDefinition, address(0));
            total = total.add(_totalUnclaimedAtVersion(context));
        }
        return total;
    }

    /**
     * @notice `account`'s unclaimed assets
     * @param account Account to query unclaimed balance of
     * @return `account`'s unclaimed assets
     */
    function unclaimed(address account) external view returns (UFixed18) {
        UFixed18 total = UFixed18Lib.ZERO;
        for (uint256 market = 0; market < totalMarkets; ++market) {
            MarketDefinition memory marketDefinition = markets(market);
            (, VersionContext memory accountContext) = marketAccounts[market].loadContextForRead(market, marketDefinition, account);
            total = total.add(_unclaimedAtVersion(accountContext, account));
        }
        return total;
    }

    /**
     * @notice Converts a given proportion of a user's shares to assets
     * @param proportion Proportion of shares to convert to assets
     * @param account The account to convert a proportion of shares of.
     * @return Amount of assets for the given shares
     */
    function convertToAssets(UFixed18 proportion, address account) external view returns (UFixed18) {
        UFixed18 total = UFixed18Lib.ZERO;
        for (uint256 market = 0; market < totalMarkets; ++market) {
            MarketDefinition memory marketDefinition = markets(market);
            (VersionContext memory context, VersionContext memory accountContext) = marketAccounts[market].loadContextForRead(market, marketDefinition, account);
            (context.latestCollateral, context.latestShares) =
                (_totalAssetsAtVersion(context), _totalSupplyAtVersion(context));
            if (context.latestShares.gt(UFixed18Lib.ZERO)) {
                total = total.add(_convertToAssetsAtVersion(context, context.latestShares).muldiv(_balanceOfAtVersion(accountContext, account), context.latestShares));
            }
        }
        return total.mul(proportion);
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param account The account that called the operation, or 0 if called by a keeper.
     * @return contexts The current version contexts for each market
     * @return accountContexts The current version contexts for each market for the given account
     */
    function _settle(address account) private returns (VersionContext[] memory contexts, VersionContext[] memory accountContexts) {
        contexts = new VersionContext[](totalMarkets);
        accountContexts = new VersionContext[](totalMarkets);
        for (uint256 market = 0; market < totalMarkets; ++market) {
            MarketDefinition memory marketDefinition = markets(market);
            (contexts[market], accountContexts[market]) = marketAccounts[market].loadContextForWrite(market, marketDefinition, account);
            if (contexts[market].version > marketAccounts[market].latestVersion) {
                marketAccounts[market].delayedMint(_totalSupplyAtVersion(contexts[market]).sub(marketAccounts[market].totalSupply));
                marketAccounts[market].totalUnclaimed = _totalUnclaimedAtVersion(contexts[market]);
                marketAccounts[market].deposit = UFixed18Lib.ZERO;
                marketAccounts[market].redemption = UFixed18Lib.ZERO;
                marketAccounts[market].latestVersion = contexts[market].version;

                // TODO: delayed mint event

                IProduct long = markets(market).long;
                IProduct short = markets(market).short;
                marketAccounts[market].versions[contexts[market].version] = MarketVersion({
                    longPosition: long.position(address(this)).maker,
                    shortPosition: short.position(address(this)).maker,
                    totalShares: marketAccounts[market].totalSupply,
                    longAssets: collateral.collateral(address(this), long),
                    shortAssets: collateral.collateral(address(this), short),
                    totalAssets: _totalAssetsAtVersion(contexts[market])
                });
            }

            if (account != address(0) && accountContexts[market].version > marketAccounts[market].latestVersions[account]) {
                marketAccounts[market].delayedMintAccount(account, _balanceOfAtVersion(accountContexts[market], account).sub(marketAccounts[market].balanceOf[account]));
                marketAccounts[market].unclaimed[account] = _unclaimedAtVersion(accountContexts[market], account);
                marketAccounts[market].deposits[account] = UFixed18Lib.ZERO;
                marketAccounts[market].redemptions[account] = UFixed18Lib.ZERO;
                marketAccounts[market].latestVersions[account] = accountContexts[market].version;
            }
        }
    }

    /**
     * @notice Rebalances the collateral and position of the vault
     * @dev Rebalance is executed on best-effort, any failing legs of the strategy will not cause a revert
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalance(VersionContext[] memory contexts, UFixed18 claimAmount) private {
        _rebalanceCollateral(claimAmount);
        for (uint256 market = 0; market < totalMarkets; ++market) {
            _rebalancePosition(contexts[market], claimAmount);
        }
    }

    /**
     * @notice Rebalances the collateral of the vault
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalanceCollateral(UFixed18 claimAmount) private {
        // 1. Get total collateral
        UFixed18[] memory longCollaterals = new UFixed18[](totalMarkets);
        UFixed18[] memory shortCollaterals = new UFixed18[](totalMarkets);
        UFixed18 totalCollateral = UFixed18Lib.ZERO;
        for (uint256 market = 0; market < totalMarkets; ++market) {
            UFixed18 idlecollateral;
            (longCollaterals[market], shortCollaterals[market], idlecollateral) = _collateral(market);
            totalCollateral = totalCollateral.add(longCollaterals[market]).add(shortCollaterals[market]).add(idlecollateral);
        }
        totalCollateral = totalCollateral.sub(claimAmount);

        // 2. Get target collateral for each product
        UFixed18 totalCollateralToDeposit = UFixed18Lib.ZERO;
        bool enoughCollateralForAllProducts = true;
        for (uint256 market = 0; market < totalMarkets; ++market) {
            UFixed18 targetCollateral = totalCollateral.muldiv(markets(market).weight, totalWeight).div(TWO);
            if (targetCollateral.lt(controller.minCollateral())) {
                targetCollateral = UFixed18Lib.ZERO;
                enoughCollateralForAllProducts = false;
            }

            // 3. Best-effort withdrawal of collateral from products with too much collateral
            // TODO: Don't withdraw all if it would revert
            if (longCollaterals[market].gt(targetCollateral)) {
                PerennialLib.updateCollateral(collateral, markets(market).long, targetCollateral);
            } else {
                totalCollateralToDeposit = totalCollateralToDeposit.add(targetCollateral.sub(longCollaterals[market]));
            }
            if (shortCollaterals[market].gt(targetCollateral)) {
                PerennialLib.updateCollateral(collateral, markets(market).short, targetCollateral);
            } else {
                totalCollateralToDeposit = totalCollateralToDeposit.add(targetCollateral.sub(shortCollaterals[market]));
            }
        }

        UFixed18 idleCollateral = asset.balanceOf();
        UFixed18 depositProRataRatio = UFixed18Lib.ONE;
        if (idleCollateral.lt(totalCollateralToDeposit)) {
            depositProRataRatio = idleCollateral.div(totalCollateralToDeposit);
        }

        // 4. Pro-rata deposit of collateral into products with too little collateral
        if (!enoughCollateralForAllProducts) {
            // Only deposit any collateral if we have enough collateral to meet minCollateral for all products.
            return;
        }
        for (uint256 market = 0; market < totalMarkets; ++market) {
            UFixed18 targetCollateral = totalCollateral.muldiv(markets(market).weight, totalWeight).div(TWO);
            if (longCollaterals[market].lt(targetCollateral)) {
                PerennialLib.updateCollateral(
                    collateral,
                    markets(market).long,
                    longCollaterals[market].add(targetCollateral.sub(longCollaterals[market]).mul(depositProRataRatio))
                );
            }
            if (shortCollaterals[market].lt(targetCollateral)) {
                PerennialLib.updateCollateral(
                    collateral,
                    markets(market).short,
                    shortCollaterals[market].add(targetCollateral.sub(shortCollaterals[market]).mul(depositProRataRatio))
                );
            }
        }
    }

    /**
     * @notice Rebalances the position of the vault
     */
    function _rebalancePosition(VersionContext memory context, UFixed18 claimAmount) private {
        IProduct long = markets(context.market).long;
        IProduct short = markets(context.market).short;
        if (long.closed() || short.closed()) { //TODO: need this??
            PerennialLib.updateMakerPosition(long, UFixed18Lib.ZERO);
            PerennialLib.updateMakerPosition(short, UFixed18Lib.ZERO);
            return;
        }

        UFixed18 currentAssets = _totalAssetsAtVersion(context).sub(claimAmount);
        UFixed18 currentUtilized = marketAccounts[context.market].totalSupply.add(marketAccounts[context.market].redemption).isZero() ?
            marketAccounts[context.market].deposit.add(currentAssets) :
            marketAccounts[context.market].deposit.add(currentAssets.muldiv(marketAccounts[context.market].totalSupply, marketAccounts[context.market].totalSupply.add(marketAccounts[context.market].redemption)));
        if (currentUtilized.lt(controller.minCollateral().mul(TWO))) currentUtilized = UFixed18Lib.ZERO;

        UFixed18 currentPrice = long.atVersion(context.version).price.abs();
        UFixed18 targetPosition = currentUtilized.mul(targetLeverage).div(currentPrice).div(TWO);

        PerennialLib.updateMakerPosition(long, targetPosition);
        PerennialLib.updateMakerPosition(short, targetPosition);
    }

    /**
     * @notice Calculates whether or not the vault is in an unhealthy state at the provided version
     * @param context Version context to calculate health
     * @return bool true if unhealthy, false if healthy
     */
    function _unhealthyAtVersion(VersionContext memory context) private view returns (bool) {
        IProduct long = markets(context.market).long;
        IProduct short = markets(context.market).short;
        return collateral.liquidatable(address(this), long)
            || collateral.liquidatable(address(this), short)
            || long.isLiquidating(address(this))
            || short.isLiquidating(address(this))
            || (!context.latestShares.isZero() && context.latestCollateral.isZero());
    }

    /**
     * @notice The maximum available deposit amount at the given version
     * @param contexts Version contexts of all the markets to use in calculation
     * @return Maximum available deposit amount at version
     */
    function _maxDepositAtVersion(VersionContext[] memory contexts) private view returns (UFixed18) {
        UFixed18 currentCollateral = UFixed18Lib.ZERO;
        for (uint256 market = 0; market < contexts.length; ++market) {
            if (_unhealthyAtVersion(contexts[market])) return UFixed18Lib.ZERO;
            currentCollateral = currentCollateral.add(_totalAssetsAtVersion(contexts[market])).add(marketAccounts[market].deposit);
        }
        return maxCollateral.gt(currentCollateral) ? maxCollateral.sub(currentCollateral) : UFixed18Lib.ZERO;
    }

    /**
     * @notice The maximum available redeemable amount at the given version for `account`
     * @param context Version context to use in calculation
     * @param accountContext Account version context to use in calculation
     * @param account Account to calculate redeemable amount
     * @return Maximum available redeemable amount at version
     */
    function _maxRedeemAtVersion(
        VersionContext memory context,
        VersionContext memory accountContext,
        address account
    ) private view returns (UFixed18) {
        if (_unhealthyAtVersion(context)) return UFixed18Lib.ZERO;
        return _balanceOfAtVersion(accountContext, account);
    }

    /**
     * @notice The total assets at the given version
     * @param context Version context to use in calculation
     * @return Total assets amount at version
     */
    function _totalAssetsAtVersion(VersionContext memory context) private view returns (UFixed18) {
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral(context.market);
        (UFixed18 totalCollateral, UFixed18 totalDebt) =
            (longCollateral.add(shortCollateral).add(idleCollateral), _totalUnclaimedAtVersion(context).add(marketAccounts[context.market].deposit));
        return totalCollateral.gt(totalDebt) ? totalCollateral.sub(totalDebt) : UFixed18Lib.ZERO;
    }

    /**
     * @notice The total supply at the given version
     * @param context Version context to use in calculation
     * @return Total supply amount at version
     */
    function _totalSupplyAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (context.version == marketAccounts[context.market].latestVersion) return marketAccounts[context.market].totalSupply;
        return marketAccounts[context.market].totalSupply.add(_convertToSharesAtVersion(context, marketAccounts[context.market].deposit));
    }

    /**
     * @notice The balance of `account` at the given version
     * @param accountContext Account version context to use in calculation
     * @param account Account to calculate balance of amount
     * @return Account balance at version
     */
    function _balanceOfAtVersion(VersionContext memory accountContext, address account) private view returns (UFixed18) {
        if (accountContext.version == marketAccounts[accountContext.market].latestVersions[account]) return marketAccounts[accountContext.market].balanceOf[account];
        return marketAccounts[accountContext.market].balanceOf[account].add(_convertToSharesAtVersion(accountContext, marketAccounts[accountContext.market].deposits[account]));
    }

    /**
     * @notice The total unclaimed assets at the given version
     * @param context Version context to use in calculation
     * @return Total unclaimed asset amount at version
     */
    function _totalUnclaimedAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (context.version == marketAccounts[context.market].latestVersion) return marketAccounts[context.market].totalUnclaimed;
        return marketAccounts[context.market].totalUnclaimed.add(_convertToAssetsAtVersion(context, marketAccounts[context.market].redemption));
    }

    /**
     * @notice The total unclaimed assets at the given version for `account`
     * @param accountContext Account version context to use in calculation
     * @param account Account to calculate unclaimed assets for
     * @return Total unclaimed asset amount for `account` at version
     */
    function _unclaimedAtVersion(VersionContext memory accountContext, address account) private view returns (UFixed18) {
        if (accountContext.version == marketAccounts[accountContext.market].latestVersions[account]) return marketAccounts[accountContext.market].unclaimed[account];
        return marketAccounts[accountContext.market].unclaimed[account].add(_convertToAssetsAtVersion(accountContext, marketAccounts[accountContext.market].redemptions[account]));
    }

    /**
     * @notice Returns the amounts of the individual sources of assets in the vault
     * @return The amount of collateral in the long product
     * @return The amount of collateral in the short product
     * @return The amount of collateral idle in the vault contract
     */
    function _collateral(uint256 market) private view returns (UFixed18, UFixed18, UFixed18) {
        if (market >= totalMarkets) return (UFixed18Lib.ZERO, UFixed18Lib.ZERO, UFixed18Lib.ZERO);

        return (
            collateral.collateral(address(this), markets(market).long),
            collateral.collateral(address(this), markets(market).short),
            asset.balanceOf().muldiv(markets(market).weight, totalWeight) //TODO: should not divide here
        );
    }

    /**
     * @notice Converts a given amount of assets to shares at version
     * @param context Version context to use in calculation
     * @param assets Number of assets to convert to shares
     * @return Amount of shares for the given assets at version
     */
    function _convertToSharesAtVersion(VersionContext memory context, UFixed18 assets) private pure returns (UFixed18) {
        if (context.latestCollateral.isZero()) return assets;
        return assets.muldiv(context.latestShares, context.latestCollateral);
    }

    /**
     * @notice Converts a given amount of shares to assets at version
     * @param context Version context to use in calculation
     * @param shares Number of shares to convert to shares
     * @return Amount of assets for the given shares at version
     */
    function _convertToAssetsAtVersion(VersionContext memory context, UFixed18 shares) private pure returns (UFixed18) {
        if (context.latestShares.isZero()) return shares;
        return shares.muldiv(context.latestCollateral, context.latestShares);
    }
}
