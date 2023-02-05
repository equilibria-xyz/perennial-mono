//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@equilibria/root/token/types/Token18.sol";
import "./interfaces/IBalancedVault.sol";

/**
 * @title BalancedVault
 * @notice ERC4626 vault that manages a 50-50 position between long-short markets of the same payoff on Perennial.
 * @dev Vault deploys and rebalances collateral between the corresponding long and short markets, while attempting to
 *      maintain `targetLeverage` with its open positions at any given time. Deposits are only gated in so much as to cap
 *      the maximum amount of assets in the vault.
 */
contract BalancedVault is IBalancedVault, ContextUpgradeable {
    /// @dev An `amount` of DSU in a pending state starting at some `oracleVersion`
    struct PendingDSU {
        UFixed18 amount;
        uint256 oracleVersion;
    }
    PendingDSU private ZERO_PENDING_DSU = PendingDSU(UFixed18Lib.ZERO, 0);

    /// @dev An `amount` of shares in a pending state starting at some `oracleVersion`
    struct PendingShares {
        uint256 amount;
        uint256 oracleVersion;
    }
    PendingShares private ZERO_PENDING_SHARES = PendingShares(0, 0);

    /// @dev Snapshot of the vault state at a given oracle version
    struct Snapshot {
        /// @dev Vault's collateral in `long` at the start of the oracle version
        UFixed18 longCollateral;
        /// @dev Vault's collateral in `short` at the start of the oracle version
        UFixed18 shortCollateral;
        /// @dev Vault's position in `long` at the start of the oracle version
        UFixed18 longPosition;
        /// @dev Vault's position in `short` at the start of the oracle version
        UFixed18 shortPosition;
        /// @dev Vault's total initiated deposits throughout the oracle version
        UFixed18 pendingDeposits;
        /// @dev Vault's total initiated withdrawals throughout the oracle version
        uint256 pendingWithdrawals;
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

    IERC20Upgradeable public immutable dsu;

    /// @dev Mapping of shares of the vault per user
    mapping(address => uint256) public balanceOf;

    /// @dev Total number of shares across all users
    uint256 public totalSupply;

    // TODO: Make all the below internal/private if not necessary to be public.

    /// @dev Number of shares post-settlement that have not been redeemed across all users
    uint256 public unredeemedShares;

    /// @dev Amount of DSU post-settlement that have not been redeemed across all users
    UFixed18 public unredeemedWithdrawals;

    /// @dev Deposits that have not been settled, or have been settled but not yet processed by this contract
    PendingDSU public unsettledDeposits;

    /// @dev Mapping of pending (not yet converted to shares) per user
    mapping(address => PendingDSU) public pendingDeposits;

    /// @dev Withdrawals that have not been settled, or have been settled but not yet processed by this contract
    PendingShares public unsettledWithdrawals;

    /// @dev Mapping of pending (not yet withdrawn) per user
    mapping(address => PendingShares) public pendingWithdrawals;

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

        dsu.approve(address(collateral), type(uint256).max);
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
        return longCollateral.add(shortCollateral).add(idleCollateral).sub(unredeemedWithdrawals);
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
    function deposit(UFixed18 assets, address receiver) public {
        if (assets.gt(maxDeposit(receiver))) revert BalancedVaultDepositMoreThanMax();

        _before(receiver);

        // TODO: Optimize to reduce unnecessary external calls to get version.
        uint256 version = _version();
        if (unsettledDeposits.amount.isZero() && unsettledDeposits.oracleVersion == 0) {
            unsettledDeposits.amount = unsettledDeposits.amount.add(assets);
            unsettledDeposits.oracleVersion = version;
        }
        if (pendingDeposits[receiver].amount.isZero() && pendingDeposits[receiver].oracleVersion == 0) {
            pendingDeposits[receiver].amount = pendingDeposits[receiver].amount.add(assets);
            pendingDeposits[receiver].oracleVersion = version;
        }
        // TODO: Update snapshots mapping.

        // TODO: Maybe use Token18 methods instead.
        SafeERC20Upgradeable.safeTransferFrom(dsu, _msgSender(), address(this), UFixed18.unwrap(assets));
        _update(UFixed18Lib.ZERO);
    }

    // TODO: Allow withdrawing on behalf of others if approval is given (maybe should just extend ERC20 at that point...)
    function prepareWithdraw(uint256 shares) public {
        _before(_msgSender());
        if (shares > balanceOf[_msgSender()]) revert BalancedVaultPrepareWithdrawMoreThanBalance();

        // TODO: Maybe support having multiple pending withdrawals.
        if (pendingWithdrawals[_msgSender()].amount > 0) revert BalancedVaultWithdrawPending();

        UFixed18 withdrawalAmount = totalAssets().muldiv(shares, totalSupply);
        _update(withdrawalAmount);

        // TODO: Optimize to reduce unnecessary external calls to get version.
        uint256 version = _version();
        if (unsettledWithdrawals.amount == 0 && unsettledWithdrawals.oracleVersion == 0) {
            unsettledWithdrawals.amount += shares;
            unsettledDeposits.oracleVersion = version;
        }
        if (pendingWithdrawals[_msgSender()].amount == 0 && pendingWithdrawals[_msgSender()].oracleVersion == 0) {
            pendingWithdrawals[_msgSender()].amount += shares;
            pendingDeposits[_msgSender()].oracleVersion = version;
        }
        // TODO: Update snapshots mapping.
        balanceOf[_msgSender()] -= shares;
    }

    // TODO: Allow withdrawing on behalf of others if approval is given (maybe should just extend ERC20 at that point...)
    function withdraw(UFixed18 withdrawalAmount) public {
        _before(_msgSender());
        if (withdrawalAmount.gt(maxWithdraw(_msgSender()))) revert BalancedVaultWithdrawMoreThanPending();
        // TODO: Update `unredeemedWithdrawals`, `pendingWithdrawals`, and `snapshots`.

        // TODO: Maybe use Token18 methods instead.
        SafeERC20Upgradeable.safeTransfer(dsu, _msgSender(), UFixed18.unwrap(withdrawalAmount));
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
     */
    function _before(address user) private {
        long.settleAccount(address(this));
        short.settleAccount(address(this));

        uint256 version = _version();
        if (unsettledDeposits.amount.gt(UFixed18Lib.ZERO) && version > unsettledDeposits.oracleVersion) {
            // TODO: Calculate what to add to unredeemedShares.
            unsettledDeposits = ZERO_PENDING_DSU;
        }

        if (unsettledWithdrawals.amount > 0 && version > unsettledWithdrawals.oracleVersion) {
            // TODO: Calculate what to add to unredeemedWithdrawals.
            unsettledWithdrawals = ZERO_PENDING_SHARES;
        }

        if (user != address(0)) {
            if (pendingDeposits[user].amount.gt(UFixed18Lib.ZERO) && version > pendingDeposits[user].oracleVersion) {
                // TODO: Calculate what to add to user's shares
                // TODO: Update unredeemedShares, user's shares.
                pendingDeposits[user] = ZERO_PENDING_DSU;
            }
        }
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
