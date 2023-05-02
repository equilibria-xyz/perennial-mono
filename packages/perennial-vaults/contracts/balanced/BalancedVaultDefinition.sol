//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../interfaces/IBalancedVaultDefinition.sol";

/**
 * @title BalancedVault
 * @notice ERC4626 vault that manages a 50-50 position between long-short markets of the same payoff on Perennial.
 * @dev Vault deploys and rebalances collateral between the corresponding long and short markets, while attempting to
 *      maintain `targetLeverage` with its open positions at any given time. Deposits are only gated in so much as to cap
 *      the maximum amount of assets in the vault. The long and short markets are expected to have the same oracle and
 *      opposing payoff functions.
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
contract BalancedVaultDefinition is IBalancedVaultDefinition {
    IProduct private constant DEFAULT_PRODUCT = IProduct(address(0));
    uint256 private constant DEFAULT_WEIGHT = 0;
    uint256 private constant MAX_MARKETS = 2;

    /// @dev The address of the Perennial controller contract
    IController public immutable controller;

    /// @dev The address of the Perennial collateral contract
    ICollateral public immutable collateral;

    /// @dev The target leverage amount for the vault
    UFixed18 public immutable targetLeverage;

    /// @dev The collateral cap for the vault
    UFixed18 public immutable maxCollateral;

    /// @dev The underlying asset of the vault
    Token18 public immutable asset;

    /// @dev The number of markets in the vault
    uint256 public immutable totalMarkets;

    /// @dev The sum of the weights of all products in the vault
    uint256 public immutable totalWeight;

    /// @dev The minimum of the weights of all products in the vault
    uint256 public immutable minWeight;

    /// @dev The product corresponding to the long of each payoff
    IProduct private immutable long0;
    IProduct private immutable long1;

    /// @dev The product corresponding to the short of each payoff
    IProduct private immutable short0;
    IProduct private immutable short1;

    /// @dev The the weight of each given payoff in the vault
    uint256 private immutable weight0;
    uint256 private immutable weight1;

    /**
     * @notice Constructor for BalancedVaultDefinition
     * @dev previousImplementation_ is an optional feature that gives extra protections against parameter errors during the upgrade process
     * @param controller_ The controller contract
     * @param targetLeverage_ The target leverage for the vault
     * @param maxCollateral_ The maximum amount of collateral that can be held in the vault
     * @param marketDefinitions_ The market definitions for the vault
     * @param previousImplementation_ The previous implementation of the vault. Set to address(0) if there is none
     */
    constructor(
        IController controller_,
        UFixed18 targetLeverage_,
        UFixed18 maxCollateral_,
        MarketDefinition[] memory marketDefinitions_,
        IBalancedVaultDefinition previousImplementation_
    ) {
        if (targetLeverage_.eq(UFixed18Lib.ZERO)) revert BalancedVaultDefinitionZeroTargetLeverageError();

        controller = controller_;
        collateral = controller_.collateral();
        asset = collateral.token();
        targetLeverage = targetLeverage_;

        maxCollateral = maxCollateral_;

        uint256 totalMarkets_ = Math.min(marketDefinitions_.length, MAX_MARKETS);
        if (totalMarkets_ == 0) revert BalancedVaultDefinitionNoMarketsError();
        uint256 totalWeight_;
        uint256 minWeight_ = type(uint256).max;

        long0 = (totalMarkets_ > 0) ? marketDefinitions_[0].long : DEFAULT_PRODUCT;
        short0 = (totalMarkets_ > 0) ? marketDefinitions_[0].short : DEFAULT_PRODUCT;
        weight0 = (totalMarkets_ > 0) ? marketDefinitions_[0].weight : DEFAULT_WEIGHT;

        long1 = (totalMarkets_ > 1) ? marketDefinitions_[1].long : DEFAULT_PRODUCT;
        short1 = (totalMarkets_ > 1) ? marketDefinitions_[1].short : DEFAULT_PRODUCT;
        weight1 = (totalMarkets_ > 1) ? marketDefinitions_[1].weight : DEFAULT_WEIGHT;

        for (uint256 marketId; marketId < totalMarkets_; marketId++) {
            if (!controller.isProduct(marketDefinitions_[marketId].long)) revert BalancedVaultInvalidProductError(marketDefinitions_[marketId].long);
            if (!controller.isProduct(marketDefinitions_[marketId].short)) revert BalancedVaultInvalidProductError(marketDefinitions_[marketId].short);
            if (marketDefinitions_[marketId].long == marketDefinitions_[marketId].short) revert BalancedVaultDefinitionLongAndShortAreSameProductError();
            if (marketDefinitions_[marketId].long.oracle() != marketDefinitions_[marketId].short.oracle()) revert BalancedVaultDefinitionOracleMismatchError();

            PayoffDefinition memory longPayoff = marketDefinitions_[marketId].long.payoffDefinition();
            PayoffDefinition memory shortPayoff = marketDefinitions_[marketId].short.payoffDefinition();
            if (longPayoff.payoffDirection != PayoffDefinitionLib.PayoffDirection.LONG) revert BalancedVaultDefinitionWrongPayoffDirectionError(marketDefinitions_[marketId].long);
            if (shortPayoff.payoffDirection != PayoffDefinitionLib.PayoffDirection.SHORT) revert BalancedVaultDefinitionWrongPayoffDirectionError(marketDefinitions_[marketId].short);
            if (longPayoff.data != shortPayoff.data) revert BalancedVaultDefinitionMismatchedPayoffDataError();

            totalWeight_ += marketDefinitions_[marketId].weight;
            if (minWeight_ > marketDefinitions_[marketId].weight) minWeight_ = marketDefinitions_[marketId].weight;
        }

        if (totalWeight_ == 0) revert BalancedVaultDefinitionAllZeroWeightError();

        totalMarkets = totalMarkets_;
        totalWeight = totalWeight_;
        minWeight = minWeight_;

        if (address(previousImplementation_) != address(0)) {
            // Check that the previous implementation's markets match up to this one.
            uint256 previousTotalMarkets_ = previousImplementation_.totalMarkets();
            if (previousTotalMarkets_ > totalMarkets_) revert BalancedVaultDefinitionMarketsMismatchedWithPreviousImplementationError();
            for (uint256 marketId; marketId < previousTotalMarkets_; marketId++) {
                MarketDefinition memory previousMarket_ = previousImplementation_.markets(marketId);
                if (previousMarket_.long != marketDefinitions_[marketId].long) revert BalancedVaultDefinitionMarketsMismatchedWithPreviousImplementationError();
                if (previousMarket_.short != marketDefinitions_[marketId].short) revert BalancedVaultDefinitionMarketsMismatchedWithPreviousImplementationError();
            }
        }
    }

    /**
     * @notice Returns the market definition for a market
     * @param marketId The market ID to get products for
     * @return market The market definition
     */
    function markets(uint256 marketId) public view returns (MarketDefinition memory market) {
        if (totalMarkets > 0 && marketId == 0) return MarketDefinition(long0, short0, weight0);
        if (totalMarkets > 1 && marketId == 1) return MarketDefinition(long1, short1, weight1);

        revert BalancedVaultDefinitionInvalidMarketIdError();
    }
}
