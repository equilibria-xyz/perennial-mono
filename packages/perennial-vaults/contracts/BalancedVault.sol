//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./interfaces/IBalancedVault.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

// TODO: what to do if zero-balance w/ non-zero shares on deposit?
// TODO: .div by zero in settles
// TODO: unclaimed larder than collateral?
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

    function initialize() external initializer(1) {
        asset.approve(address(collateral));
    }

    /**
     * @notice Rebalances the collateral and position of the vault without a deposit or withdraw
     * @dev Should be called by a keeper when the vault approaches a liquidation state on either side
     */
    function sync() external {
        VersionContext memory context = _settle(address(0));
        _rebalance(context.version, UFixed18Lib.ZERO);
        _rebalance(context.version, UFixed18Lib.ZERO);
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `receiver` after the deposit settles.
     * @param assets The amount of assets to deposit
     * @param receiver The account to deposit on behalf of
     */
    function deposit(UFixed18 assets, address receiver) external {
        VersionContext memory context = _settle(receiver);
        if (assets.gt(_maxDepositAtVersion(context))) revert BalancedVaultDepositLimitExceeded();

        _deposit = _deposit.add(assets);
        _deposits[receiver] = _deposits[receiver].add(assets);
        _latestVersions[receiver] = context.version;

        asset.pull(msg.sender, assets);

        _rebalance(context.version, UFixed18Lib.ZERO);
    }

    function redeem(UFixed18 shares, address, address owner) external {
        if (msg.sender != owner) allowance[owner][msg.sender] = allowance[owner][msg.sender].sub(shares);

        VersionContext memory context = _settle(owner);
        if (shares.gt(_maxRedeemAtVersion(owner, context))) revert BalancedVaultRedemptionLimitExceeded();

        _redemption = _redemption.add(shares);
        _redemptions[owner] = _redemptions[owner].add(shares);
        _latestVersions[owner] = context.version;

        _balanceOf[owner] = _balanceOf[owner].sub(shares);

        _rebalance(context.version, UFixed18Lib.ZERO);
    }

    function claim(address owner) external {
        VersionContext memory context = _settle(owner);

        UFixed18 claimAmount = _unclaimed[owner];
        _unclaimed[owner] = UFixed18Lib.ZERO;
        _totalUnclaimed = _totalUnclaimed.sub(claimAmount);

        _rebalance(context.version, claimAmount);

        asset.push(owner, claimAmount);
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

    /**
     * @notice Returns whether the vault's are currently in liquidation or are eligible to be
     * @return Whether the vault is currently unhealthy
     */
    function unhealthy() public view returns (bool) {
        return collateral.liquidatable(address(this), long)
            || collateral.liquidatable(address(this), short)
            || long.isLiquidating(address(this))
            || short.isLiquidating(address(this));
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param account The account that called the operation, or 0 if called by a keeper.
     * @return context The current version context
     */
    function _settle(address account) private returns (VersionContext memory context) {
        context = _loadContextForWrite();

        if (context.version > context.latestVersion) {
            _totalSupply = _totalSupplyAtVersion(context);
            _totalUnclaimed = _totalUnclaimedAtVersion(context);
            _deposits[account] = UFixed18Lib.ZERO;
            _redemptions[account] = UFixed18Lib.ZERO;
        }

        if (account != address(0) && context.version > _latestVersions[account]) {
            _balanceOf[account] = _balanceOfAtVersion(account, context);
            _unclaimed[account] = _unclaimedAtVersion(account, context);
            _deposit = UFixed18Lib.ZERO;
            _redemption = UFixed18Lib.ZERO;
        }

        _versions[context.version] = Version({
            longPosition: long.positionAtVersion(context.version).maker,
            shortPosition: short.positionAtVersion(context.version).maker,
            totalShares: _totalSupply,
            totalCollateral: _collateralAt(context.version)
        });
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @return Maximum available deposit amount
     */
    function maxDeposit(address) external view returns (UFixed18) {
        return _maxDepositAtVersion(_loadContextForRead());
    }

    /**
     * @notice The maximum available redeemable amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param owner The account to redeem for
     * @return Maximum available redeemable amount
     */
    function maxRedeem(address owner) external view returns (UFixed18) {
        return _maxRedeemAtVersion(owner, _loadContextForRead());
    }

    /**
     * @notice The total amount of assets currently held by the vault
     * @return Amount of assets held by the vault
     */
    function totalAssets() external view returns (UFixed18) {
        return _totalAssetsAtVersion(_loadContextForRead());
    }

    function totalSupply() external view returns (UFixed18) {
        return _totalSupplyAtVersion(_loadContextForRead());
    }

    function balanceOf(address account) external view returns (UFixed18) {
        return _balanceOfAtVersion(account, _loadContextForRead());
    }

    function totalUnclaimed() external view returns (UFixed18) {
        return _totalUnclaimedAtVersion(_loadContextForRead());
    }

    function unclaimed(address account) external view returns (UFixed18) {
        return _unclaimedAtVersion(account, _loadContextForRead());
    }

    function _loadContextForRead() private view returns (VersionContext memory) {
        uint256 latestVersion = _latestVersion();
        uint256 currentVersion = Math.min(long.latestVersion(), short.latestVersion()); // latest version that both products are settled to

        return VersionContext(currentVersion, latestVersion, _collateralAt(latestVersion), _versions[latestVersion].totalShares);
    }

    function _loadContextForWrite() private returns (VersionContext memory) {
        uint256 latestVersion = _latestVersion();
        long.settleAccount(address(this));
        short.settleAccount(address(this));
        uint256 currentVersion = _latestVersion();

        return VersionContext(currentVersion, latestVersion, _collateralAt(latestVersion), _versions[latestVersion].totalShares);
    }

    function _latestVersion() private view returns (uint256) {
        return long.latestVersion(address(this)); // both products are always settled at the same time for the vault
    }

    function _maxDepositAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (unhealthy()) return UFixed18Lib.ZERO;
        UFixed18 currentCollateral = _totalAssetsAtVersion(context);
        return currentCollateral.gt(maxCollateral) ? maxCollateral.sub(currentCollateral) : UFixed18Lib.ZERO;
    }

    function _maxRedeemAtVersion(address account, VersionContext memory context) public view returns (UFixed18) {
        if (unhealthy()) return UFixed18Lib.ZERO;
        return _balanceOfAtVersion(account, context);
    }

    function _totalAssetsAtVersion(VersionContext memory context) private view returns (UFixed18) {
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        return longCollateral.add(shortCollateral).add(idleCollateral).sub(_totalUnclaimedAtVersion(context));
    }

    function _totalSupplyAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (_deposit.isZero() || context.version == _latestVersion()) return _totalSupply;
        return _totalSupply.add(_deposit.muldiv(context.latestCollateral, context.latestShares));
    }

    function _balanceOfAtVersion(address account, VersionContext memory context) private view returns (UFixed18) {
        if (_deposits[account].isZero() || context.version == _latestVersions[account]) return _balanceOf[account];
        return _balanceOf[account].add(_deposits[account].muldiv(context.latestCollateral, context.latestShares));
    }

    function _totalUnclaimedAtVersion(VersionContext memory context) private view returns (UFixed18) {
        if (_redemption.isZero() || context.version == _latestVersion()) return _totalUnclaimed;
        return _totalUnclaimed.add(_redemption.muldiv(context.latestShares, context.latestCollateral));
    }

    function _unclaimedAtVersion(address account, VersionContext memory context) private view returns (UFixed18) {
        if (_redemptions[account].isZero() || context.version == _latestVersions[account]) return _unclaimed[account];
        return _unclaimed[account].add(_redemptions[account].muldiv(context.latestShares, context.latestCollateral));
    }

    /**
     * @notice Rebalances the collateral and position of the vault
     * @dev Rebalance is executed on best-effort, any failing legs of the strategy will not cause a revert
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalance(uint256 version, UFixed18 claimAmount) private {
        _rebalanceCollateral(claimAmount);
        _rebalancePosition(version);
    }

    /**
     * @notice Rebalances the collateral of the vault
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalanceCollateral(UFixed18 claimAmount) private {
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        UFixed18 currentCollateral = longCollateral.add(shortCollateral).add(idleCollateral);
        UFixed18 targetCollateral = currentCollateral.sub(claimAmount).div(TWO);
        if (targetCollateral.lt(controller.minCollateral())) targetCollateral = UFixed18Lib.ZERO;

        (IProduct greaterProduct, IProduct lesserProduct) =
            longCollateral.gt(shortCollateral) ? (long, short) : (short, long);

        _updateCollateral(greaterProduct, targetCollateral);
        _updateCollateral(lesserProduct, currentCollateral.sub(targetCollateral));
    }

    /**
     * @notice Rebalances the position of the vault
     */
    function _rebalancePosition(uint256 version) private {
        (UFixed18 longCollateral, UFixed18 shortCollateral, ) = _collateral();
        UFixed18 currentAssets = longCollateral.add(shortCollateral).sub(_totalUnclaimed); // don't include idle funds due to minCollateral
        UFixed18 currentUtilized = _totalSupply.muldiv(currentAssets, _totalSupply.add(_redemption));
        UFixed18 currentPrice = long.atVersion(version).price.abs();
        UFixed18 targetPosition = currentUtilized.mul(targetLeverage).div(currentPrice).div(TWO);

        _updateMakerPosition(long, targetPosition);
        _updateMakerPosition(short, targetPosition);
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
            try product.closeMake(currentPosition.sub(targetPosition)) { }
            catch { return; }
        if (targetPosition.gt(currentPosition))
            try product.openMake(targetPosition.sub(currentPosition).min(makerAvailable)) { }
            catch { return; }

        emit PositionUpdated(product, targetPosition);
    }

    /**
     * @notice Adjusts the collateral on `product` to `targetCollateral`
     * @param product The product to adjust the vault's collateral on
     * @param targetCollateral The new collateral to target
     */
    function _updateCollateral(IProduct product, UFixed18 targetCollateral) private {
        UFixed18 currentCollateral = collateral.collateral(address(this), product);

        if (currentCollateral.gt(targetCollateral))
            try collateral.withdrawTo(address(this), product, currentCollateral.sub(targetCollateral)) { }
            catch { return; }
        if (currentCollateral.lt(targetCollateral))
            try collateral.depositTo(address(this), product, targetCollateral.sub(currentCollateral)) { }
            catch { return; }

        emit CollateralUpdated(product, targetCollateral);
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

    function _collateralAt(uint256 version) private view returns (UFixed18) {
        Fixed18 longAccumulated = long.valueAtVersion(version + 1).maker.sub(long.valueAtVersion(version).maker);
        Fixed18 shortAccumulated = short.valueAtVersion(version + 1).maker.sub(short.valueAtVersion(version).maker);

        Fixed18 accumulated = longAccumulated.mul(Fixed18Lib.from(_versions[version].longPosition))
        .add(shortAccumulated.mul(Fixed18Lib.from(_versions[version].shortPosition)));

        return UFixed18Lib.from(Fixed18Lib.from(_versions[version].totalCollateral).add(accumulated).max(Fixed18Lib.ZERO));
    }
}
