//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../interfaces/IBalancedVaultDefinition.sol";

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
contract BalancedVaultDefinition is IBalancedVaultDefinition {
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

    /// @dev The product corresponding to the long of each payoff
    IProduct private immutable long0;
    // IProduct private immutable long1;

    /// @dev The product corresponding to the short of each payoff
    IProduct private immutable short0;
    // IProduct private immutable short1;

    /// @dev The the weight of each given payoff in the vault
    uint256 private immutable weight0;
    // uint256 private immutable weight1;

    constructor(
        Token18 asset_,
        IController controller_,
        UFixed18 targetLeverage_,
        UFixed18 maxCollateral_,
        MarketDefinition[1] memory marketDefinitions_
    ) {
        asset = asset_;
        controller = controller_;
        collateral = controller_.collateral();
        targetLeverage = targetLeverage_;
        maxCollateral = maxCollateral_;

        totalMarkets = marketDefinitions_.length;
        uint256 totalWeight_;

        long0 = marketDefinitions_[0].long;
        short0 = marketDefinitions_[0].short;
        weight0 = marketDefinitions_[0].weight;
        totalWeight_ += marketDefinitions_[0].weight;

//        long1 = marketDefinitions_[1].long;
//        short1 = marketDefinitions_[1].short;
//        weight1 = marketDefinitions_[1].weight;
//        totalWeight_ += marketDefinitions_[1].weight;

        totalWeight = totalWeight_;
    }

    /**
     * @notice Returns the market definition for a market
     * @param marketId The market ID to get products for
     * @return market The market definition
     */
    function markets(uint256 marketId) public view returns (MarketDefinition memory market) {
        if (marketId == 0) {
            market.long = long0;
            market.short = short0;
            market.weight = weight0;
//        } else if (marketId == 1) {
//            market.long = long1;
//            market.short = short1;
//            market.weight = weight1;
        } else {
            revert BalancedVaultDefinitionInvalidMarketIdError();
        }
    }
}
