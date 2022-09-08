// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/perennial-oracle/contracts/interfaces/IOracleProvider.sol";
import "./IProduct.sol";
import "./ICollateral.sol";
import "./IController.sol";

interface IPerennialLens {
    function controller() external view returns (IController);
    function name(IProduct product) external view returns (string memory);
    function symbol(IProduct product) external view returns (string memory);
    function collateral() external view returns (ICollateral);
    function collateral(address account, IProduct product) external returns (UFixed18);
    function collateral(IProduct product) external returns (UFixed18);
    function shortfall(IProduct product) external returns (UFixed18);
    function maintenance(address account, IProduct product) external returns (UFixed18);
    function liquidatable(address account, IProduct product) external returns (bool);
    function pre(address account, IProduct product) external returns (PrePosition memory);
    function pre(IProduct product) external returns (PrePosition memory);
    function position(address account, IProduct product) external returns (Position memory);
    function position(IProduct product) external returns (Position memory);
    function userPosition(address account, IProduct product) external returns (PrePosition memory, Position memory);
    function globalPosition(IProduct product) external returns (PrePosition memory, Position memory);
    function price(IProduct product) external returns (Fixed18);
    function priceAtVersion(IProduct product, uint version) external returns (Fixed18);
    function pricesAtVersions(IProduct product, uint[] memory versions) external returns (Fixed18[] memory prices);
    function fees(IProduct product) external returns (UFixed18 protocolFees, UFixed18 productFees);
    function fees(address account, IProduct[] memory products) external returns (UFixed18);
    function openInterest(address account, IProduct product) external returns (Position memory);
    function openInterest(IProduct product) external returns (Position memory);
    function rate(IProduct product) external returns (Fixed18);
    function dailyRate(IProduct product) external returns (Fixed18);
    function maintenanceRequired(
        address account,
        IProduct product,
        UFixed18 positionSize
    ) external returns (UFixed18);
    function unclaimedIncentiveRewards(address account, IProduct product)
        external
        returns (Token18[] memory tokens, UFixed18[] memory amounts);
    function unclaimedIncentiveRewards(
        address account,
        IProduct product,
        uint256[] calldata programIds
    ) external returns (Token18[] memory tokens, UFixed18[] memory amounts);
}
