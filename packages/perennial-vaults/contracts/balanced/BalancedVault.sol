//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../interfaces/IBalancedVault.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./BalancedVaultDefinition.sol";
import "./types/MarketAccount.sol";
import "../PerennialLib.sol";

/**
 * @title BalancedVault
 * @notice ERC4626 vault that manages a 50-50 position between long-short markets of the same payoff on Perennial.
 * @dev Vault deploys and rebalances collateral between the corresponding long and short markets, while attempting to
 *      maintain `targetLeverage` with its open positions at any given time. Deposits are only gated in so much as to cap
 *      the maximum amount of assets in the vault.
 *
 *      The vault has a "delayed mint" mechanism for shares on deposit. After depositing to the vault, a user must wait
 *      until the next settlement of the underlying products in order for shares to be reflected in the getters.
 *      The shares will be fully reflected in contract state when the next settlement occurs on the vault itself.
 *      Similarly, when redeeming shares, underlying assets are not claimable until a settlement occurs.
 *      Each state changing interaction triggers the `settle` flywheel in order to bring the vault to the
 *      desired state.
 *      In the event that there is not a settlement for a long period of time, keepers can call the `sync` method to
 *      force settlement and rebalancing. This is most useful to prevent vault liquidation due to PnL changes
 *      causing the vault to be in an unhealthy state (far away from target leverage)
 */
contract BalancedVault is IBalancedVault, BalancedVaultDefinition, UInitializable {
    UFixed18 constant private TWO = UFixed18.wrap(2e18);

    /// @dev The name of the vault
    string public name;

    /// @dev Deprecated storage variable. Formerly `symbol`
    string private __unused0;

    /// @dev Mapping of allowance across all users
    mapping(address => mapping(address => UFixed18)) public allowance;

    /// @dev Mapping of shares of the vault per user
    mapping(address => UFixed18) private _balanceOf;

    /// @dev Total number of shares across all users
    UFixed18 private _totalSupply;

    /// @dev Mapping of unclaimed underlying of the vault per user
    mapping(address => UFixed18) private _unclaimed;

    /// @dev Total unclaimed underlying of the vault across all users
    UFixed18 private _totalUnclaimed;

    /// @dev Deposits that have not been settled, or have been settled but not yet processed by this contract
    UFixed18 private _deposit;

    /// @dev Redemptions that have not been settled, or have been settled but not yet processed by this contract
    UFixed18 private _redemption;

    /// @dev The latest version that a pending deposit or redemption has been placed
    uint256 private _latestEpoch;

    /// @dev Mapping of pending (not yet converted to shares) per user
    mapping(address => UFixed18) private _deposits;

    /// @dev Mapping of pending (not yet withdrawn) per user
    mapping(address => UFixed18) private _redemptions;

    /// @dev Mapping of the latest version that a pending deposit or redemption has been placed per user
    mapping(address => uint256) private _latestEpochs;

    /// @dev Per-asset accounting state variables
    MarketAccount[100] private _marketAccounts;

    /// @dev Mapping of the global vault state for each epoch
    mapping(uint256 => Epoch) private _epochs;

    constructor(
        Token18 asset_,
        IController controller_,
        UFixed18 targetLeverage_,
        UFixed18 maxCollateral_,
        MarketDefinition[1] memory marketDefinitions_
    )
    BalancedVaultDefinition(asset_, controller_, targetLeverage_, maxCollateral_, marketDefinitions_)
    { }

    /**
     * @notice Initializes the contract state
     * @param name_ ERC20 asset name
     */
    function initialize(string memory name_) external initializer(2) {
        name = name_;
        __unused0 = "";

        // TODO: convert versions to epochs

        asset.approve(address(collateral), UFixed18Lib.ZERO);
        asset.approve(address(collateral));
    }

    /**
     * @notice Rebalances the collateral and position of the vault without a deposit or withdraw
     * @dev Should be called by a keeper when the vault approaches a liquidation state on either side
     */
    function sync() external {
        (EpochContext memory context, ) = _settle(address(0));
        _rebalance(context, UFixed18Lib.ZERO);
    }

    /**
     * @notice Deposits `assets` assets into the vault, returning shares to `account` after the deposit settles.
     * @param assets The amount of assets to deposit
     * @param account The account to deposit on behalf of
     */
    function deposit(UFixed18 assets, address account) external {
        (EpochContext memory context, ) = _settle(account);
        if (assets.gt(_maxDepositAtEpoch(context))) revert BalancedVaultDepositLimitExceeded();

        _deposit = _deposit.add(assets);
        _latestEpoch = context.epoch;
        _deposits[account] = _deposits[account].add(assets);
        _latestEpochs[account] = context.epoch;
        emit Deposit(msg.sender, account, context.epoch, assets);

        asset.pull(msg.sender, assets);

        _rebalance(context, UFixed18Lib.ZERO);
    }

    /**
     * @notice Redeems `shares` shares from the vault
     * @dev Does not return any assets to the user due to delayed settlement. Use `claim` to claim assets
     *      If account is not msg.sender, requires prior spending approval
     * @param shares The amount of shares to redeem
     * @param account The account to redeem on behalf of
     */
    function redeem(UFixed18 shares, address account) external {
        if (msg.sender != account) _consumeAllowance(account, msg.sender, shares);

        (EpochContext memory context, EpochContext memory accountContext) = _settle(account);
        if (shares.gt(_maxRedeemAtEpoch(context, accountContext, account))) revert BalancedVaultRedemptionLimitExceeded();

        _redemption = _redemption.add(shares);
        _latestEpoch = context.epoch;
        _redemptions[account] = _redemptions[account].add(shares);
        _latestEpochs[account] = context.epoch;
        emit Redemption(msg.sender, account, context.epoch, shares);

        _burn(account, shares);

        _rebalance(context, UFixed18Lib.ZERO);
    }

    /**
     * @notice Claims all claimable assets for account, sending assets to account
     * @param account The account to claim for
     */
    function claim(address account) external {
        (EpochContext memory context, ) = _settle(account);

        UFixed18 unclaimedAmount = _unclaimed[account];
        UFixed18 unclaimedTotal = _totalUnclaimed;
        _unclaimed[account] = UFixed18Lib.ZERO;
        _totalUnclaimed = unclaimedTotal.sub(unclaimedAmount);
        emit Claim(msg.sender, account, unclaimedAmount);

        // pro-rate if vault has less collateral than unclaimed
        UFixed18 claimAmount = unclaimedAmount;
        UFixed18 totalCollateral = _assets();
        if (totalCollateral.lt(unclaimedTotal)) claimAmount = claimAmount.muldiv(totalCollateral, unclaimedTotal);

        _rebalance(context, claimAmount);

        asset.push(account, claimAmount);
    }

    /**
     * @notice Sets `amount` as the allowance of `spender` over the caller's shares
     * @param spender Address which can spend operate on shares
     * @param amount Amount of shares that spender can operate on
     * @return bool true if the approval was successful, otherwise reverts
     */
    function approve(address spender, UFixed18 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice The maximum available deposit amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @return Maximum available deposit amount
     */
    function maxDeposit(address) external view returns (UFixed18) {
        (EpochContext memory context, ) = _loadContextForRead(address(0));
        return _maxDepositAtEpoch(context);
    }

    /**
     * @notice The maximum available redeemable amount
     * @dev Only exact when vault is synced, otherwise approximate
     * @param account The account to redeem for
     * @return Maximum available redeemable amount
     */
    function maxRedeem(address account) external view returns (UFixed18) {
        (EpochContext memory context, EpochContext memory accountContext) = _loadContextForRead(account);
        return _maxRedeemAtEpoch(context, accountContext, account);
    }

    /**
     * @notice The total amount of assets currently held by the vault
     * @return Amount of assets held by the vault
     */
    function totalAssets() external view returns (UFixed18) {
        (EpochContext memory context, ) = _loadContextForRead(address(0));
        return _totalAssetsAtEpoch(context);
    }

    /**
     * @notice The total amount of shares currently issued
     * @return Amount of shares currently issued
     */
    function totalSupply() external view returns (UFixed18) {
        (EpochContext memory context, ) = _loadContextForRead(address(0));
        return _totalSupplyAtEpoch(context);
    }

    /**
     * @notice Number of shares held by `account`
     * @param account Account to query balance of
     * @return Number of shares held by `account`
     */
    function balanceOf(address account) external view returns (UFixed18) {
        (, EpochContext memory accountContext) = _loadContextForRead(account);
        return _balanceOfAtEpoch(accountContext, account);
    }

    /**
     * @notice Total unclaimed assets in vault
     * @return Total unclaimed assets in vault
     */
    function totalUnclaimed() external view returns (UFixed18) {
        (EpochContext memory context, ) = _loadContextForRead(address(0));
        return _totalUnclaimedAtEpoch(context);
    }

    /**
     * @notice `account`'s unclaimed assets
     * @param account Account to query unclaimed balance of
     * @return `account`'s unclaimed assets
     */
    function unclaimed(address account) external view returns (UFixed18) {
        (, EpochContext memory accountContext) = _loadContextForRead(account);
        return _unclaimedAtEpoch(accountContext, account);
    }

    /**
     * @notice Converts a given amount of assets to shares
     * @param assets Number of assets to convert to shares
     * @return Amount of shares for the given assets
     */
    function convertToShares(UFixed18 assets) external view returns (UFixed18) {
        (EpochContext memory context, ) = _loadContextForRead(address(0));
        (context.latestCollateral, context.latestShares) =
            (_totalAssetsAtEpoch(context), _totalSupplyAtEpoch(context));
        return _convertToSharesAtEpoch(context, assets);
    }

    /**
     * @notice Converts a given amount of shares to assets
     * @param shares Number of shares to convert to assets
     * @return Amount of assets for the given shares
     */
    function convertToAssets(UFixed18 shares) external view returns (UFixed18) {
        (EpochContext memory context, ) = _loadContextForRead(address(0));
        (context.latestCollateral, context.latestShares) =
            (_totalAssetsAtEpoch(context), _totalSupplyAtEpoch(context));
        return _convertToAssetsAtEpoch(context, shares);
    }

    /**
     * @notice Hook that is called before every stateful operation
     * @dev Settles the vault's account on both the long and short product, along with any global or user-specific deposits/redemptions
     * @param account The account that called the operation, or 0 if called by a keeper.
     * @return context The current version contexts for each market
     * @return accountContext The current version contexts for each market for the given account
     */
    function _settle(address account) private returns (EpochContext memory context, EpochContext memory accountContext) {
        (context, accountContext) = _loadContextForWrite(account);

        if (context.epoch > _latestEpoch) {
            _delayedMint(_totalSupplyAtEpoch(context).sub(_totalSupply));
            _totalUnclaimed = _totalUnclaimedAtEpoch(context);
            _deposit = UFixed18Lib.ZERO;
            _redemption = UFixed18Lib.ZERO;
            _latestEpoch = context.epoch;

            for (uint256 marketId; marketId < totalMarkets; marketId++) {
                MarketEpoch storage marketEpoch = _marketAccounts[marketId].epochs[context.epoch];

                marketEpoch.longPosition = markets(marketId).long.position(address(this)).maker;
                marketEpoch.shortPosition = markets(marketId).short.position(address(this)).maker;
                marketEpoch.longAssets = collateral.collateral(address(this), markets(marketId).long);
                marketEpoch.shortAssets = collateral.collateral(address(this), markets(marketId).short);
                //TODO: stamp version?
            }
            _epochs[context.epoch].totalShares = _totalSupply;
            _epochs[context.epoch].idleAssets = asset.balanceOf();
        }

        if (account != address(0) && accountContext.epoch > _latestEpochs[account]) {
            _delayedMintAccount(account, _balanceOfAtEpoch(accountContext, account).sub(_balanceOf[account]));
            _unclaimed[account] = _unclaimedAtEpoch(accountContext, account);
            _deposits[account] = UFixed18Lib.ZERO;
            _redemptions[account] = UFixed18Lib.ZERO;
            _latestEpochs[account] = accountContext.epoch;
        }
    }

    /**
     * @notice Rebalances the collateral and position of the vault
     * @dev Rebalance is executed on best-effort, any failing legs of the strategy will not cause a revert
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalance(EpochContext memory context, UFixed18 claimAmount) private {
        _rebalanceCollateral(claimAmount);
        _rebalancePosition(context, claimAmount);
    }

    /**
     * @notice Rebalances the collateral of the vault
     * @param claimAmount The amount of assets that will be withdrawn from the vault at the end of the operation
     */
    function _rebalanceCollateral(UFixed18 claimAmount) private {
        // Compute target collateral
        UFixed18 targetCollateral = _assets().sub(claimAmount).div(TWO);
        if (targetCollateral.muldiv(minWeight, totalWeight).lt(controller.minCollateral()))
            targetCollateral = UFixed18Lib.ZERO;

        // Remove collateral from markets above target
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            UFixed18 marketCollateral = targetCollateral.muldiv(markets(marketId).weight, totalWeight);
            if (collateral.collateral(address(this), markets(marketId).long).gt(marketCollateral))
                PerennialLib.updateCollateral(collateral, markets(marketId).long, marketCollateral);
            if (collateral.collateral(address(this), markets(marketId).short).gt(marketCollateral))
                PerennialLib.updateCollateral(collateral, markets(marketId).short, marketCollateral);
        }

        // Deposit collateral to markets below target
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            UFixed18 marketCollateral = targetCollateral.muldiv(markets(marketId).weight, totalWeight);
            if (collateral.collateral(address(this), markets(marketId).long).lt(marketCollateral))
                PerennialLib.updateCollateral(collateral, markets(marketId).long, marketCollateral);
            if (collateral.collateral(address(this), markets(marketId).short).lt(marketCollateral))
                PerennialLib.updateCollateral(collateral, markets(marketId).short, marketCollateral);
        }

        // TODO: Don't withdraw all if it would revert
    }

    //TODO: natspec
    /**
     * @notice Rebalances the position of the vault
     */
    function _rebalancePosition(EpochContext memory context, UFixed18 claimAmount) private {
        // Compute target collateral
        UFixed18 targetCollateral = _totalAssetsAtEpoch(context).sub(claimAmount)     // TODO: why is this not symmetrical?
            .mul(_totalSupply).unsafeDiv(_totalSupply.add(_redemption))                    // TODO: add buffer
            .add(_deposit)
            .div(TWO);
        if (targetCollateral.muldiv(minWeight, totalWeight).lt(controller.minCollateral()))
            targetCollateral = UFixed18Lib.ZERO;

        // Target new maker position per market price and weight
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            UFixed18 marketCollateral = targetCollateral.muldiv(markets(marketId).weight, totalWeight);
            if (markets(marketId).long.closed() || markets(marketId).short.closed()) marketCollateral = UFixed18Lib.ZERO;

            uint256 version = _marketAccounts[marketId].versionOf[context.epoch];
            UFixed18 currentPrice = markets(marketId).long.atVersion(version).price.abs();
            UFixed18 targetPosition = marketCollateral.mul(targetLeverage).div(currentPrice);

            PerennialLib.updateMakerPosition(markets(marketId).long, targetPosition);
            PerennialLib.updateMakerPosition(markets(marketId).short, targetPosition);
        }
    }

    /**
     * @notice Burns `amount` shares from `from`, adjusting totalSupply
     * @param from Address to burn shares from
     * @param amount Amount of shares to burn
     */
    function _burn(address from, UFixed18 amount) private {
        _balanceOf[from] = _balanceOf[from].sub(amount);
        _totalSupply = _totalSupply.sub(amount);
        // TODO: burn event
    }

    /**
     * @notice Mints `amount` shares, adjusting totalSupply
     * @param amount Amount of shares to mint
     */
    function _delayedMint(UFixed18 amount) private {
        _totalSupply = _totalSupply.add(amount);
    }

    /**
     * @notice Mints `amount` shares to `to`
     * @param to Address to mint shares to
     * @param amount Amount of shares to mint
     */
    function _delayedMintAccount(address to, UFixed18 amount) private {
        _balanceOf[to] = _balanceOf[to].add(amount);
        // TODO: delayed mint event
    }

    /**
     * @notice Decrements `spender`s allowance for `account` by `amount`
     * @dev Does not decrement if approval is for -1
     * @param account Address of allower
     * @param spender Address of spender
     * @param amount Amount to decrease allowance by
     */
    function _consumeAllowance(address account, address spender, UFixed18 amount) private {
        if (allowance[account][spender].eq(UFixed18Lib.MAX)) return;
        allowance[account][spender] = allowance[account][spender].sub(amount);
    }

    /**
     * @notice Loads the context for the given `account`, settling the vault first
     * @param account Account to load the context for
     * @return global epoch context
     * @return account epoch context
     */
    function _loadContextForWrite(address account) private returns (EpochContext memory, EpochContext memory) {
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            markets(marketId).long.settleAccount(address(this));
            markets(marketId).short.settleAccount(address(this));
        }

        return _loadContextForRead(account);
    }

    /**
     * @notice Loads the context for the given `account`
     * @param account Account to load the context for
     * @return global epoch context
     * @return account epoch context
     */
    function _loadContextForRead(address account) private view returns (EpochContext memory, EpochContext memory) {
        // TODO: what should currentEpoch be?
        return (
            EpochContext(_latestEpoch, _assetsAtEpoch(_latestEpoch), _sharesAtEpoch(_latestEpoch)),
            EpochContext(_latestEpoch, _assetsAtEpoch(_latestEpochs[account]), _sharesAtEpoch(_latestEpochs[account]))
        );
    }

    /**
     * @notice The maximum available deposit amount at the given version
     * @param context Version context to use in calculation
     * @return Maximum available deposit amount at version
     */
    function _maxDepositAtEpoch(EpochContext memory context) private view returns (UFixed18) {
        if (_unhealthyAtEpoch(context)) return UFixed18Lib.ZERO;
        UFixed18 currentCollateral = _totalAssetsAtEpoch(context).add(_deposit);
        return maxCollateral.gt(currentCollateral) ? maxCollateral.sub(currentCollateral) : UFixed18Lib.ZERO;
    }

    /**
     * @notice The maximum available redeemable amount at the given version for `account`
     * @param context Version context to use in calculation
     * @param accountContext Account version context to use in calculation
     * @param account Account to calculate redeemable amount
     * @return Maximum available redeemable amount at version
     */
    function _maxRedeemAtEpoch(
        EpochContext memory context,
        EpochContext memory accountContext,
        address account
    ) private view returns (UFixed18) {
        if (_unhealthyAtEpoch(context)) return UFixed18Lib.ZERO;
        return _balanceOfAtEpoch(accountContext, account);
    }

    /**
     * @notice Calculates whether or not the vault is in an unhealthy state at the provided version
     * @param context Version context to calculate health
     * @return bool true if unhealthy, false if healthy
     */
    function _unhealthyAtEpoch(EpochContext memory context) private view returns (bool) {
        if (!context.latestShares.isZero() && context.latestCollateral.isZero()) return true;
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            if (markets(marketId).unhealthy(collateral)) return true;
        }
        return false;
    }

    /**
     * @notice The total assets at the given version
     * @param context Version context to use in calculation
     * @return Total assets amount at version
     */
    function _totalAssetsAtEpoch(EpochContext memory context) private view returns (UFixed18) {
        (UFixed18 totalCollateral, UFixed18 totalDebt) = (_assets(), _totalUnclaimedAtEpoch(context).add(_deposit));
        return totalCollateral.gt(totalDebt) ? totalCollateral.sub(totalDebt) : UFixed18Lib.ZERO;
    }

    /**
     * @notice The total supply at the given version
     * @param context Version context to use in calculation
     * @return Total supply amount at version
     */
    function _totalSupplyAtEpoch(EpochContext memory context) private view returns (UFixed18) {
        if (context.epoch == _latestEpoch) return _totalSupply;
        return _totalSupply.add(_convertToSharesAtEpoch(context, _deposit));
    }

    /**
     * @notice The balance of `account` at the given version
     * @param accountContext Account version context to use in calculation
     * @param account Account to calculate balance of amount
     * @return Account balance at version
     */
    function _balanceOfAtEpoch(EpochContext memory accountContext, address account) private view returns (UFixed18) {
        if (accountContext.epoch == _latestEpochs[account]) return _balanceOf[account];
        return _balanceOf[account].add(_convertToSharesAtEpoch(accountContext, _deposits[account]));
    }

    /**
     * @notice The total unclaimed assets at the given version
     * @param context Version context to use in calculation
     * @return Total unclaimed asset amount at version
     */
    function _totalUnclaimedAtEpoch(EpochContext memory context) private view returns (UFixed18) {
        if (context.epoch == _latestEpoch) return _totalUnclaimed;
        return _totalUnclaimed.add(_convertToAssetsAtEpoch(context, _redemption));
    }

    /**
     * @notice The total unclaimed assets at the given version for `account`
     * @param accountContext Account version context to use in calculation
     * @param account Account to calculate unclaimed assets for
     * @return Total unclaimed asset amount for `account` at version
     */
    function _unclaimedAtEpoch(EpochContext memory accountContext, address account) private view returns (UFixed18) {
        if (accountContext.epoch == _latestEpochs[account]) return _unclaimed[account];
        return _unclaimed[account].add(_convertToAssetsAtEpoch(accountContext, _redemptions[account]));
    }

    /**
     * @notice Returns the amounts of the individual sources of assets in the vault
     * @return value The real amount of collateral in the vault
     **/
    function _assets() public view returns (UFixed18 value) {
        value = asset.balanceOf();
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
           value = value
                .add(collateral.collateral(address(this), markets(marketId).long))
                .add(collateral.collateral(address(this), markets(marketId).short));
        }
    }

    /**
     * @notice Converts a given amount of assets to shares at version
     * @param context Version context to use in calculation
     * @param assets Number of assets to convert to shares
     * @return Amount of shares for the given assets at version
     */
    function _convertToSharesAtEpoch(EpochContext memory context, UFixed18 assets) private pure returns (UFixed18) {
        if (context.latestCollateral.isZero()) return assets;
        return assets.muldiv(context.latestShares, context.latestCollateral);
    }

    /**
     * @notice Converts a given amount of shares to assets at version
     * @param context Version context to use in calculation
     * @param shares Number of shares to convert to shares
     * @return Amount of assets for the given shares at version
     */
    function _convertToAssetsAtEpoch(EpochContext memory context, UFixed18 shares) private pure returns (UFixed18) {
        if (context.latestShares.isZero()) return shares;
        return shares.muldiv(context.latestCollateral, context.latestShares);
    }

    /**
     * @notice The total assets at the given version
     * @dev Calculates and adds accumulated PnL for `version` + 1
     * @param epoch Epoch to get total assets at
     * @return assets Total assets in the vault at the given version
     */
    function _assetsAtEpoch(uint256 epoch) private view returns (UFixed18 assets) {
        assets = _epochs[epoch].idleAssets;
        for (uint256 marketId; marketId < totalMarkets; marketId++) {
            assets = assets.add(_marketAccounts[marketId].assetsAtEpoch(markets(marketId), epoch));
        }
    }

    /**
     * @notice The total shares at the given version
     * @param epoch Epoch to get total shares at
     * @return Total shares at `version`
     */
    function _sharesAtEpoch(uint256 epoch) private view returns (UFixed18) {
        return _epochs[epoch].totalShares;
    }
}
