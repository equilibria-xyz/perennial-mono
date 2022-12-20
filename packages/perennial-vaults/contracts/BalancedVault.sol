//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@equilibria/root/token/types/Token18.sol";
import "./interfaces/IBalancedVault.sol";

//TODO(required): natspec
//TODO(required): events, errors
//TODO(nice to have): pausable
//TODO(nice to have): incentivize sync when near liquidation
//TODO(nice to have): create collateral rebalance buffer so it doesn't need to every time
contract BalancedVault is IBalancedVault, ERC4626Upgradeable {
    UFixed18 constant private TWO = UFixed18.wrap(2e18);

    IController public immutable controller;
    ICollateral public immutable collateral;
    IProduct public immutable long;
    IProduct public immutable short;
    UFixed18 public immutable targetLeverage;
    UFixed18 public immutable maxLeverage;
    UFixed18 public immutable fixedFloat;
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
        require(maxLeverage_.gt(targetLeverage_), "max leverage must be greater than leverage");

        controller = controller_;
        collateral = controller.collateral();
        long = long_;
        short = short_;
        targetLeverage = targetLeverage_;
        maxLeverage = maxLeverage_;
        fixedFloat = fixedFloat_;
        maxCollateral = maxCollateral_;
    }

    function initialize(IERC20Upgradeable dsu_) external initializer {
        __ERC20_init(
            string(abi.encodePacked("Perennial Balanced Vault: ", long.name())),
            string(abi.encodePacked("PBV-", long.symbol()))
        );
        __ERC4626_init(dsu_);

        dsu_.approve(address(collateral), type(uint256).max);
    }

    function sync() external {
        _before();
        _update(UFixed18Lib.ZERO);
    }

    function totalAssets() public override view returns (uint256) {
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        return UFixed18.unwrap(longCollateral.add(shortCollateral).add(idleCollateral));
    }

    // Precondition: Assumes the collateral is balanced and the positions have equal size.
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

    function maxDeposit(address owner) public view override returns (uint256) {
        UFixed18 currentCollateral = UFixed18.wrap(totalAssets());
        UFixed18 availableDeposit = currentCollateral.gt(maxCollateral) ?
            UFixed18Lib.ZERO :
            maxCollateral.sub(currentCollateral);

        return Math.min(super.maxDeposit(owner), UFixed18.unwrap(availableDeposit));
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        _before();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override returns (uint256) {
        _before();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        _before();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        _before();
        return super.redeem(shares, receiver, owner);
    }

    // Returns whether the vault's positions have not been liquidated or are eligible for liquidation.
    function healthy() public view returns (bool) {
        (bool isLongZero, bool isShortZero) =
            (long.position(address(this)).maker.isZero(), short.position(address(this)).maker.isZero());
        return isLongZero == isShortZero;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        _update(UFixed18Lib.ZERO);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal override {
        _update(UFixed18.wrap(assets));
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _before() private {
        long.settleAccount(address(this));
        short.settleAccount(address(this));
    }

    function _update(UFixed18 withdrawalAmount) private {
        // Rebalance collateral if possible
        bool rebalanced = _updateCollateral(withdrawalAmount);

        // Rebalance position if healthy
        if (!healthy() || !rebalanced) _reset();
        else _updatePosition(withdrawalAmount);
    }

    function _reset() private {
        _adjustPosition(long, UFixed18Lib.ZERO);
        _adjustPosition(short, UFixed18Lib.ZERO);
    }

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

    // Precondition: the difference in collateral between long and short is at most 1.
    function _updatePosition(UFixed18 withdrawalAmount) private {
        // 1. Calculate the target position size for each product.
        UFixed18 currentCollateral = UFixed18.wrap(totalAssets()).sub(withdrawalAmount);
        UFixed18 currentUtilized = currentCollateral.gt(fixedFloat) ? currentCollateral.sub(fixedFloat) : UFixed18Lib.ZERO;
        UFixed18 currentPrice = long.atVersion(long.latestVersion()).price.abs();
        UFixed18 targetPosition = currentUtilized.mul(targetLeverage).div(currentPrice).div(TWO);

        // 2. Adjust positions to target position size.
        _adjustPosition(long, targetPosition);
        _adjustPosition(short, targetPosition);
    }

    function _adjustPosition(IProduct product, UFixed18 targetPosition) private {
        UFixed18 currentPosition = product.position(address(this)).next(product.pre(address(this))).maker;
        UFixed18 currentMaker = product.positionAtVersion(product.latestVersion()).next(product.pre()).maker;
        UFixed18 makerLimit = product.makerLimit();

        if (currentPosition.gt(targetPosition)) product.closeMake(currentPosition.sub(targetPosition));
        if (currentPosition.lt(targetPosition))
            product.openMake(targetPosition.sub(currentPosition).min(makerLimit.sub(currentMaker)));
    }

    function _adjustCollateral(IProduct product, UFixed18 targetCollateral) private returns (bool) {
        UFixed18 currentCollateral = collateral.collateral(address(this), product);
        if (currentCollateral.gt(targetCollateral))
            try collateral.withdrawTo(address(this), product, currentCollateral.sub(targetCollateral)) { }
            catch { return false; }
        if (currentCollateral.lt(targetCollateral))
            try collateral.depositTo(address(this), product, targetCollateral.sub(currentCollateral)) { }
            catch { return false; }
        return true;
    }

    function _collateral() private view returns (UFixed18, UFixed18, UFixed18) {
        return (
            collateral.collateral(address(this), long),
            collateral.collateral(address(this), short),
            Token18.wrap(asset()).balanceOf()
        );
    }
}
