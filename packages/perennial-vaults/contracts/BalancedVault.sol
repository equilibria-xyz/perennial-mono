//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/token/types/Token18.sol";
import "./interfaces/IBalancedVault.sol";
import "../../perennial/contracts/interfaces/ICollateral.sol";

// TODO: Allow withdrawing on behalf of others if approval is given (maybe should just extend ERC20 at that point...)
// TODO: block everything if liquidatable
// TODO: what to do if zero-balance w/ non-zero shares on deposit?
// TODO: work with multi-invoker
// TODO: interface with ERC20 and ERC4626

/**
 * @title BalancedVault
 * @notice ERC4626 vault that manages a 50-50 position between long-short markets of the same payoff on Perennial.
 * @dev Vault deploys and rebalances collateral between the corresponding long and short markets, while attempting to
 *      maintain `targetLeverage` with its open positions at any given time. Deposits are only gated in so much as to cap
 *      the maximum amount of assets in the vault.
 */
contract BalancedVault is IBalancedVault {
    /// @dev A generic holder for an `amount` that cannot be settled until `version`
    struct PendingAmount {
        UFixed18 amount;
        uint256 version;
    }

    /// @dev Version of the vault state at a given oracle version
    struct Version {
        /// @dev Vault's position in `long` at the start of the oracle version
        UFixed18 longPosition;
        /// @dev Vault's position in `short` at the start of the oracle version
        UFixed18 shortPosition;
        /// @dev Vault's total shares issued at the start of the oracle version
        UFixed18 totalShares;
        /// @dev Vault's total collateral at the start of the oracle version
        UFixed18 totalCollateral;
    }

    UFixed18 constant private TWO = UFixed18.wrap(2e18);

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

    /// @dev Mapping of shares of the vault per user
    mapping(address => UFixed18) public balanceOf;

    /// @dev Mapping of unclaimed underlying of the vault per user
    mapping(address => UFixed18) public unclaimed;

    /// @dev Mapping of unclaimed underlying of the vault per user
    UFixed18 public totalUnclaimed;

    /// @dev Total number of shares across all users
    UFixed18 public totalSupply;

    /// @dev Deposits that have not been settled, or have been settled but not yet processed by this contract
    PendingAmount public deposit;

    /// @dev Mapping of pending (not yet converted to shares) per user
    mapping(address => PendingAmount) public deposits;

    /// @dev Redemptions that have not been settled, or have been settled but not yet processed by this contract
    PendingAmount public redemption;

    /// @dev Mapping of pending (not yet withdrawn) per user
    mapping(address => PendingAmount) public redemptions;

    /// @dev Mapping of versions of the vault state at a given oracle version
    mapping(uint256 => Version) public versions;

    // TODO: Initializer
    constructor(
        Token18 asset_,
        ICollateral collateral_,
        IProduct long_,
        IProduct short_,
        UFixed18 targetLeverage_,
        UFixed18 maxCollateral_
    ) {
        collateral = collateral_;
        long = long_;
        short = short_;
        targetLeverage = targetLeverage_;
        maxCollateral = maxCollateral_;
        asset = asset_;

        asset.approve(address(collateral_));
    }

    /**
     * @notice Rebalances the collateral and position of the vault without a deposit or withdraw
     * @dev Should be called by a keeper when the vault approaches a liquidation state on either side
     */
    function sync() external {
        _before(address(0));
        _update(UFixed18Lib.ZERO);
    }

    /**
     * @notice The total amount of assets currently held by the vault
     * @return Amount of assets held by the vault
     */
    function totalAssets() public view returns (UFixed18) {
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        return longCollateral.add(shortCollateral).add(idleCollateral).sub(totalUnclaimed);
    }

    /**
     * @notice The maximum available redeemable amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param owner The account to redeem for
     * @return Maximum available redeemable amount
     */
    function maxRedeem(address owner) public view returns (UFixed18) {
        if (!healthy()) return UFixed18Lib.ZERO;

        return balanceOf[owner];
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param owner The account to deposit for
     * @return Maximum available deposit amount
     */
    function maxDeposit(address) public view returns (UFixed18) {
        if (!healthy()) return UFixed18Lib.ZERO;

        UFixed18 currentCollateral = totalAssets();

        return currentCollateral.gt(maxCollateral) ?
            maxCollateral.sub(currentCollateral) :
            UFixed18Lib.ZERO;
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `receiver` after the deposit settles.
     * @param assets The amount of assets to deposit
     * @param receiver The account to deposit on behalf of
     */
    function deposit(UFixed18 assets, address receiver) external {
        if (assets.gt(maxDeposit(receiver))) revert BalancedVaultDepositLimitExceeded();

        uint256 version = _settle(receiver);

        deposit.amount = deposit.amount.add(assets);
        deposit.oracleVersion = version;

        deposits[receiver].amount = deposits[receiver].amount.add(assets);
        deposits[receiver].oracleVersion = version;

        asset.pull(msg.sender, assets);

        _rebalance(UFixed18Lib.ZERO);
    }

    function redeem(UFixed18 shares) external {
        if (shares.gt(maxRedeem(msg.sender))) revert BalancedVaultRedemptionLimitExceeded();

        uint256 version = _settle(msg.sender);

        redemption.amount = redemption.amount.add(shares);
        redemption.oracleVersion = version;

        redemptions[msg.sender].amount = redemptions[msg.sender].amount.add(shares);
        redemptions[msg.sender].oracleVersion = version;

        balanceOf[msg.sender] = balanceOf[msg.sender].sub(shares);

        _rebalance(UFixed18Lib.ZERO);
    }

    function claim() external {
        _settle(msg.sender);

        UFixed18 claimAmount = unclaimed[msg.sender];
        delete unclaimed[msg.sender];
        totalUnclaimed = totalUnclaimed.sub(claimAmount);

        _rebalance(claimAmount);

        asset.push(msg.sender, claimed);
    }

    /**
     * @notice Returns whether the vault's positions have been been recently liquidated
     * @dev If one product's position is zero while the other is non-zero, this indicates a recent liquidation
     * @return Whether the vault is healthy
     */
    //TODO: change to liquidatable
    function healthy() public view returns (bool) {
        (bool isLongZero, bool isShortZero) =
            (long.position(address(this)).maker.isZero(), short.position(address(this)).maker.isZero());
        return isLongZero == isShortZero;
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param user The account that called the operation, or 0 if called by a keeper.
     * @return The current version
     */
    function _settle(address account) private returns (uint256 version) {
        long.settleAccount(address(this));
        short.settleAccount(address(this));

        version = long.latestVersion(address(this));
        UFixed18 collateralAtVersion = _collateralAt(version);
        UFixed18 sharesAtVersion = _snapshot[version].totalShares;

        _settleDeposit(version, collateralAtVersion, sharesAtVersion);
        _settleRedemption(version, collateralAtVersion, sharesAtVersion);

        if (account != address(0)) {
            _settleDeposits(account, version, collateralAtVersion, sharesAtVersion);
            _settleRedemptions(account, version, collateralAtVersion, sharesAtVersion);
        }

        versions[version] = Version({
            longPosition: long.positionAtVersion(version),
            shortPosition: short.positionAtVersion(version),
            totalShares: totalSupply,
            totalCollateral: totalAssets()
        });
    }

    function _settleDeposit(uint256 version, UFixed18 collateralAtVersion, UFixed18 sharesAtVersion) private {
        if (deposit.amount.isZero() || version == deposit.oracleVersion) return;

        UFixed18 shareAmount = pendingDeposit.amount.muldiv(collateralAtVersion, sharesAtVersion);
        totalSupply = totalSupply.add(shareAmount);

        delete deposit;
    }

    function _settleDeposits(address account, uint256 version, UFixed18 collateralAtVersion, UFixed18 sharesAtVersion) private {
        if (deposits[account].amount.isZero() || version == deposits[account].oracleVersion) return;

        UFixed18 shareAmount = pendingDeposit.amount.muldiv(collateralAtVersion, sharesAtVersion);
        balanceOf[account] = balanceOf[account].add(shareAmount);

        delete deposits[account];
    }

    function _settleRedemption(uint256 version, UFixed18 collateralAtVersion, UFixed18 sharesAtVersion) private {
        if (redemption.amount.isZero() || version == redemption.oracleVersion) return;

        UFixed18 underlyingAmount = redemption.amount.muldiv(sharesAtVersion, collateralAtVersion);
        totalUnclaimed = totalUnclaimed.add(underlyingAmount);

        delete redemption;
    }

    function _settleRedemptions(address account, uint256 version, UFixed18 collateralAtVersion, UFixed18 sharesAtVersion) private {
        if (redemptions[account].amount.isZero() || version == redemptions[account].oracleVersion) return;

        UFixed18 underlyingAmount = redemptions[account].amount.muldiv(sharesAtVersion, collateralAtVersion);
        unclaimed[account] = unclaimed[account].add(underlyingAmount);

        delete redemptions[account];
    }

    function _collateralAt(usint256 version) private returns (UFixed18) {
        Fixed18 longAccumulated = long.valueAtVersion(version + 1).sub(long.valueAtVersion(version));
        Fixed18 shortAccumulated = short.valueAtVersion(version + 1).sub(short.valueAtVersion(version));

        Fixed18 accumulated = longAccumulated.mul(_snapshot[version].longPosition)
            .add(shortAccumulated.mul(_snapshot[version].shortPosition));

        //TODO: what to do if negative?
        return UFixed18Lib.from(Fixed18Lib.from(_snapshot[version].totalCollateral).add(accumulated));
    }

    /**
     * @notice Rebalances the collateral of the vault
     * @dev Does not revert when rebalance fails, returns false instead allowing the vault to reset
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalance(UFixed18 claimAmount) private {
        (UFixed18 longCollateral, UFixed18 shortCollateral, UFixed18 idleCollateral) = _collateral();
        UFixed18 currentCollateral = longCollateral.add(shortCollateral).add(idleCollateral).sub(claimAmount);
        UFixed18 targetCollateral = currentCollateral.div(TWO);
        UFixed18 currentUtilized = currentCollateral.sub(totalUnclaimed);
        UFixed18 currentPrice = long.atVersion(long.latestVersion()).price.abs();
        UFixed18 targetPosition = currentUtilized.mul(targetLeverage).div(currentPrice).div(TWO);

        (IProduct greaterProduct, IProduct lesserProduct) =
            longCollateral.gt(shortCollateral) ? (long, short) : (short, long);

        _adjustCollateral(greaterProduct, targetCollateral);
        _adjustCollateral(lesserProduct, currentCollateral.sub(targetCollateral));
        _adjustPosition(long, targetPosition);
        _adjustPosition(short, targetPosition);
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
     * @return Whether the collateral adjust succeeded
     */
    function _adjustCollateral(IProduct product, UFixed18 targetCollateral) private {
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
            Token18.wrap(address(asset)).balanceOf()
        );
    }
}
