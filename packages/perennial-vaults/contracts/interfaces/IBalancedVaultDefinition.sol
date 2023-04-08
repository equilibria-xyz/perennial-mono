//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial/contracts/interfaces/IProduct.sol";
import "@equilibria/perennial/contracts/interfaces/IController.sol";
import "./types/MarketDefinition.sol";

interface IBalancedVaultDefinition {
    error BalancedVaultDefinitionInvalidMarketIdError();

    function asset() external view returns (Token18);
    function totalMarkets() external view returns (uint256);
    function totalWeight() external view returns (uint256);
    function controller() external view returns (IController);
    function collateral() external view returns (ICollateral);
    function targetLeverage() external view returns (UFixed18);
    function maxCollateral() external view returns (UFixed18);
    function markets(uint256 market) external view returns (MarketDefinition memory);
}
