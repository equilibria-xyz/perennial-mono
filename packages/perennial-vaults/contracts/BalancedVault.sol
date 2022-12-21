//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@equilibria/root/token/types/Token18.sol";
import "./interfaces/IBalancedVault.sol";

/**
 * @title BalancedVault
 * @notice ERC4626 vault that manages a 50-50 position between long-short markets of the same payoff on Perennial.
 * @dev Vault deploys and rebalances collateral between the corresponding long and short markets, while attempting to
 *      maintain `targetLeverage` with its open positions at any given time. Withdrawals are gated by ensuring that
 *      leverage never exceeds `maxLeverage`. Deposits are only gated in so much as to cap the maximum amount of assets
 *      in the vault. A `fixedFloat` amount of assets are virtually set aside from the leverage calculation to ensure a
 *      fixed lower bound of assets are always allowed to be withdrawn from the vault.
 */
contract BalancedVault is IBalancedVault, ERC4626Upgradeable {
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

    /// @dev The maximum leverage amount for the vault
    UFixed18 public immutable maxLeverage;

    /// @dev The fixed amount that is "set aside" and not counted towards leverage calculations
    UFixed18 public immutable fixedFloat;

    /// @dev The collateral cap for the vault
    UFixed18 public immutable maxCollateral;

    constructor(
        IController controller_,
        IProduct long_,
        IProduct short_,
        UFixed18 targetLeverage_,
        UFixed18 maxLeverage_,
        UFixed18 fixedFloat_,
        UFixed18 maxCollateral_
    ) {
        if (targetLeverage_.gt(maxLeverage_)) revert BalancedVaultInvalidMaxLeverage();

        controller = controller_;
        collateral = controller.collateral();
        long = long_;
        short = short_;
        targetLeverage = targetLeverage_;
        maxLeverage = maxLeverage_;
        fixedFloat = fixedFloat_;
        maxCollateral = maxCollateral_;
    }

    /**
     * @notice Initializes the contract
     * @param dsu_ The contract address of the DSU stablecoin
     */
    function initialize(IERC20Upgradeable dsu_) external initializer {
        __ERC20_init(
            string(abi.encodePacked("Perennial Balanced Vault: ", long.name())),
            string(abi.encodePacked("PBV-", long.symbol()))
        );
        __ERC4626_init(dsu_);

        dsu_.approve(address(collateral), type(uint256).max);
    }

    /**
     * @notice Rebalances the collateral and position of the vault without a deposit or withdraw
     * @dev Should be called by a keeper when the vault approaches a liquidation state on either side
     */
    function sync() external {
        _before();
        _update(UFixed18Lib.ZERO);
    }

    /**
     * @notice The total amount of assets currently held by the vault
     * @return Amount of assets held by the vault
     */
    function totalAssets() public override view returns (uint256) {
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        return UFixed18.unwrap(longCollateral.add(shortCollateral).add(idleCollateral));
    }

    /**
     * @notice The maximum available withdrawal amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param owner The account to withdraw for
     * @return Maximum available withdrawal amount
     */
    function maxWithdraw(address owner) public view override returns (uint256) {
        // If we're in the middle of closing all positions due to liquidations, return 0.
        if (!healthy()) return 0;

        // Calculate the minimum amount of collateral we can have.
        UFixed18 price = long.atVersion(long.latestVersion()).price.abs();
        UFixed18 position = long.position(address(this)).maker;

        // Calculate the minimum collateral for one product, which represents having a leverage of `maxLeverage`.
        UFixed18 minimumCollateral = position.mul(price).div(maxLeverage).mul(TWO);
        UFixed18 currentCollateral = UFixed18.wrap(totalAssets());
        if (currentCollateral.lt(minimumCollateral)) return 0;

        return Math.min(super.maxWithdraw(owner), UFixed18.unwrap(currentCollateral.sub(minimumCollateral)));
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param owner The account to deposit for
     * @return Maximum available deposit amount
     */
    function maxDeposit(address owner) public view override returns (uint256) {
        UFixed18 currentCollateral = UFixed18.wrap(totalAssets());
        UFixed18 availableDeposit = currentCollateral.gt(maxCollateral) ?
            UFixed18Lib.ZERO :
            maxCollateral.sub(currentCollateral);

        return Math.min(super.maxDeposit(owner), UFixed18.unwrap(availableDeposit));
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `receiver`
     * @param assets The amount of assets to deposit
     * @param receiver The account to receive the shares
     * @return The amount of shares returned to `receiver`
     */
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        _before();
        return super.deposit(assets, receiver);
    }

    /**
     * @notice Deposits `shares` worth of assets into the vault, returning shares to `receiver`
     * @param shares The amount of shares worth of assets to deposit
     * @param receiver The account to receive the shares
     * @return The amount of assets taken from `receiver`
     */
    function mint(uint256 shares, address receiver) public override returns (uint256) {
        _before();
        return super.mint(shares, receiver);
    }

    /**
     * @notice Withdraws `assets` assets from the vault, returning assets to `receiver`
     * @param assets The amount of assets to withdraw
     * @param owner The account to withdraw for (must be sender or approved)
     * @param receiver The account to receive the withdrawn assets
     * @return The amount of shares taken from `receiver`
     */
    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        _before();
        return super.withdraw(assets, receiver, owner);
    }

    /**
     * @notice Withdraws `shares` worth of assets into the vault, returning assets to `receiver`
     * @param shares The amount of shares worth of assets to withdraw
     * @param owner The account to withdraw for (must be sender or approved)
     * @param receiver The account to receive the withdrawn assets
     * @return The amount of assets returned to `receiver`
     */
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        _before();
        return super.redeem(shares, receiver, owner);
    }

    /**
     * @notice Returns whether the vault's positions have been been recently liquidated
     * @dev If one product's position is zero while the other is non-zero, this indicates a recent liquidation
     * @return Whether the vault is healthy
     */
    function healthy() public view returns (bool) {
        (bool isLongZero, bool isShortZero) =
            (long.position(address(this)).maker.isZero(), short.position(address(this)).maker.isZero());
        return isLongZero == isShortZero;
    }

    /**
     * @notice Deposits `assets` assets from `caller`, sending `shares` shares to `receiver`
     * @param caller The account that called the deposit
     * @param receiver The account to receive the shares
     * @param assets The amount of assets to deposit
     * @param shares The amount of shares to receive
     */
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        _update(UFixed18Lib.ZERO);
    }

    /**
     * @notice Withdraws `assets` assets to `receiver`, taking `shares` shares from `owner`
     * @param caller The account that called the withdraw
     * @param receiver The account to receive the withdrawn assets
     * @param owner The account to withdraw for (must be caller or approved)
     * @param assets The amount of assets to withdraw
     * @param shares The amount of shares to be taken
     */
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal override {
        _update(UFixed18.wrap(assets));
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product
     */
    function _before() private {
        long.settleAccount(address(this));
        short.settleAccount(address(this));
    }

    /**
     * @notice Updates the vault's collateral and position given its current balance and parameters
     * @param withdrawalAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _update(UFixed18 withdrawalAmount) private {
        // Rebalance collateral if possible
        bool rebalanced = _updateCollateral(withdrawalAmount);

        // Rebalance position if healthy
        if (!healthy() || !rebalanced) _reset();
        else _updatePosition(withdrawalAmount);
    }

    /**
     * @notice Resets the position of the vault to zero
     * @dev Called when an unhealthy state is detected
     */
    function _reset() private {
        _adjustPosition(long, UFixed18Lib.ZERO);
        _adjustPosition(short, UFixed18Lib.ZERO);

        emit PositionUpdated(UFixed18Lib.ZERO);
    }

    /**
     * @notice Rebalances the collateral of the vault
     * @dev Does not revert when rebalance fails, returns false instead allowing the vault to reset
     * @param withdrawalAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     * @return Whether the rebalance occurred successfully
     */
    function _updateCollateral(UFixed18 withdrawalAmount) private returns (bool) {
        (UFixed18 longCollateral, UFixed18 shortCollateral, ) = _collateral();
        UFixed18 currentCollateral = UFixed18.wrap(totalAssets()).sub(withdrawalAmount);
        UFixed18 targetCollateral = currentCollateral.div(TWO);

        (IProduct greaterProduct, IProduct lesserProduct) = longCollateral.gt(shortCollateral) ?
            (long, short) :
            (short, long);

        return _adjustCollateral(greaterProduct, targetCollateral) &&
            _adjustCollateral(lesserProduct, currentCollateral.sub(targetCollateral));
    }

    /**
     * @notice Re-targets the positions of the vault
     * @param withdrawalAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _updatePosition(UFixed18 withdrawalAmount) private {
        // 1. Calculate the target position size for each product.
        UFixed18 currentCollateral = UFixed18.wrap(totalAssets()).sub(withdrawalAmount);
        UFixed18 currentUtilized = currentCollateral.gt(fixedFloat) ? currentCollateral.sub(fixedFloat) : UFixed18Lib.ZERO;
        UFixed18 currentPrice = long.atVersion(long.latestVersion()).price.abs();
        UFixed18 targetPosition = currentUtilized.mul(targetLeverage).div(currentPrice).div(TWO);

        // 2. Adjust positions to target position size.
        _adjustPosition(long, targetPosition);
        _adjustPosition(short, targetPosition);

        emit PositionUpdated(targetPosition);
    }

    /**
     * @notice Adjusts the position on `product` to `targetPosition`
     * @param product The product to adjust the vault's position on
     * @param targetPosition The new position to target
     */
    function _adjustPosition(IProduct product, UFixed18 targetPosition) private {
        UFixed18 currentPosition = product.position(address(this)).next(product.pre(address(this))).maker;
        UFixed18 currentMaker = product.positionAtVersion(product.latestVersion()).next(product.pre()).maker;
        UFixed18 makerLimit = product.makerLimit();

        if (currentPosition.gt(targetPosition)) product.closeMake(currentPosition.sub(targetPosition));
        if (currentPosition.lt(targetPosition))
            product.openMake(targetPosition.sub(currentPosition).min(makerLimit.sub(currentMaker)));
    }

    /**
     * @notice Adjusts the collateral on `product` to `targetCollateral`
     * @param product The product to adjust the vault's collateral on
     * @param targetCollateral The new collateral to target
     * @return Whether the collateral adjust succeeded
     */
    function _adjustCollateral(IProduct product, UFixed18 targetCollateral) private returns (bool) {
        UFixed18 currentCollateral = collateral.collateral(address(this), product);
        if (currentCollateral.gt(targetCollateral))
            try collateral.withdrawTo(address(this), product, currentCollateral.sub(targetCollateral)) { }
            catch { return false; }
        if (currentCollateral.lt(targetCollateral))
            try collateral.depositTo(address(this), product, targetCollateral.sub(currentCollateral)) { }
            catch { return false; }

        emit CollateralUpdated(product, targetCollateral);
        return true;
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
            Token18.wrap(asset()).balanceOf()
        );
    }
}
