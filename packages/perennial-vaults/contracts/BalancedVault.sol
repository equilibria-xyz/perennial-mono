//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/token/types/Token18.sol";
import "./interfaces/IBalancedVault.sol";

// TODO: Allow withdrawing on behalf of others if approval is given (maybe should just extend ERC20 at that point...)
// TODO: block everything if liquidatable

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

    /// @dev Snapshot of the vault state at a given oracle version
    struct Snapshot {
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

    Token18 public immutable dsu;

    /// @dev Mapping of shares of the vault per user
    mapping(address => UFixed18) public balanceOf;

    /// @dev Mapping of unclaimed underlying of the vault per user
    mapping(address => UFixed18) public unclaimed;

    /// @dev Mapping of unclaimed underlying of the vault per user
    UFixed18 public totalUnclaimed;

    /// @dev Total number of shares across all users
    UFixed18 public totalSupply;

    // TODO: Make all the below internal/private if not necessary to be public.

    /// @dev Deposits that have not been settled, or have been settled but not yet processed by this contract
    PendingAmount public unsettledDeposits;

    /// @dev Mapping of pending (not yet converted to shares) per user
    mapping(address => PendingAmount) public pendingDeposits;

    /// @dev Withdrawals that have not been settled, or have been settled but not yet processed by this contract
    PendingAmount public unsettledWithdrawals;

    /// @dev Mapping of pending (not yet withdrawn) per user
    mapping(address => PendingAmount) public pendingWithdrawals;

    /// @dev Mapping of snapshots of the vault state at a given oracle version
    mapping(uint256 => Snapshot) public snapshots;

    // TODO: Initializer
    constructor(
        IERC20Upgradeable dsu_,
        IController controller_,
        IProduct long_,
        IProduct short_,
        UFixed18 targetLeverage_,
        UFixed18 maxCollateral_
    ) {
        controller = controller_;
        collateral = controller.collateral();
        long = long_;
        short = short_;
        targetLeverage = targetLeverage_;
        maxCollateral = maxCollateral_;
        dsu = dsu_;

        dsu.approve(address(collateral));
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
     * @notice The maximum available withdrawal amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param owner The account to withdraw for
     * @return Maximum available withdrawal amount
     */
    function maxWithdraw(address owner) public view returns (UFixed18) {
        // If we're in the middle of closing all positions due to liquidations, return 0.
        if (!healthy()) return UFixed18Lib.ZERO;

        // TODO: Actually calculate this using pending withdrawals.
        return UFixed18Lib.ZERO;
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param owner The account to deposit for
     * @return Maximum available deposit amount
     */
    function maxDeposit(address owner) public view returns (UFixed18) {
        // If the vault has no assets to back the shares, we are unhealthy and should not allow deposits.
        UFixed18 currentCollateral = totalAssets();
        if (currentCollateral.isZero() && totalSupply > 0) return UFixed18Lib.ZERO;

        UFixed18 availableDeposit = currentCollateral.gt(maxCollateral) ?
            UFixed18Lib.ZERO :
            maxCollateral.sub(currentCollateral);

        return availableDeposit;
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `receiver` after the deposit settles.
     * @param assets The amount of assets to deposit
     * @param receiver The account to deposit on behalf of
     */
    function deposit(UFixed18 assets, address receiver) external {
        if (assets.gt(maxDeposit(receiver))) revert BalancedVaultDepositMoreThanMax();

        uint256 version = _settle(receiver);

        unsettledDeposits.amount = unsettledDeposits.amount.add(assets);
        unsettledDeposits.oracleVersion = version;

        pendingDeposits[receiver].amount = pendingDeposits[receiver].amount.add(assets);
        pendingDeposits[receiver].oracleVersion = version;

        dsu.pull(msg.sender, assets);

        _update(UFixed18Lib.ZERO);
    }

    function withdraw(UFixed18 shares) external {
        uint256 version = _settle(msg.sender);

        // TODO: ???
        UFixed18 withdrawalAmount = totalAssets().muldiv(shares, totalSupply);
        _update(withdrawalAmount);

        unsettledWithdrawals.amount = unsettledWithdrawals.amount.add(shares);
        unsettledWithdrawals.oracleVersion = version;

        pendingWithdrawals[msg.sender].amount = pendingWithdrawals[msg.sender].amount.add(shares);
        pendingWithdrawals[msg.sender].oracleVersion = version;

        balanceOf[msg.sender] = balanceOf[msg.sender].sub(shares);
    }

    function claim() external {
        _settle(msg.sender);

        UFixed18 claimed = unclaimed[msg.sender];
        delete unclaimed[msg.sender];
        totalUnclaimed = totalUnclaimed.sub(claimed);

        dsu.push(msg.sender, claimed);
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
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/withdrawals
     * @param user The account that called the operation, or 0 if called by a keeper.
     * @return The current version
     */
    function _settle(address account) private returns (uint256 version) {
        long.settleAccount(address(this));
        short.settleAccount(address(this));

        version = _version();
        UFixed18 collateralAtVersion = _collateralAt(version);
        UFixed18 sharesAtVersion = _snapshot[version].totalShares;

        _settleDeposits(version, collateralAtVersion, sharesAtVersion);
        _settleWithdrawals(version, collateralAtVersion, sharesAtVersion);

        if (account != address(0)) {
            _settleDeposits(account, version, collateralAtVersion, sharesAtVersion);
            _settleWithdrawals(account, version, collateralAtVersion, sharesAtVersion);
        }

        snapshots[version] = Snapshot({
            longPosition: long.positionAtVersion(version),
            shortPosition: short.positionAtVersion(version),
            totalShares: totalSupply,
            totalCollateral: totalAssets()
        });
    }

    function _settleDeposits(uint256 version, UFixed18 collateralAtVersion, UFixed18 sharesAtVersion) private {
        if (unsettledDeposits.amount.isZero() || version == unsettledDeposits.oracleVersion) return;

        UFixed18 shareAmount = pendingDeposit.amount.muldiv(collateralAtVersion, sharesAtVersion);
        totalSupply = totalSupply.add(shareAmount);

        delete unsettledDeposits;
    }

    function _settleDeposits(address account, uint256 version, UFixed18 collateralAtVersion, UFixed18 sharesAtVersion) private {
        if (pendingDeposits[account].amount.isZero() || version == pendingDeposits[account].oracleVersion) return;

        UFixed18 shareAmount = pendingDeposit.amount.muldiv(collateralAtVersion, sharesAtVersion);
        balanceOf[account] = balanceOf[account].add(shareAmount);

        delete pendingDeposits[account];
    }

    function _settleWithdrawals(uint256 version, UFixed18 collateralAtVersion, UFixed18 sharesAtVersion) private {
        if (unsettledWithdrawals.amount.isZero() || version == unsettledWithdrawals.oracleVersion) return;

        UFixed18 underlyingAmount = pendingDeposit.amount.muldiv(sharesAtVersion, collateralAtVersion);
        totalUnclaimed = totalUnclaimed.add(underlyingAmount);

        delete unsettledWithdrawals;
    }

    function _settleWithdrawals(address account, uint256 version, UFixed18 collateralAtVersion, UFixed18 sharesAtVersion) private {
        if (pendingWithdrawals[account].amount.isZero() || version == pendingWithdrawals[account].oracleVersion) return;

        UFixed18 underlyingAmount = pendingWithdrawal.amount.muldiv(sharesAtVersion, collateralAtVersion);
        unclaimed[account] = unclaimed[account].add(underlyingAmount);

        delete pendingWithdrawal[account];
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
     * @notice Returns the current version of the vault's products
     * @dev We assume that the short product's version is always equal to the long product's version
     * @return The version of the vault's products
     */
    function _version() private view returns (uint256) {
        return long.latestVersion(address(this));
    }

    /**
     * @notice Updates the vault's collateral and position given its current balance and parameters
     * @param withdrawalAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _update(UFixed18 withdrawalAmount) private {
        // TODO: Add flow for if there aren't enough assets to withdraw for all pending witdhrawals.

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
        UFixed18 currentCollateral = totalAssets().sub(withdrawalAmount).sub(unredeemedWithdrawals);
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
        UFixed18 currentCollateral = totalAssets().sub(withdrawalAmount);
        UFixed18 currentUtilized = currentCollateral.sub(unredeemedWithdrawals);
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
            Token18.wrap(address(dsu)).balanceOf()
        );
    }
}
