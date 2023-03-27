//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./interfaces/IBalancedVault.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

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
contract BalancedVault is IBalancedVault, UInitializable {
    UFixed18 constant private TWO = UFixed18.wrap(2e18);

    /// @dev The address of the Perennial controller contract
    IController public immutable controller;

    /// @dev The address of the Perennial collateral contract
    ICollateral public immutable collateral;

    /// @dev Deprecated storage variable. Formerly `long`
    IProduct private immutable __unused1;

    /// @dev Deprecated storage variable. Formerly `short`
    IProduct private immutable __unused2;

    /// @dev The target leverage amount for the vault
    UFixed18 public immutable targetLeverage;

    /// @dev The collateral cap for the vault
    UFixed18 public immutable maxCollateral;

    /// @dev The underlying asset of the vault
    Token18 public immutable asset;

    /// @dev The ERC20 name of the vault
    string public name;

    /// @dev The ERC20 symbol of the vault
    string public symbol;

    /// @dev Deprecated storage variable. Formerly `allowance`
    uint256 private __unused3;

    /// @dev Per-asset accounting state variables
    MarketAccounting[100] marketAccounting;

    /// @dev The number of markets in the vault
    uint256 public numberOfMarkets;

    /// @dev The sum of the weights of all products in the vault
    uint256 private totalWeight;

    /// @dev Mapping of account => spender => whether spender is approved to spend account's shares
    mapping(address => mapping(address => bool)) public isApproved;

    /// @dev Deposits across all markets that have not been settled, or have been settled but not yet processed by this contract
    // TODO: Make sure this is set properly in the initializer
    UFixed18 _deposit;

    constructor(
        Token18 asset_,
        IController controller_,
        IProduct long_,
        IProduct short_,
        UFixed18 targetLeverage_,
        UFixed18 maxCollateral_
    ) {
        asset = asset_;
        controller = controller_;
        collateral = controller_.collateral();
        __unused1 = long_;
        __unused2 = short_;
        targetLeverage = targetLeverage_;
        maxCollateral = maxCollateral_;
    }

    /**
     * @notice Initializes the contract state
     * @param name_ ERC20 asset name
     * @param symbol_ ERC20 asset symbol
     */
    function initialize(string memory name_, string memory symbol_) external initializer(1) {
        name = name_;
        symbol = symbol_;

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
     * @notice Returns the long and short products for a market
     * @param market The market ID to get products for
     * @return long The long product
     * @return short The short product
     */
    function productsForMarket(uint256 market) external view returns (IProduct long, IProduct short) {
        long = marketAccounting[market].long;
        short = marketAccounting[market].short;
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
            UFixed18 assetsToDeposit = assets.muldiv(marketAccounting[market].weight, totalWeight);

            marketAccounting[market].deposit = marketAccounting[market].deposit.add(assetsToDeposit);
            marketAccounting[market].latestVersion = contexts[market].version;
            marketAccounting[market].deposits[account] = marketAccounting[market].deposits[account].add(assetsToDeposit);
            marketAccounting[market].latestVersions[account] = contexts[market].version;

            // TODO: One event per market or one event for all?
            emit Deposit(msg.sender, account, contexts[market].version, assets);
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

        for (uint256 market = 0; market < numberOfMarkets; ++market) {
            UFixed18 shares = marketAccounting[market].balanceOf[account].mul(proportion);
            if (shares.gt(_maxRedeemAtVersion(contexts[market], accountContexts[market], account))) revert BalancedVaultRedemptionLimitExceeded();
            UFixed18 sharesToRedeem = shares.muldiv(marketAccounting[market].weight, totalWeight);

            marketAccounting[market].redemption = marketAccounting[market].redemption.add(sharesToRedeem);
            marketAccounting[market].latestVersion = contexts[market].version;
            marketAccounting[market].redemptions[account] = marketAccounting[market].redemptions[account].add(sharesToRedeem);
            marketAccounting[market].latestVersions[account] = contexts[market].version;
            _burn(market, account, shares);

            // TODO: Should we emit one Redemption event per market?
            emit Redemption(msg.sender, account, contexts[market].version, proportion);
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
        for (uint256 market = 0; market < numberOfMarkets; ++market) {
            UFixed18 unclaimedAmount = marketAccounting[market].unclaimed[account];
            claimAmount = claimAmount.add(unclaimedAmount);
            UFixed18 unclaimedTotalForProduct = marketAccounting[market].totalUnclaimed;
            unclaimedTotal = unclaimedTotal.add(unclaimedTotalForProduct);
            marketAccounting[market].unclaimed[account] = UFixed18Lib.ZERO;
            marketAccounting[market].totalUnclaimed = unclaimedTotalForProduct.sub(unclaimedAmount);

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
     * @notice Returns the decimals places of the share token
     * @return Decimal places of the share share token
     */
    function decimals() external pure returns (uint8) {
        return 18;
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @return Maximum available deposit amount
     */
    function maxDeposit(address) external view returns (UFixed18) {
        VersionContext[] memory contexts = new VersionContext[](numberOfMarkets);
        for (uint256 market = 0; market < numberOfMarkets; ++market) {
            (contexts[market], ) = _loadContextForRead(market, address(0));
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
        for (uint256 market = 0; market < numberOfMarkets; ++market) {
            (VersionContext memory context, ) = _loadContextForRead(market, account);
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
        for (uint256 market = 0; market < numberOfMarkets; ++market) {
            (VersionContext memory context, ) = _loadContextForRead(market, address(0));
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
        for (uint256 market = 0; market < numberOfMarkets; ++market) {
            (VersionContext memory context, ) = _loadContextForRead(market, address(0));
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
        for (uint256 market = 0; market < numberOfMarkets; ++market) {
            (, VersionContext memory accountContext) = _loadContextForRead(market, account);
            total = total.add(_totalUnclaimedAtVersion(accountContext));
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
        for (uint256 market = 0; market < numberOfMarkets; ++market) {
            (VersionContext memory context, ) = _loadContextForRead(market, address(0));
            (context.latestCollateral, context.latestShares) =
                (_totalAssetsAtVersion(context), _totalSupplyAtVersion(context));
            UFixed18 shares = marketAccounting[market].balanceOf[account].mul(proportion);
            total = total.add(_convertToAssetsAtVersion(context, shares));
        }
        return total;
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param account The account that called the operation, or 0 if called by a keeper.
     * @return contexts The current version contexts for each market
     * @return accountContexts The current version contexts for each market for the given account
     */
    function _settle(address account) private returns (VersionContext[] memory contexts, VersionContext[] memory accountContexts) {
        contexts = new VersionContext[](marketAccounting.length);
        accountContexts = new VersionContext[](marketAccounting.length);
        for (uint256 market = 0; market < marketAccounting.length; ++market) {
            (contexts[market], accountContexts[market]) = _loadContextForWrite(market, account);
            if (contexts[market].version > marketAccounting[market].latestVersion) {
                _delayedMint(market, _totalSupplyAtVersion(contexts[market]).sub(marketAccounting[market].totalSupply));
                marketAccounting[market].totalUnclaimed = _totalUnclaimedAtVersion(contexts[market]);
                marketAccounting[market].deposit = UFixed18Lib.ZERO;
                marketAccounting[market].redemption = UFixed18Lib.ZERO;
                marketAccounting[market].latestVersion = contexts[market].version;

                IProduct long = marketAccounting[market].long;
                IProduct short = marketAccounting[market].short;
                marketAccounting[market].versions[contexts[market].version] = Version({
                    longPosition: long.position(address(this)).maker,
                    shortPosition: short.position(address(this)).maker,
                    totalShares: marketAccounting[market].totalSupply,
                    longAssets: collateral.collateral(address(this), long),
                    shortAssets: collateral.collateral(address(this), short),
                    totalAssets: _totalAssetsAtVersion(contexts[market])
                });
            }

            if (account != address(0) && accountContexts[market].version > marketAccounting[market].latestVersions[account]) {
                _delayedMintAccount(market, account, _balanceOfAtVersion(accountContexts[market], account).sub(marketAccounting[market].balanceOf[account]));
                marketAccounting[market].unclaimed[account] = _unclaimedAtVersion(accountContexts[market], account);
                marketAccounting[market].deposits[account] = UFixed18Lib.ZERO;
                marketAccounting[market].redemptions[account] = UFixed18Lib.ZERO;
                marketAccounting[market].latestVersions[account] = accountContexts[market].version;
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
        for (uint256 market = 0; market < marketAccounting.length; ++market) {
            _rebalancePosition(contexts[market], claimAmount);
        }
    }

    /**
     * @notice Rebalances the collateral of the vault
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalanceCollateral(UFixed18 claimAmount) private {
        // 1. Get total collateral
        UFixed18[] memory longCollaterals = new UFixed18[](numberOfMarkets);
        UFixed18[] memory shortCollaterals = new UFixed18[](numberOfMarkets);
        UFixed18 totalCollateral = UFixed18Lib.ZERO;
        for (uint256 market = 0; market < marketAccounting.length; ++market) {
            UFixed18 idlecollateral;
            (longCollaterals[market], shortCollaterals[market], idlecollateral) = _collateral(market);
            totalCollateral = totalCollateral.add(longCollaterals[market]).add(shortCollaterals[market]).add(idlecollateral);
        }
        totalCollateral = totalCollateral.sub(claimAmount);

        // 2. Get target collateral for each product
        UFixed18 totalCollateralToWithdraw = UFixed18Lib.ZERO;
        UFixed18 totalCollateralToDeposit = UFixed18Lib.ZERO;
        for (uint256 market = 0; market < marketAccounting.length; ++market) {
            UFixed18 targetCollateral = totalCollateral.muldiv(marketAccounting[market].weight, totalWeight).div(TWO);
            if (targetCollateral.lt(controller.minCollateral())) targetCollateral = UFixed18Lib.ZERO;

            // 3. Best-effort withdrawal of collateral from products with too much collateral
            // TODO: Don't withdraw all if it would revert
            if (longCollaterals[market].gt(targetCollateral)) {
                totalCollateralToWithdraw = totalCollateralToWithdraw.add(longCollaterals[market].sub(targetCollateral));
                _updateCollateral(marketAccounting[market].long, longCollaterals[market], targetCollateral);
            } else {
                totalCollateralToDeposit = totalCollateralToDeposit.add(targetCollateral.sub(longCollaterals[market]));
            }
            if (shortCollaterals[market].gt(targetCollateral)) {
                totalCollateralToWithdraw = totalCollateralToWithdraw.add(shortCollaterals[market].sub(targetCollateral));
                _updateCollateral(marketAccounting[market].short, shortCollaterals[market], targetCollateral);
            } else {
                totalCollateralToDeposit = totalCollateralToDeposit.add(targetCollateral.sub(shortCollaterals[market]));
            }
        }

        // 4. Pro-rata deposit of collateral into products with too little collateral
        for (uint256 market = 0; market < marketAccounting.length; ++market) {
            UFixed18 targetCollateral = totalCollateral.muldiv(marketAccounting[market].weight, totalWeight).div(TWO);
            if (longCollaterals[market].lt(targetCollateral)) {
                _updateCollateral(marketAccounting[market].long,
                                  longCollaterals[market],
                                  longCollaterals[market].add(targetCollateral.sub(longCollaterals[market]).muldiv(totalCollateralToDeposit, totalCollateralToWithdraw)));
            }
            if (shortCollaterals[market].lt(targetCollateral)) {
                _updateCollateral(marketAccounting[market].short,
                                  shortCollaterals[market],
                                  shortCollaterals[market].add(targetCollateral.sub(shortCollaterals[market]).muldiv(totalCollateralToDeposit, totalCollateralToWithdraw)));
            }
        }
    }

    /**
     * @notice Rebalances the position of the vault
     */
    function _rebalancePosition(VersionContext memory context, UFixed18 claimAmount) private {
        UFixed18 currentAssets = _totalAssetsAtVersion(context).sub(claimAmount);
        UFixed18 currentUtilized = marketAccounting[context.market].totalSupply.add(marketAccounting[context.market].redemption).isZero() ?
            marketAccounting[context.market].deposit.add(currentAssets) :
            marketAccounting[context.market].deposit.add(currentAssets.muldiv(marketAccounting[context.market].totalSupply, marketAccounting[context.market].totalSupply.add(marketAccounting[context.market].redemption)));
        if (currentUtilized.lt(controller.minCollateral().mul(TWO))) currentUtilized = UFixed18Lib.ZERO;

        IProduct long = marketAccounting[context.market].long;
        IProduct short = marketAccounting[context.market].short;
        UFixed18 currentPrice = long.atVersion(context.version).price.abs();
        UFixed18 targetPosition = currentUtilized.mul(targetLeverage).div(currentPrice).div(TWO);

        _updateMakerPosition(long, targetPosition);
        _updateMakerPosition(short, targetPosition);
    }

    /**
     * @notice Adjusts the collateral on `product` to `targetCollateral`
     * @param product The product to adjust the vault's collateral on
     * @param currentCollateral The current collateral of the product
     * @param targetCollateral The new collateral to target
     */
    function _updateCollateral(IProduct product, UFixed18 currentCollateral, UFixed18 targetCollateral) private {
        if (currentCollateral.gt(targetCollateral))
            collateral.withdrawTo(address(this), product, currentCollateral.sub(targetCollateral));
        if (currentCollateral.lt(targetCollateral))
            collateral.depositTo(address(this), product, targetCollateral.sub(currentCollateral));

        emit CollateralUpdated(product, targetCollateral);
    }

    /**
     * @notice Adjusts the position on `product` to `targetPosition`
     * @param product The product to adjust the vault's position on
     * @param targetPosition The new position to target
     */
    function _updateMakerPosition(IProduct product, UFixed18 targetPosition) private {
        UFixed18 currentPosition = product.position(address(this)).next(product.pre(address(this))).maker;
        UFixed18 currentMaker = product.positionAtVersion(product.latestVersion()).next(product.pre()).maker;
        UFixed18 makerLimit = product.makerLimit();
        UFixed18 makerAvailable = makerLimit.gt(currentMaker) ? makerLimit.sub(currentMaker) : UFixed18Lib.ZERO;

        if (targetPosition.lt(currentPosition))
            product.closeMake(currentPosition.sub(targetPosition));
        if (targetPosition.gt(currentPosition))
            product.openMake(targetPosition.sub(currentPosition).min(makerAvailable));

        emit PositionUpdated(product, targetPosition);
    }

    /**
     * @notice Burns `amount` shares from `from`, adjusting totalSupply
     * @param from Address to burn shares from
     * @param amount Amount of shares to burn
     */
    function _burn(uint256 market, address from, UFixed18 amount) private validMarket(market) {
        marketAccounting[market].balanceOf[from] = marketAccounting[market].balanceOf[from].sub(amount);
        marketAccounting[market].totalSupply = marketAccounting[market].totalSupply.sub(amount);
        emit Transfer(from, address(0), amount);
    }

    /**
     * @notice Mints `amount` shares, adjusting totalSupply
     * @param market Market ID
     * @param amount Amount of shares to mint
     */
    function _delayedMint(uint256 market, UFixed18 amount) private validMarket(market) {
        marketAccounting[market].totalSupply = marketAccounting[market].totalSupply.add(amount);
    }

    /**
     * @notice Mints `amount` shares to `to`
     * @param market Market ID
     * @param to Address to mint shares to
     * @param amount Amount of shares to mint
     */
    function _delayedMintAccount(uint256 market, address to, UFixed18 amount) private validMarket(market) {
        marketAccounting[market].balanceOf[to] = marketAccounting[market].balanceOf[to].add(amount);
        emit Transfer(address(0), to, amount);
    }

    /**
     * @notice Loads the context for the given `account`, settling the vault first
     * @param market Market ID
     * @param account Account to load the context for
     * @return global version context
     * @return account version context
     */
    function _loadContextForWrite(uint256 market, address account) private validMarket(market) returns (VersionContext memory, VersionContext memory) {
        marketAccounting[market].long.settleAccount(address(this));
        marketAccounting[market].short.settleAccount(address(this));
        uint256 currentVersion = marketAccounting[market].long.latestVersion(address(this));

        return (
            VersionContext(market, currentVersion, _assetsAt(market, marketAccounting[market].latestVersion), _sharesAt(market, marketAccounting[market].latestVersion)),
            VersionContext(market, currentVersion, _assetsAt(market, marketAccounting[market].latestVersions[account]), _sharesAt(market, marketAccounting[market].latestVersions[account]))
        );
    }

    /**
     * @notice Loads the context for the given `account`
     * @param market Market ID
     * @param account Account to load the context for
     * @return global version context
     * @return account version context
     */
    function _loadContextForRead(uint256 market, address account) private view validMarket(market) returns (VersionContext memory, VersionContext memory) {
        uint256 currentVersion = Math.min(marketAccounting[market].long.latestVersion(), marketAccounting[market].short.latestVersion()); // latest version that both products are settled to

        return (
            VersionContext(market, currentVersion, _assetsAt(market, marketAccounting[market].latestVersion), _sharesAt(market, marketAccounting[market].latestVersion)),
            VersionContext(market, currentVersion, _assetsAt(market, marketAccounting[market].latestVersions[account]), _sharesAt(market, marketAccounting[market].latestVersions[account]))
        );
    }

    /**
     * @notice Calculates whether or not the vault is in an unhealthy state at the provided version
     * @param context Version context to calculate health
     * @return bool true if unhealthy, false if healthy
     */
    function _unhealthyAtVersion(VersionContext memory context) private view returns (bool) {
        IProduct long = marketAccounting[context.market].long;
        IProduct short = marketAccounting[context.market].short;
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
            currentCollateral = currentCollateral.add(_totalAssetsAtVersion(contexts[market]));
        }
        currentCollateral = currentCollateral.add(_deposit);
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
            (longCollateral.add(shortCollateral).add(idleCollateral), _totalUnclaimedAtVersion(context).add(marketAccounting[context.market].deposit));
        return totalCollateral.gt(totalDebt) ? totalCollateral.sub(totalDebt) : UFixed18Lib.ZERO;
    }

    /**
     * @notice The total supply at the given version
     * @param context Version context to use in calculation
     * @return Total supply amount at version
     */
    function _totalSupplyAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (context.version == marketAccounting[context.market].latestVersion) return marketAccounting[context.market].totalSupply;
        return marketAccounting[context.market].totalSupply.add(_convertToSharesAtVersion(context, marketAccounting[context.market].deposit));
    }

    /**
     * @notice The balance of `account` at the given version
     * @param accountContext Account version context to use in calculation
     * @param account Account to calculate balance of amount
     * @return Account balance at version
     */
    function _balanceOfAtVersion(VersionContext memory accountContext, address account) private view returns (UFixed18) {
        if (accountContext.version == marketAccounting[accountContext.market].latestVersions[account]) return marketAccounting[accountContext.market].balanceOf[account];
        return marketAccounting[accountContext.market].balanceOf[account].add(_convertToSharesAtVersion(accountContext, marketAccounting[accountContext.market].deposits[account]));
    }

    /**
     * @notice The total unclaimed assets at the given version
     * @param context Version context to use in calculation
     * @return Total unclaimed asset amount at version
     */
    function _totalUnclaimedAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (context.version == marketAccounting[context.market].latestVersion) return marketAccounting[context.market].totalUnclaimed;
        return marketAccounting[context.market].totalUnclaimed.add(_convertToAssetsAtVersion(context, marketAccounting[context.market].redemption));
    }

    /**
     * @notice The total unclaimed assets at the given version for `account`
     * @param accountContext Account version context to use in calculation
     * @param account Account to calculate unclaimed assets for
     * @return Total unclaimed asset amount for `account` at version
     */
    function _unclaimedAtVersion(VersionContext memory accountContext, address account) private view returns (UFixed18) {
        if (accountContext.version == marketAccounting[accountContext.market].latestVersions[account]) return marketAccounting[accountContext.market].unclaimed[account];
        return marketAccounting[accountContext.market].unclaimed[account].add(_convertToAssetsAtVersion(accountContext, marketAccounting[accountContext.market].redemptions[account]));
    }

    /**
     * @notice Returns the amounts of the individual sources of assets in the vault
     * @return The amount of collateral in the long product
     * @return The amount of collateral in the short product
     * @return The amount of collateral idle in the vault contract
     */
    function _collateral(uint256 market) private view validMarket(market) returns (UFixed18, UFixed18, UFixed18) {
        return (
            collateral.collateral(address(this), marketAccounting[market].long),
            collateral.collateral(address(this), marketAccounting[market].short),
            asset.balanceOf().muldiv(marketAccounting[market].weight, totalWeight)
        );
    }

    /**
     * @notice The total assets at the given version
     * @dev Calculates and adds accumulated PnL for `version` + 1
     * @param market Market ID
     * @param version Version to get total assets at
     * @return Total assets in the vault at the given version
     */
    function _assetsAt(uint256 market, uint256 version) private view validMarket(market) returns (UFixed18) {
        IProduct long = marketAccounting[market].long;
        IProduct short = marketAccounting[market].short;

        Fixed18 longAccumulated = long.valueAtVersion(version + 1).maker.sub(long.valueAtVersion(version).maker)
            .mul(Fixed18Lib.from(marketAccounting[market].versions[version].longPosition))
            .max(Fixed18Lib.from(marketAccounting[market].versions[version].longAssets).mul(Fixed18Lib.NEG_ONE));  // collateral can't go negative on a product
        Fixed18 shortAccumulated = short.valueAtVersion(version + 1).maker.sub(short.valueAtVersion(version).maker)
            .mul(Fixed18Lib.from(marketAccounting[market].versions[version].shortPosition))
            .max(Fixed18Lib.from(marketAccounting[market].versions[version].shortAssets).mul(Fixed18Lib.NEG_ONE)); // collateral can't go negative on a product

        return UFixed18Lib.from(
            Fixed18Lib.from(marketAccounting[market].versions[version].totalAssets)
                .add(longAccumulated)
                .add(shortAccumulated)
                .max(Fixed18Lib.ZERO) // vault can't have negative assets, socializes into unclaimed if triggered
        );
    }

    /**
     * @notice The total shares at the given version
     * @param market Market ID
     * @param version Version to get total shares at
     * @return Total shares at `version`
     */
    function _sharesAt(uint256 market, uint256 version) private view validMarket(market) returns (UFixed18) {
        return marketAccounting[market].versions[version].totalShares;
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

    /// @dev Verify that `market` is a valid market ID
    modifier validMarket(uint256 market) {
        if (market >= numberOfMarkets) revert InvalidMarket(market);

        _;
    }
}
