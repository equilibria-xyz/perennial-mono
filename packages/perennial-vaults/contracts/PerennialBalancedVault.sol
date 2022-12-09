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

    // The max withdraw is the max of fixedFloat and totalAssets * fractionFloat / 1e18.
    UFixed18 public fixedFloat;
    uint256 public fractionFloat;

    constructor(IERC20 dsu_, IController controller_, IProduct long_, IProduct short_, UFixed18 leverage_, UFixed18 fixedFloat_, UFixed18 fractionFloat_)
        ERC4626(dsu_)
        ERC20("Perennial 50/50 Vault", "P50") //TODO: generative naming here
    {
        __UOwnable__initialize();
        controller = controller_;
        long = long_;
        short = short_;
        leverage = leverage_;
    }

    function totalAssets() public view override returns (uint256) {
        ICollateral collateral = controller.collateral();
        return UFixed18.unwrap(
            collateral.collateral(address(this), long)
                .add(collateral.collateral(address(this), short))
        );
    }

    function maxWithdraw(address owner) public view virtual override returns (uint256) {
        // 1. Use PerennialLens to see product snapshots so we can determine
        //    our current collateral and leverage.
        // TODO: Do this.

        // 2. Calculate the amount of float we have available to withdraw based on the leverage.
        UFixed18 availableFloat = UFixed18Lib.ZERO;  // TODO: Calculate this.

        // 3. The max withdraw is min(ownerAssets, availableFloat).
        // TODO: Maybe we can reduce the amount of wrapping and unwrapping here.
        UFixed18 ownerAssets = UFixed18.wrap(_convertToAssets(balanceOf(owner), Math.Rounding.Down));
        return UFixed18.unwrap(UFixed18Lib.min(ownerAssets, availableFloat));
    }

    // TODO: how do we incentivize / keeper this so that it gets called to rebalance the vault before it gets liquidated?
    // TODO: most of the time user withdraw / deposits will be enough, but a large direction movement in-between user actions could cause this to get liquidated
    function sync() external {
        _flywheel();
    }

    function deposit(uint256 assets, address receiver) public virtual override returns (uint256) {
        _flywheel();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public virtual override returns (uint256) {
        _flywheel();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public virtual override returns (uint256) {
        _flywheel();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public virtual override returns (uint256) {
        _flywheel();
        return super.redeem(shares, receiver, owner);
    }

    function _flywheel() private {
        // 1. Force settlement.
        long.settleAccount(address(this));
        short.settleAccount(address(this));

        // 2. Adjust collateral to be equal.
        ICollateral collateral = controller.collateral();
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
        if (withdrawCollateral.sub(depositCollateral).gt(UFixed18Lib.ONE)) {
            UFixed18 adjustmentAmount = withdrawCollateral.sub(depositCollateral).div(UFixed18Lib.from(2));
            collateral.withdrawTo(address(this), withdrawFrom, adjustmentAmount);
            collateral.depositTo(address(this), depositTo, adjustmentAmount);
        }
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        // 1. Deposit assets into this vault.
        super._deposit(caller, receiver, assets, shares);

        // 2. Deposit assets into collateral.
        //TODO: assumes equivalent maintenance on the two products?
        ICollateral collateral = controller.collateral();
        collateral.depositTo(address(this), long, UFixed18.wrap(assets / 2));
        collateral.depositTo(address(this), short, UFixed18.wrap(assets - (assets / 2)));

        // 3. Open positions to maintain leverage.
        //TODO: best way to make this actually up-to-date (settle first? get current version from oracle?)
        IOracleProvider.OracleVersion memory currentOracleVersion = long.atVersion(long.latestVersion());
        UFixed18 position = UFixed18.wrap(assets).mul(leverage).div(currentOracleVersion.price.abs());

        //TODO: rounding leftovers less important here?
        //TODO: adjust these numbers to account for global p&l changes (use leverage, collateral to adjust notional)
        long.openMake(position.div(UFixed18Lib.from(2)));
        short.openMake(position.div(UFixed18Lib.from(2)));
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal override {
        ICollateral collateral = controller.collateral();
        collateral.withdrawTo(receiver, long, UFixed18.wrap(assets / 2));
        collateral.withdrawTo(receiver, short, UFixed18.wrap(assets - assets / 2));

        // Make Withdrawal
        super._withdraw(caller, receiver, owner, assets, shares);
    }
}
