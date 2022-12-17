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
    UFixed18 constant private TWO = UFixed18.wrap(2e18);

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
        dsu_.approve(address(collateral), type(uint256).max);
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
        if (_hasOutstandingLiquidation()) return 0;

        // Calculate the minimum amount of collateral we can have.
        IOracleProvider.OracleVersion memory currentOracleVersion = long.atVersion(long.latestVersion());
        UFixed18 position = long.position(address(this)).maker;
        UFixed18 price = currentOracleVersion.price.abs();

        // Calculate the minimum collateral for one product, which represents having a leverage of `leverage` * `maxLeverageMultiplier`.
        UFixed18 minimumCollateralForOneProduct = position.mul(price).div(leverage.mul(maxLeverageMultiplier));
        UFixed18 minimumCollateral = minimumCollateralForOneProduct.mul(TWO);

        UFixed18 currentCollateral = collateral.collateral(address(this), long).add(collateral.collateral(address(this), short));
        if (currentCollateral.lt(minimumCollateral)) {
            return 0;
        }

        UFixed18 ownerAssets = UFixed18.wrap(_convertToAssets(balanceOf(owner), Math.Rounding.Down));
        return UFixed18.unwrap(UFixed18Lib.min(ownerAssets, currentCollateral.sub(minimumCollateral)));
    }

    // One can call this function with eth_call to get the max withdraw after the flywheel has run.
    function maxWithdrawWithSettle(address owner) public returns (uint256) {
        _before();
        return maxWithdraw(owner);
    }

    // TODO: how do we incentivize / keeper this so that it gets called to rebalance the vault before it gets liquidated?
    // TODO: most of the time user withdraw / deposits will be enough, but a large direction movement in-between user actions could cause this to get liquidated
    function sync() external {
        _before();
        _updateCollateral(UFixed18Lib.ZERO, false);
        _updatePosition();
    }

    function deposit(uint256 assets, address receiver) public virtual override returns (uint256) {
        _before();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public virtual override returns (uint256) {
        _before();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public virtual override returns (uint256) {
        _before();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public virtual override returns (uint256) {
        _before();
        return super.redeem(shares, receiver, owner);
    }

    function _before() private {
        long.settleAccount(address(this));
        short.settleAccount(address(this));
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        // Deposit assets into this vault.
        super._deposit(caller, receiver, assets, shares);

        // Deposit assets into collateral.
        _updateCollateral(UFixed18.wrap(assets), true);

        // Open positions to maintain leverage.
        _updatePosition();
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal override {
        // Withdraw assets from this vault.
        _updateCollateral(UFixed18.wrap(assets), false);

        // Close positions to maintain leverage.
        _updatePosition();

        // Make Withdrawal
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    // If `deposit` is true, deposit a total of `amount` collateral into the two products.
    // If `deposit` is false, withdraw a total of `amount` collateral from the two products.
    // Precondition: long and short either have the same amount of collateral or the difference is 1.
    function _updateCollateral(UFixed18 amount, bool isDeposit) internal {
        UFixed18 longCollateral = collateral.collateral(address(this), long);
        UFixed18 shortCollateral = collateral.collateral(address(this), short);
        UFixed18 totalCollateral = longCollateral.add(shortCollateral);

        totalCollateral = isDeposit ? totalCollateral.add(amount) : totalCollateral.sub(amount);
        UFixed18 targetCollateral = totalCollateral.div(TWO);
        (IProduct greaterProduct, IProduct lesserProduct) = longCollateral.gt(shortCollateral) ?
            (long, short) :
            (short, long);

        _adjustCollateral(greaterProduct, targetCollateral);
        _adjustCollateral(lesserProduct, totalCollateral.sub(targetCollateral));
    }

    // Precondition: the difference in collateral between long and short is at most 1.
    // Precondition: the position sizes are the same.
    function _updatePosition() internal {
        // 0. If recently liquidated, reset positions
        if (_hasOutstandingLiquidation()) {
            _adjustPosition(long, UFixed18Lib.ZERO);
            _adjustPosition(short, UFixed18Lib.ZERO);
            return;
        }

        // 1. Calculate the target position size for each product.
        UFixed18 totalCollateral = UFixed18.wrap(totalAssets());
        UFixed18 totalUtilized = totalCollateral.gt(fixedFloat) ? totalCollateral.sub(fixedFloat) : UFixed18Lib.ZERO;
        IOracleProvider.OracleVersion memory currentOracleVersion = long.atVersion(long.latestVersion());
        UFixed18 targetPosition = totalUtilized.mul(leverage).div(currentOracleVersion.price.abs()).div(TWO);

        // 2. Adjust positions to target position size.
        _adjustPosition(long, targetPosition);
        _adjustPosition(short, targetPosition);
    }

    function _adjustPosition(IProduct product, UFixed18 targetPosition) internal {
        UFixed18 _position = product.position(address(this)).next(product.pre(address(this))).maker;
        if (_position.gt(targetPosition)) product.closeMake(_position.sub(targetPosition));
        if (_position.lt(targetPosition)) product.openMake(targetPosition.sub(_position));
    }

    function _adjustCollateral(IProduct product, UFixed18 targetCollateral) internal {
        UFixed18 _collateral = collateral.collateral(address(this), product);
        if (_collateral.gt(targetCollateral))
            collateral.withdrawTo(address(this), product, _collateral.sub(targetCollateral));
        if (_collateral.lt(targetCollateral))
            collateral.depositTo(address(this), product, targetCollateral.sub(_collateral));
    }

    // Returns whether one of the positions has been liquidated and the vault has not recovered yet.
    function _hasOutstandingLiquidation() internal view returns (bool) {
        return !long.position(address(this)).maker.eq(short.position(address(this)).maker);
    }
}
