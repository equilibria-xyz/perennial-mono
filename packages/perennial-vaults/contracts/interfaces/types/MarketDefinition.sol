//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial/contracts/interfaces/IProduct.sol";
import "@equilibria/perennial/contracts/interfaces/ICollateral.sol";

struct MarketDefinition {
    IProduct long;
    IProduct short;
    uint256 weight;
}
using MarketDefinitionLib for MarketDefinition global;

library MarketDefinitionLib {
    /**
     * @notice Determines whether the market pair is currently in an unhealthy state
     * @dev market is unhealthy if either the long or short markets are liquidating or liquidatable
     * @param marketDefinition The configuration of the market
     * @param collateral The perennial collateral contract
     * @return bool true if unhealthy, false if healthy
     */
    function unhealthy(MarketDefinition memory marketDefinition, ICollateral collateral) internal view returns (bool) {
        return collateral.liquidatable(address(this), marketDefinition.long)
            || collateral.liquidatable(address(this), marketDefinition.short)
            || marketDefinition.long.isLiquidating(address(this))
            || marketDefinition.short.isLiquidating(address(this));
    }
}