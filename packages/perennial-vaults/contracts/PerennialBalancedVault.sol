//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15; //TODO: fix after https://trello.com/c/EU1TJxCv/182-fix-pragma-version-in-payoffdefinition-type

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@equilibria/perennial/contracts/interfaces/IController.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";

//TODO: natspec
//TODO: events, errors
//TODO: pausable
//TODO: gas is gonna be insane
contract PerennialBalancedVault is ERC4626, UOwnable {
    IController public immutable controller;
    IProduct public immutable long;
    IProduct public immutable short;
    UFixed18 public immutable leverage; // TODO: make mutable and ownable? how to check that this isn't over a changing maintenance
    ICollateral public immutable collateral; // TODO: Is this safe to be immutable?

    UFixed18 public fixedFloat;
    UFixed18 public maxLeverageMultiplier;

    constructor(IERC20 dsu_, IController controller_, IProduct long_, IProduct short_, UFixed18 leverage_, UFixed18 fixedFloat_, UFixed18 maxLeverageMultiplier_)
        ERC4626(dsu_)
        ERC20("Perennial 50/50 Vault", "P50") //TODO: generative naming here
    {
        __UOwnable__initialize();
        controller = controller_;
        long = long_;
        short = short_;
        leverage = leverage_;
        fixedFloat = fixedFloat_;
        maxLeverageMultiplier = maxLeverageMultiplier_;
        require(maxLeverageMultiplier.gt(UFixed18Lib.ONE), "leverage must be > 1");
        collateral = controller.collateral();
    }

    function totalAssets() public view override returns (uint256) {
        return UFixed18.unwrap(
            collateral.collateral(address(this), long)
                .add(collateral.collateral(address(this), short))
        );
    }

    // Precondition: Assumes the collateral is balanced and the positions have equal size.
    function maxWithdraw(address owner) public view virtual override returns (uint256) {
        // If we're in the middle of closing all positions due to liquidations, return 0.
        if (_hasOutstandingLiquidation()) {
            return 0;
        }

        // Calculate the minimum amount of collateral we can have.
        IOracleProvider.OracleVersion memory currentOracleVersion = long.atVersion(long.latestVersion());
        UFixed18 position = long.position(owner).maker;
        UFixed18 price = currentOracleVersion.price.abs();
        // Calculate the minimum and target collateral for one product. The minimum collateral represents having a leverage of
        // `leverage` * `maxLeverageMultiplier`. The target collateral represents having a leverage of `leverage`.
        UFixed18 minimumCollateral = position.mul(price).div(leverage.mul(maxLeverageMultiplier));
        UFixed18 targetCollateral = position.mul(price).div(leverage);
        // If the difference between the target collateral and minimum collateral is less than `fixedFloat`, then we can
        // withdraw everything.
        if (2 * UFixed18.unwrap(targetCollateral.sub(minimumCollateral)) < UFixed18.unwrap(fixedFloat)) {
            minimumCollateral = UFixed18Lib.ZERO;
        } else {
            minimumCollateral = minimumCollateral.add(minimumCollateral);
        }

        UFixed18 currentCollateral = collateral.collateral(address(this), long).add(collateral.collateral(address(this), short));
        if (currentCollateral.lt(minimumCollateral)) {
            return 0;
        }

        UFixed18 ownerAssets = UFixed18.wrap(_convertToAssets(balanceOf(owner), Math.Rounding.Down));
        return UFixed18.unwrap(UFixed18Lib.min(ownerAssets, currentCollateral.sub(minimumCollateral)));
    }

    // One can call this function with eth_call to get the max withdraw after the flywheel has run.
    function maxWithdrawWithSettle(address owner) public returns (uint256) {
        _flywheel();
        return maxWithdraw(owner);
    }

    // TODO: how do we incentivize / keeper this so that it gets called to rebalance the vault before it gets liquidated?
    // TODO: most of the time user withdraw / deposits will be enough, but a large direction movement in-between user actions could cause this to get liquidated
    function sync() external {
        _flywheel();
    }

    function deposit(uint256 assets, address receiver) public virtual override returns (uint256) {
        require(_flywheel(), "vault needs to recover from liquidation before resuming");
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public virtual override returns (uint256) {
        require(_flywheel(), "vault needs to recover from liquidation before resuming");
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public virtual override returns (uint256) {
        require(_flywheel(), "vault needs to recover from liquidation before resuming");
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public virtual override returns (uint256) {
        require(_flywheel(), "vault needs to recover from liquidation before resuming");
        return super.redeem(shares, receiver, owner);
    }

    // Returns whether the vault is in a healthy state (i.e. if it is not recovering from liquidations).
    function _flywheel() private returns (bool) {
        // Force settlement.
        long.settleAccount(address(this));
        short.settleAccount(address(this));

        // If positions are are not equal, a liquidation occurred. Close all positions so that the flywheel can rebalance.
        if (_hasOutstandingLiquidation()) {
            _closeAllPositions();
        }

        // Adjust collateral to be equal.
        UFixed18 longCollateral = collateral.collateral(address(this), long);
        UFixed18 shortCollateral = collateral.collateral(address(this), short);
        (
            IProduct withdrawFrom,
            UFixed18 withdrawCollateral,
            IProduct depositTo,
            UFixed18 depositCollateral
        ) = longCollateral.gt(shortCollateral) ?
        (
            long,
            longCollateral,
            short,
            shortCollateral
        ) :
        (
            short,
            shortCollateral,
            long,
            longCollateral
        );
        if (UFixed18.unwrap(withdrawCollateral.sub(depositCollateral)) > 1) {
            UFixed18 adjustmentAmount = withdrawCollateral.sub(depositCollateral).div(UFixed18Lib.from(2));
            collateral.withdrawTo(address(this), withdrawFrom, adjustmentAmount);
            collateral.depositTo(address(this), depositTo, adjustmentAmount);
        }

        // Rebalance position.
        _rebalancePosition();

        return true;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        // Deposit assets into this vault.
        super._deposit(caller, receiver, assets, shares);

        // Deposit assets into collateral.
        //TODO: assumes equivalent maintenance on the two products?
        _rebalanceCollateral(UFixed18.wrap(assets), true);

        // Open positions to maintain leverage.
        _rebalancePosition();
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal override {
        // Withdraw assets from this vault.
        _rebalanceCollateral(UFixed18.wrap(assets), false);

        // Close positions to maintain leverage.
        _rebalancePosition();

        // Make Withdrawal
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    // If `deposit` is true, deposit a total of `amount` collateral into the two products.
    // If `deposit` is false, withdraw a total of `amount` collateral from the two products.
    // Precondition: long and short either have the same amount of collateral or the difference is 1.
    function _rebalanceCollateral(UFixed18 amount, bool isDeposit) internal {
        UFixed18 longCollateral = collateral.collateral(address(this), long);
        UFixed18 shortCollateral = collateral.collateral(address(this), short);
        (
            IProduct moreCollateral,
            IProduct lessCollateral
        ) = longCollateral.gt(shortCollateral) ?
        (
            long,
            short
        ) :
        (
            short,
            long
        );

        UFixed18 amountSmallerHalf = UFixed18.wrap(UFixed18.unwrap(amount) / 2);
        UFixed18 amountLargerHalf = amount.sub(amountSmallerHalf);

        if (isDeposit) {
            collateral.depositTo(address(this), moreCollateral, amountSmallerHalf);
            collateral.depositTo(address(this), lessCollateral, amountLargerHalf);
        } else {
            collateral.withdrawTo(address(this), moreCollateral, amountLargerHalf);
            collateral.withdrawTo(address(this), lessCollateral, amountSmallerHalf);
        }
    }

    // Precondition: the difference in collateral between long and short is at most 1.
    // Precondition: the position sizes are the same.
    function _rebalancePosition() internal {
        // 1. Calculate the target position size for each product.
        UFixed18 longCollateral = collateral.collateral(address(this), long);
        UFixed18 shortCollateral = collateral.collateral(address(this), short);
        UFixed18 collateralAmount = UFixed18Lib.min(longCollateral, shortCollateral);

        collateralAmount = collateralAmount.gt(fixedFloat) ? collateralAmount.sub(fixedFloat) : UFixed18Lib.ZERO;
        IOracleProvider.OracleVersion memory currentOracleVersion = long.atVersion(long.latestVersion());
        UFixed18 targetPosition = collateralAmount.mul(leverage).div(currentOracleVersion.price.abs());

        // 2. Adjust positions to target position size.
        _adjustPosition(long, targetPosition);
        _adjustPosition(short, targetPosition);
    }

    function _adjustPosition(IProduct product, UFixed18 targetPosition) internal {
        UFixed18 position = product.position(address(this)).next(product.pre(address(this))).maker;
        if (position.gt(targetPosition)) {
            product.closeMake(position.sub(targetPosition));
        } else if (position.lt(targetPosition)) {
            product.openMake(targetPosition.sub(position));
        }
    }

    // Returns whether one of the positions has been liquidated and the vault has not recovered yet.
    function _hasOutstandingLiquidation() internal view returns (bool) {
        return !long.position(address(this)).maker.eq(short.position(address(this)).maker);
    }

    function _closeAllPositions() internal {
        if (!long.position(address(this)).maker.isZero()) {
            long.closeMake(long.position(address(this)).maker);
        }
        if (!short.position(address(this)).maker.isZero()) {
            short.closeMake(short.position(address(this)).maker);
        }
    }
}
