//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./interfaces/IBalancedVault.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

/**
 * @title BalancedVault
 * @notice ERC4626 vault that manages a 50-50 position between long-short markets of the same payoff on Perennial.
 * @dev Vault deploys and rebalances collateral between the corresponding long and short markets, while attempting to
 *      maintain `targetLeverage` with its open positions at any given time. Deposits are only gated in so much as to cap
 *      the maximum amount of assets in the vault.
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
        console.log("sync");
        (VersionContext memory context, ) = _settle(address(0));
        _rebalance(context, UFixed18Lib.ZERO);
    }

    function syncAccount(address account) external {
        console.log("sync account");
        (VersionContext memory context, ) = _settle(account);
        _rebalance(context, UFixed18Lib.ZERO);
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `account` after the deposit settles.
     * @param assets The amount of assets to deposit
     * @param account The account to deposit on behalf of
     */
    function deposit(UFixed18 assets, address account) external {
        console.log("deposit");
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

    function redeem(UFixed18 shares, address account) external {
        console.log("redeem");
        if (msg.sender != account) allowance[account][msg.sender] = allowance[account][msg.sender].sub(shares);

        (VersionContext memory context, VersionContext memory accountContext) = _settle(account);
        if (shares.gt(_maxRedeemAtVersion(context, accountContext, account))) revert BalancedVaultRedemptionLimitExceeded();

        _redemption = _redemption.add(shares);
        _latestVersion = context.version;
        _redemptions[account] = _redemptions[account].add(shares);
        _latestVersions[account] = context.version;
        emit Redemption(msg.sender, account, context.version, shares);

        _balanceOf[account] = _balanceOf[account].sub(shares);
        emit Transfer(account, address(0), shares);

        _rebalance(context, UFixed18Lib.ZERO);
    }

    function claim(address account) external {
        console.log("claim");
        (VersionContext memory context, ) = _settle(account);

        UFixed18 claimAmount = _unclaimed[account];
        _unclaimed[account] = UFixed18Lib.ZERO;
        _totalUnclaimed = _totalUnclaimed.sub(claimAmount);
        emit Claim(msg.sender, account, claimAmount);

        // pro-rate if vault has less collateral than unclaimed
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        UFixed18 totalCollateral = longCollateral.add(shortCollateral).add(idleCollateral);
        if (totalCollateral.lt(_totalUnclaimed)) claimAmount = claimAmount.muldiv(totalCollateral, _totalUnclaimed);

        _rebalance(context, claimAmount);

        asset.push(account, claimAmount);
    }

    function approve(address spender, UFixed18 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, UFixed18 amount) external returns (bool) {
        _settle(msg.sender);
        _balanceOf[msg.sender] = _balanceOf[msg.sender].sub(amount);
        _balanceOf[to] = _balanceOf[to].add(amount);
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, UFixed18 amount) external returns (bool) {
        _settle(from);
        allowance[from][msg.sender] = allowance[from][msg.sender].sub(amount);
        _balanceOf[from] = _balanceOf[from].sub(amount);
        _balanceOf[to] = _balanceOf[to].add(amount);
        emit Transfer(from, to, amount);
        return true;
    }

    function _unhealthyAtVersion(VersionContext memory context) public view returns (bool) {
        return collateral.liquidatable(address(this), long)
            || collateral.liquidatable(address(this), short)
            || long.isLiquidating(address(this))
            || short.isLiquidating(address(this))
            || (!context.latestShares.isZero() && context.latestCollateral.isZero());
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param account The account that called the operation, or 0 if called by a keeper.
     * @return context The current version context
     */
    function _settle(address account) private returns (VersionContext memory context, VersionContext memory accountContext) {
        (context, accountContext) = _loadContextForWrite(account);

        console.log("settling");
        console.log("_totalSupply (before): %s", UFixed18.unwrap(_totalSupply));
        _totalSupply = _totalSupplyAtVersion(context);
        console.log("_totalSupply (after): %s", UFixed18.unwrap(_totalSupply));
        _totalUnclaimed = _totalUnclaimedAtVersion(context);
        console.log("_totalUnclaimed: %s", UFixed18.unwrap(_totalUnclaimed));
        if (context.version > _latestVersion) {
            console.log("version: %s", context.version);
            console.log("totalShares: %s", UFixed18.unwrap(_totalSupply.add(_redemption)));
            console.log("totalAssetsAtVersion: %s", UFixed18.unwrap(_totalAssetsAtVersion(context)));
            console.log("totalAssets: %s", UFixed18.unwrap(_totalAssetsAtVersion(context).sub(_deposit)));
            console.log("longPosition: %s", UFixed18.unwrap(long.position(address(this)).maker));
            console.log("shortPosition: %s", UFixed18.unwrap(short.position(address(this)).maker));
            _versions[context.version] = Version({
                longPosition: long.position(address(this)).maker,
                shortPosition: short.position(address(this)).maker,
                totalShares: _totalSupply,
                totalAssets: _totalAssetsAtVersion(context)
            });

            _deposit = UFixed18Lib.ZERO;
            _redemption = UFixed18Lib.ZERO;
            _latestVersion = context.version;
        }

        if (account != address(0)) {
            console.log("settling account %s", account);
            UFixed18 latestBalanceOf = _balanceOf[account];
            console.log("latestBalanceOf: %s", UFixed18.unwrap(latestBalanceOf));
            _balanceOf[account] = _balanceOfAtVersion(accountContext, account);
            console.log("_balanceOf[account]: %s", UFixed18.unwrap(_balanceOf[account]));
            _unclaimed[account] = _unclaimedAtVersion(accountContext, account);
            if (accountContext.version > _latestVersions[account]) {
                console.log("clearing account %s", account);
                _deposits[account] = UFixed18Lib.ZERO;
                _redemptions[account] = UFixed18Lib.ZERO;
                _latestVersions[account] = accountContext.version;
            }

            if (!_balanceOf[account].eq(latestBalanceOf))
                emit Transfer(address(0), account, _balanceOf[account].sub(latestBalanceOf));
        }
    }

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

    function totalSupply() external view returns (UFixed18) {
        (VersionContext memory context, ) = _loadContextForRead(address(0));
        return _totalSupplyAtVersion(context);
    }

    function balanceOf(address account) external view returns (UFixed18) {
        (, VersionContext memory accountContext) = _loadContextForRead(account);
        return _balanceOfAtVersion(accountContext, account);
    }

    function totalUnclaimed() external view returns (UFixed18) {
        (VersionContext memory context, ) = _loadContextForRead(address(0));
        return _totalUnclaimedAtVersion(context);
    }

    function unclaimed(address account) external view returns (UFixed18) {
        (, VersionContext memory accountContext) = _loadContextForRead(account);
        return _unclaimedAtVersion(accountContext, account);
    }

    function convertToShares(UFixed18 assets) external view returns (UFixed18) {
        (VersionContext memory context, ) = _loadContextForRead(address(0));
        return _convertToSharesAtVersion(context, assets);
    }

    function convertToAssets(UFixed18 shares) external view returns (UFixed18) {
        (VersionContext memory context, ) = _loadContextForRead(address(0));
        return _convertToAssetsAtVersion(context, shares);
    }

    /**
 * @notice Rebalances the collateral and position of the vault
     * @dev Rebalance is executed on best-effort, any failing legs of the strategy will not cause a revert
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalance(VersionContext memory context, UFixed18 claimAmount) private {
        console.log("_rebalance");
        _rebalanceCollateral(claimAmount);
        _rebalancePosition(context, claimAmount);
    }

    /**
     * @notice Rebalances the collateral of the vault
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalanceCollateral(UFixed18 claimAmount) private {
        console.log("_rebalanceCollateral");
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        UFixed18 currentCollateral = longCollateral.add(shortCollateral).add(idleCollateral).sub(claimAmount);
        UFixed18 targetCollateral = currentCollateral.div(TWO);
        if (targetCollateral.lt(controller.minCollateral())) targetCollateral = UFixed18Lib.ZERO;

        console.log("currentCollateral: %s", UFixed18.unwrap(currentCollateral));
        console.log("targetCollateral: %s", UFixed18.unwrap(targetCollateral));

        (IProduct greaterProduct, IProduct lesserProduct) =
            longCollateral.gt(shortCollateral) ? (long, short) : (short, long);

        _updateCollateral(greaterProduct, targetCollateral);
        _updateCollateral(lesserProduct, targetCollateral);
    }

    /**
     * @notice Rebalances the position of the vault
     */
    function _rebalancePosition(VersionContext memory context, UFixed18 claimAmount) private {
        console.log("_rebalancePosition");
        UFixed18 currentAssets = _totalAssetsAtVersion(context).sub(claimAmount);
        console.log("currentAssets: %s", UFixed18.unwrap(currentAssets));
        if (currentAssets.lt(controller.minCollateral().mul(TWO))) currentAssets = UFixed18Lib.ZERO;
        console.log("currentAssets: %s", UFixed18.unwrap(currentAssets));

        console.log("_redemption: %s", UFixed18.unwrap(_redemption));
        UFixed18 currentUtilized = _totalSupply.isZero() ?
            currentAssets :
            currentAssets.muldiv(_totalSupply.sub(_redemption), _totalSupply);
        console.log("currentUtilized: %s", UFixed18.unwrap(currentUtilized));
        UFixed18 currentPrice = long.atVersion(context.version).price.abs();
        console.log("currentPrice: %s", UFixed18.unwrap(currentPrice));
        UFixed18 targetPosition = currentUtilized.mul(targetLeverage).div(currentPrice).div(TWO);
        console.log("targetPosition: %s", UFixed18.unwrap(targetPosition));

        _updateMakerPosition(long, targetPosition);
        _updateMakerPosition(short, targetPosition);
    }

    /**
     * @notice Adjusts the collateral on `product` to `targetCollateral`
     * @param product The product to adjust the vault's collateral on
     * @param targetCollateral The new collateral to target
     */
    function _updateCollateral(IProduct product, UFixed18 targetCollateral) private {
        console.log("_updateCollateral");
        UFixed18 currentCollateral = collateral.collateral(address(this), product);

        console.log("currentCollateral: %s", UFixed18.unwrap(currentCollateral));
        console.log("targetCollateral: %s", UFixed18.unwrap(targetCollateral));

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
        console.log("_updateMakerPosition");
        UFixed18 currentPosition = product.position(address(this)).next(product.pre(address(this))).maker;
        UFixed18 currentMaker = product.positionAtVersion(product.latestVersion()).next(product.pre()).maker;
        UFixed18 makerLimit = product.makerLimit();
        UFixed18 makerAvailable = makerLimit.gt(currentMaker) ? makerLimit.sub(currentMaker) : UFixed18Lib.ZERO;
        console.log("targetPosition: %s", UFixed18.unwrap(targetPosition));
        console.log("currentPosition: %s", UFixed18.unwrap(currentPosition));
        console.log("makerAvailable: %s", UFixed18.unwrap(makerAvailable));

        if (targetPosition.lt(currentPosition))
            product.closeMake(currentPosition.sub(targetPosition));
        if (targetPosition.gt(currentPosition))
            product.openMake(targetPosition.sub(currentPosition).min(makerAvailable));

        emit PositionUpdated(product, targetPosition);
    }

    function _loadContextForWrite(address account) private returns (VersionContext memory, VersionContext memory) {
        long.settleAccount(address(this));
        short.settleAccount(address(this));
        uint256 currentVersion = long.latestVersion(address(this));
        console.log("latestVersion: %s", _latestVersion);
        console.log("currentVersion: %s", currentVersion);

        return (
            VersionContext(currentVersion, _assetsAt(_latestVersion), _sharesAt(_latestVersion)),
            VersionContext(currentVersion, _assetsAt(_latestVersions[account]), _sharesAt(_latestVersions[account]))
        );
    }

    function _loadContextForRead(address account) private view returns (VersionContext memory, VersionContext memory) {
        uint256 currentVersion = Math.min(long.latestVersion(), short.latestVersion()); // latest version that both products are settled to

        return (
            VersionContext(currentVersion, _assetsAt(_latestVersion), _sharesAt(_latestVersion)),
            VersionContext(currentVersion, _assetsAt(_latestVersions[account]), _sharesAt(_latestVersions[account]))
        );
    }

    function _maxDepositAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (_unhealthyAtVersion(context)) return UFixed18Lib.ZERO;
        UFixed18 currentCollateral = _totalAssetsAtVersion(context);
        return maxCollateral.gt(currentCollateral) ? maxCollateral.sub(currentCollateral) : UFixed18Lib.ZERO;
    }

    function _maxRedeemAtVersion(
        VersionContext memory context,
        VersionContext memory accountContext,
        address account
    ) public view returns (UFixed18) {
        if (_unhealthyAtVersion(context)) return UFixed18Lib.ZERO;
        return _balanceOfAtVersion(accountContext, account);
    }

    function _totalAssetsAtVersion(VersionContext memory context) private view returns (UFixed18) {
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        (UFixed18 totalCollateral, UFixed18 totalDebt) =
            (longCollateral.add(shortCollateral).add(idleCollateral), _totalUnclaimedAtVersion(context));
        return totalCollateral.gt(totalDebt) ? totalCollateral.sub(totalDebt) : UFixed18Lib.ZERO;
    }

    function _totalSupplyAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (context.version == _latestVersion) return _totalSupply;
        return _totalSupply.add(_convertToSharesAtVersion(context, _deposit));
    }

    function _balanceOfAtVersion(VersionContext memory accountContext, address account) private view returns (UFixed18) {
        if (accountContext.version == _latestVersions[account]) return _balanceOf[account];
        console.log("not zero");
        return _balanceOf[account].add(_convertToSharesAtVersion(accountContext, _deposits[account]));
    }

    function _totalUnclaimedAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (context.version == _latestVersion) return _totalUnclaimed;
        return _totalUnclaimed.add(_convertToAssetsAtVersion(context, _redemption));
    }

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

    function _assetsAt(uint256 version) private view returns (UFixed18) {
        Fixed18 longAccumulated = long.valueAtVersion(version + 1).maker.sub(long.valueAtVersion(version).maker);
        Fixed18 shortAccumulated = short.valueAtVersion(version + 1).maker.sub(short.valueAtVersion(version).maker);

        Fixed18 accumulated = longAccumulated.mul(Fixed18Lib.from(_versions[version].longPosition))
            .add(shortAccumulated.mul(Fixed18Lib.from(_versions[version].shortPosition)));

        return UFixed18Lib.from(Fixed18Lib.from(_versions[version].totalAssets).add(accumulated).max(Fixed18Lib.ZERO));
    }

    function _sharesAt(uint256 version) private view returns (UFixed18) {
        return _versions[version].totalShares;
    }

    function _convertToSharesAtVersion(VersionContext memory context, UFixed18 assets) private view returns (UFixed18) {
        console.log("assets: %s", UFixed18.unwrap(assets));
        console.log("context.latestCollateral: %s", UFixed18.unwrap(context.latestCollateral));
        console.log("context.latestShares: %s", UFixed18.unwrap(context.latestShares));
        if (context.latestCollateral.isZero()) return assets;
        return assets.muldiv(context.latestShares, context.latestCollateral);
    }

    function _convertToAssetsAtVersion(VersionContext memory context, UFixed18 shares) private pure returns (UFixed18) {
        if (context.latestShares.isZero()) return shares;
        return shares.muldiv(context.latestCollateral, context.latestShares);
    }
}
