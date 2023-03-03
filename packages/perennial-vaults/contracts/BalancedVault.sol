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

    /// @dev The address of the Perennial product on the long side
    IProduct public immutable long;

    /// @dev The address of the Perennial product on the short side
    IProduct public immutable short;

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

    /// @dev Mapping of allowance across all users
    mapping(address => mapping(address => UFixed18)) public allowance;

    /// @dev Mapping of shares of the vault per user
    mapping(address => UFixed18) private _balanceOf;

    /// @dev Total number of shares across all users
    UFixed18 private _totalSupply;

    /// @dev Mapping of unclaimed underlying of the vault per user
    mapping(address => UFixed18) private _unclaimed;

    /// @dev Mapping of unclaimed underlying of the vault per user
    UFixed18 private _totalUnclaimed;

    /// @dev Deposits that have not been settled, or have been settled but not yet processed by this contract
    UFixed18 private _deposit;

    /// @dev Redemptions that have not been settled, or have been settled but not yet processed by this contract
    UFixed18 private _redemption;

    /// @dev The latest version that a pending deposit or redemption has been placed
    uint256 private _latestVersion;

    /// @dev Mapping of pending (not yet converted to shares) per user
    mapping(address => UFixed18) private _deposits;

    /// @dev Mapping of pending (not yet withdrawn) per user
    mapping(address => UFixed18) private _redemptions;

    /// @dev Mapping of the latest version that a pending deposit or redemption has been placed per user
    mapping(address => uint256) private _latestVersions;

    /// @dev Mapping of versions of the vault state at a given oracle version
    mapping(uint256 => Version) private _versions;

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
        long = long_;
        short = short_;
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
        (VersionContext memory context, ) = _settle(address(0));
        _rebalance(context, UFixed18Lib.ZERO);
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `account` after the deposit settles.
     * @param assets The amount of assets to deposit
     * @param account The account to deposit on behalf of
     */
    function deposit(UFixed18 assets, address account) external {
        (VersionContext memory context, ) = _settle(account);
        if (assets.gt(_maxDepositAtVersion(context))) revert BalancedVaultDepositLimitExceeded();

        _deposit = _deposit.add(assets);
        _latestVersion = context.version;
        _deposits[account] = _deposits[account].add(assets);
        _latestVersions[account] = context.version;
        emit Deposit(msg.sender, account, context.version, assets);

        asset.pull(msg.sender, assets);

        _rebalance(context, UFixed18Lib.ZERO);
    }

    /**
     * @notice Redeems `shares` shares from the vault
     * @dev Does not return any assets to the user due to delayed settlement. Use `claim` to claim assets
     *      If account is not msg.sender, requires prior spending approval
     * @param shares The amount of shares to redeem
     * @param account The account to redeem on behalf of
     */
    function redeem(UFixed18 shares, address account) external {
        if (msg.sender != account) _consumeAllowance(account, msg.sender, shares);

        (VersionContext memory context, VersionContext memory accountContext) = _settle(account);
        if (shares.gt(_maxRedeemAtVersion(context, accountContext, account))) revert BalancedVaultRedemptionLimitExceeded();

        _redemption = _redemption.add(shares);
        _latestVersion = context.version;
        _redemptions[account] = _redemptions[account].add(shares);
        _latestVersions[account] = context.version;
        emit Redemption(msg.sender, account, context.version, shares);

        _burn(account, shares);

        _rebalance(context, UFixed18Lib.ZERO);
    }

    /**
     * @notice Claims all claimable assets for account, sending assets to account
     * @param account The account to claim for
     */
    function claim(address account) external {
        (VersionContext memory context, ) = _settle(account);

        UFixed18 unclaimedAmount = _unclaimed[account];
        UFixed18 unclaimedTotal = _totalUnclaimed;
        _unclaimed[account] = UFixed18Lib.ZERO;
        _totalUnclaimed = unclaimedTotal.sub(unclaimedAmount);
        emit Claim(msg.sender, account, unclaimedAmount);

        // pro-rate if vault has less collateral than unclaimed
        UFixed18 claimAmount = unclaimedAmount;
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        UFixed18 totalCollateral = longCollateral.add(shortCollateral).add(idleCollateral);
        if (totalCollateral.lt(unclaimedTotal)) claimAmount = claimAmount.muldiv(totalCollateral, unclaimedTotal);

        _rebalance(context, claimAmount);

        asset.push(account, claimAmount);
    }

    /**
     * @notice Sets `amount` as the allowance of `spender` over the caller's shares
     * @param spender Address which can spend operate on shares
     * @param amount Amount of shares that spender can operate on
     * @return bool true if the approval was successful, otherwise reverts
     */
    function approve(address spender, UFixed18 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Moves `amount` shares from the caller's account to `to`
     * @param to Address to send shares to
     * @param amount Amount of shares to send
     * @return bool true if the transfer was successful, otherwise reverts
     */
    function transfer(address to, UFixed18 amount) external returns (bool) {
        _settle(msg.sender);
        _transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @notice Moves `amount` shares from `from to `to`
     * @param from Address to send shares from
     * @param to Address to send shares to
     * @param amount Amount of shares to send
     * @return bool true if the transfer was successful, otherwise reverts
     */
    function transferFrom(address from, address to, UFixed18 amount) external returns (bool) {
        _settle(from);
        _consumeAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        return true;
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
        (VersionContext memory context, ) = _loadContextForRead(address(0));
        return _maxDepositAtVersion(context);
    }

    /**
     * @notice The maximum available redeemable amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param account The account to redeem for
     * @return Maximum available redeemable amount
     */
    function maxRedeem(address account) external view returns (UFixed18) {
        (VersionContext memory context, VersionContext memory accountContext) = _loadContextForRead(account);
        return _maxRedeemAtVersion(context, accountContext, account);
    }

    /**
     * @notice The total amount of assets currently held by the vault
     * @return Amount of assets held by the vault
     */
    function totalAssets() external view returns (UFixed18) {
        (VersionContext memory context, ) = _loadContextForRead(address(0));
        return _totalAssetsAtVersion(context);
    }

    /**
     * @notice The total amount of shares currently issued
     * @return Amount of shares currently issued
     */
    function totalSupply() external view returns (UFixed18) {
        (VersionContext memory context, ) = _loadContextForRead(address(0));
        return _totalSupplyAtVersion(context);
    }

    /**
     * @notice Number of shares held by `account`
     * @param account Account to query balance of
     * @return Number of shares held by `account`
     */
    function balanceOf(address account) external view returns (UFixed18) {
        (, VersionContext memory accountContext) = _loadContextForRead(account);
        return _balanceOfAtVersion(accountContext, account);
    }

    /**
     * @notice Total unclaimed assets in vault
     * @return Total unclaimed assets in vault
     */
    function totalUnclaimed() external view returns (UFixed18) {
        (VersionContext memory context, ) = _loadContextForRead(address(0));
        return _totalUnclaimedAtVersion(context);
    }

    /**
     * @notice `account`'s unclaimed assets
     * @param account Account to query unclaimed balance of
     * @return `account`'s unclaimed assets
     */
    function unclaimed(address account) external view returns (UFixed18) {
        (, VersionContext memory accountContext) = _loadContextForRead(account);
        return _unclaimedAtVersion(accountContext, account);
    }

    /**
     * @notice Converts a given amount of assets to shares
     * @param assets Number of assets to convert to shares
     * @return Amount of shares for the given assets
     */
    function convertToShares(UFixed18 assets) external view returns (UFixed18) {
        (VersionContext memory context, ) = _loadContextForRead(address(0));
        (context.latestCollateral, context.latestShares) =
            (_totalAssetsAtVersion(context), _totalSupplyAtVersion(context));
        return _convertToSharesAtVersion(context, assets);
    }

    /**
     * @notice Converts a given amount of shares to assets
     * @param shares Number of shares to convert to assets
     * @return Amount of assets for the given shares
     */
    function convertToAssets(UFixed18 shares) external view returns (UFixed18) {
        (VersionContext memory context, ) = _loadContextForRead(address(0));
        (context.latestCollateral, context.latestShares) =
            (_totalAssetsAtVersion(context), _totalSupplyAtVersion(context));
        return _convertToAssetsAtVersion(context, shares);
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param account The account that called the operation, or 0 if called by a keeper.
     * @return context The current version context
     */
    function _settle(address account) private returns (VersionContext memory context, VersionContext memory accountContext) {
        (context, accountContext) = _loadContextForWrite(account);

        if (context.version > _latestVersion) {
            _delayedMint(_totalSupplyAtVersion(context).sub(_totalSupply));
            _totalUnclaimed = _totalUnclaimedAtVersion(context);
            _deposit = UFixed18Lib.ZERO;
            _redemption = UFixed18Lib.ZERO;
            _latestVersion = context.version;

            _versions[context.version] = Version({
                longPosition: long.position(address(this)).maker,
                shortPosition: short.position(address(this)).maker,
                totalShares: _totalSupply,
                longAssets: collateral.collateral(address(this), long),
                shortAssets: collateral.collateral(address(this), short),
                totalAssets: _totalAssetsAtVersion(context)
            });
        }

        if (account != address(0) && accountContext.version > _latestVersions[account]) {
            _delayedMintAccount(account, _balanceOfAtVersion(accountContext, account).sub(_balanceOf[account]));
            _unclaimed[account] = _unclaimedAtVersion(accountContext, account);
            _deposits[account] = UFixed18Lib.ZERO;
            _redemptions[account] = UFixed18Lib.ZERO;
            _latestVersions[account] = accountContext.version;
        }
    }

    /**
     * @notice Rebalances the collateral and position of the vault
     * @dev Rebalance is executed on best-effort, any failing legs of the strategy will not cause a revert
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalance(VersionContext memory context, UFixed18 claimAmount) private {
        _rebalanceCollateral(claimAmount);
        _rebalancePosition(context, claimAmount);
    }

    /**
     * @notice Rebalances the collateral of the vault
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalanceCollateral(UFixed18 claimAmount) private {
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        UFixed18 currentCollateral = longCollateral.add(shortCollateral).add(idleCollateral).sub(claimAmount);
        UFixed18 targetCollateral = currentCollateral.div(TWO);
        if (targetCollateral.lt(controller.minCollateral())) targetCollateral = UFixed18Lib.ZERO;

        (IProduct greaterProduct, IProduct lesserProduct) =
            longCollateral.gt(shortCollateral) ? (long, short) : (short, long);

        _updateCollateral(greaterProduct, greaterProduct == long ? longCollateral : shortCollateral, targetCollateral);
        _updateCollateral(lesserProduct, lesserProduct == long ? longCollateral : shortCollateral, targetCollateral);
    }

    /**
     * @notice Rebalances the position of the vault
     */
    function _rebalancePosition(VersionContext memory context, UFixed18 claimAmount) private {
        UFixed18 currentAssets = _totalAssetsAtVersion(context).sub(claimAmount);
        UFixed18 currentUtilized = _totalSupply.add(_redemption).isZero() ?
            _deposit.add(currentAssets) :
            _deposit.add(currentAssets.muldiv(_totalSupply, _totalSupply.add(_redemption)));
        if (currentUtilized.lt(controller.minCollateral().mul(TWO))) currentUtilized = UFixed18Lib.ZERO;

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
     * @notice Moves `amount` shares from `from` to `to`
     * @param from Address to send shares from
     * @param to Address to send shares to
     * @param amount Amount of shares to move
     */
    function _transfer(address from, address to, UFixed18 amount) private {
        _balanceOf[from] = _balanceOf[from].sub(amount);
        _balanceOf[to] = _balanceOf[to].add(amount);
        emit Transfer(from, to, amount);
    }

    /**
     * @notice Burns `amount` shares from `from`, adjusting totalSupply
     * @param from Address to burn shares from
     * @param amount Amount of shares to burn
     */
    function _burn(address from, UFixed18 amount) private {
        _balanceOf[from] = _balanceOf[from].sub(amount);
        _totalSupply = _totalSupply.sub(amount);
        emit Transfer(from, address(0), amount);
    }

    /**
     * @notice Mints `amount` shares, adjusting totalSupply
     * @param amount Amount of shares to mint
     */
    function _delayedMint(UFixed18 amount) private {
        _totalSupply = _totalSupply.add(amount);
    }

    /**
     * @notice Mints `amount` shares to `to`
     * @param to Address to mint shares to
     * @param amount Amount of shares to mint
     */
    function _delayedMintAccount(address to, UFixed18 amount) private {
        _balanceOf[to] = _balanceOf[to].add(amount);
        emit Transfer(address(0), to, amount);
    }

    /**
     * @notice Decrements `spender`s allowance for `account` by `amount`
     * @dev Does not decrement if approval is for -1
     * @param account Address of allower
     * @param spender Address of spender
     * @param amount Amount to decrease allowance by
     */
    function _consumeAllowance(address account, address spender, UFixed18 amount) private {
        if (allowance[account][spender].eq(UFixed18Lib.MAX)) return;
        allowance[account][spender] = allowance[account][spender].sub(amount);
    }

    /**
     * @notice Loads the context for the given `account`, settling the vault first
     * @param account Account to load the context for
     * @return global version context
     * @return account version context
     */
    function _loadContextForWrite(address account) private returns (VersionContext memory, VersionContext memory) {
        long.settleAccount(address(this));
        short.settleAccount(address(this));
        uint256 currentVersion = long.latestVersion(address(this));

        return (
            VersionContext(currentVersion, _assetsAt(_latestVersion), _sharesAt(_latestVersion)),
            VersionContext(currentVersion, _assetsAt(_latestVersions[account]), _sharesAt(_latestVersions[account]))
        );
    }

    /**
     * @notice Loads the context for the given `account`
     * @param account Account to load the context for
     * @return global version context
     * @return account version context
     */
    function _loadContextForRead(address account) private view returns (VersionContext memory, VersionContext memory) {
        uint256 currentVersion = Math.min(long.latestVersion(), short.latestVersion()); // latest version that both products are settled to

        return (
            VersionContext(currentVersion, _assetsAt(_latestVersion), _sharesAt(_latestVersion)),
            VersionContext(currentVersion, _assetsAt(_latestVersions[account]), _sharesAt(_latestVersions[account]))
        );
    }

    /**
     * @notice Calculates whether or not the vault is in an unhealthy state at the provided version
     * @param context Version context to calculate health
     * @return bool true if unhealthy, false if healthy
     */
    function _unhealthyAtVersion(VersionContext memory context) private view returns (bool) {
        return collateral.liquidatable(address(this), long)
            || collateral.liquidatable(address(this), short)
            || long.isLiquidating(address(this))
            || short.isLiquidating(address(this))
            || (!context.latestShares.isZero() && context.latestCollateral.isZero());
    }

    /**
     * @notice The maximum available deposit amount at the given version
     * @param context Version context to use in calculation
     * @return Maximum available deposit amount at version
     */
    function _maxDepositAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (_unhealthyAtVersion(context)) return UFixed18Lib.ZERO;
        UFixed18 currentCollateral = _totalAssetsAtVersion(context).add(_deposit);
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
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        (UFixed18 totalCollateral, UFixed18 totalDebt) =
            (longCollateral.add(shortCollateral).add(idleCollateral), _totalUnclaimedAtVersion(context).add(_deposit));
        return totalCollateral.gt(totalDebt) ? totalCollateral.sub(totalDebt) : UFixed18Lib.ZERO;
    }

    /**
     * @notice The total supply at the given version
     * @param context Version context to use in calculation
     * @return Total supply amount at version
     */
    function _totalSupplyAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (context.version == _latestVersion) return _totalSupply;
        return _totalSupply.add(_convertToSharesAtVersion(context, _deposit));
    }

    /**
     * @notice The balance of `account` at the given version
     * @param accountContext Account version context to use in calculation
     * @param account Account to calculate balance of amount
     * @return Account balance at version
     */
    function _balanceOfAtVersion(VersionContext memory accountContext, address account) private view returns (UFixed18) {
        if (accountContext.version == _latestVersions[account]) return _balanceOf[account];
        return _balanceOf[account].add(_convertToSharesAtVersion(accountContext, _deposits[account]));
    }

    /**
     * @notice The total unclaimed assets at the given version
     * @param context Version context to use in calculation
     * @return Total unclaimed asset amount at version
     */
    function _totalUnclaimedAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (context.version == _latestVersion) return _totalUnclaimed;
        return _totalUnclaimed.add(_convertToAssetsAtVersion(context, _redemption));
    }

    /**
     * @notice The total unclaimed assets at the given version for `account`
     * @param accountContext Account version context to use in calculation
     * @param account Account to calculate unclaimed assets for
     * @return Total unclaimed asset amount for `account` at version
     */
    function _unclaimedAtVersion(VersionContext memory accountContext, address account) private view returns (UFixed18) {
        if (accountContext.version == _latestVersions[account]) return _unclaimed[account];
        return _unclaimed[account].add(_convertToAssetsAtVersion(accountContext, _redemptions[account]));
    }

    /**
     * @notice Returns the amounts of the individual sources of assets in the vault
     * @return The amount of collateral in the long product
     * @return The amount of collateral in the short product
     * @return The amount of collateral idle in the vault contract
     */
    function _collateral() private view returns (UFixed18, UFixed18, UFixed18) {
        return (
            collateral.collateral(address(this), long),
            collateral.collateral(address(this), short),
            asset.balanceOf()
        );
    }

    /**
     * @notice The total assets at the given version
     * @dev Calculates and adds accumulated PnL for `version` + 1
     * @param version Version to get total assets at
     * @return Total assets in the vault at the given version
     */
    function _assetsAt(uint256 version) private view returns (UFixed18) {
        Fixed18 longAccumulated = long.valueAtVersion(version + 1).maker.sub(long.valueAtVersion(version).maker)
            .mul(Fixed18Lib.from(_versions[version].longPosition))
            .max(Fixed18Lib.from(_versions[version].longAssets).mul(Fixed18Lib.NEG_ONE));  // collateral can't go negative on a product
        Fixed18 shortAccumulated = short.valueAtVersion(version + 1).maker.sub(short.valueAtVersion(version).maker)
            .mul(Fixed18Lib.from(_versions[version].shortPosition))
            .max(Fixed18Lib.from(_versions[version].shortAssets).mul(Fixed18Lib.NEG_ONE)); // collateral can't go negative on a product

        return UFixed18Lib.from(
            Fixed18Lib.from(_versions[version].totalAssets)
                .add(longAccumulated)
                .add(shortAccumulated)
                .max(Fixed18Lib.ZERO) // vault can't have negative assets, socializes into unclaimed if triggered
        );
    }

    /**
     * @notice The total shares at the given version
     * @param version Version to get total shares at
     * @return Total shares at `version`
     */
    function _sharesAt(uint256 version) private view returns (UFixed18) {
        return _versions[version].totalShares;
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
