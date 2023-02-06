// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-oracle/contracts/interfaces/IOracleProvider.sol";
import "./IProduct.sol";
import "./ICollateral.sol";
import "./IController.sol";

/**
 * @title Lens contract to conveniently pull protocol, product, and userproduct data
 * @notice All functions should be called using `callStatic`
 */
interface IPerennialLens {
    /// @dev Snapshot of Protocol information
    struct ProtocolSnapshot {
        ICollateral collateral;
        IIncentivizer incentivizer;
        Token18 collateralToken;
        UFixed18 protocolFee;
        UFixed18 liquidationFee;
        UFixed18 minCollateral;
        bool paused;
    }

    /// @dev Snapshot of Product information
    struct ProductSnapshot {
        IProduct.ProductInfo productInfo;
        address productAddress;
        Fixed18 rate;
        Fixed18 dailyRate;
        IOracleProvider.OracleVersion latestVersion;
        UFixed18 maintenance;
        UFixed18 collateral;
        UFixed18 shortfall;
        PrePosition pre;
        Position position;
        UFixed18 productFee;
        UFixed18 protocolFee;
        Position openInterest;
    }

    /// @dev Snapshot of User state for a Product
    struct UserProductSnapshot {
        address productAddress;
        address userAddress;
        UFixed18 collateral;
        UFixed18 maintenance;
        PrePosition pre;
        Position position;
        bool liquidatable;
        bool liquidating;
        Position openInterest;
        UFixed18 fees;
        UFixed18 exposure;
    }

    // Protocol Values
    function controller() external view returns (IController);
    function collateral() external view returns (ICollateral);

    // Snapshot Functions for batch values
    function snapshot() external returns (ProtocolSnapshot memory);
    function snapshots(IProduct[] calldata productAddresses) external returns (ProductSnapshot[] memory);
    function snapshot(IProduct product) external returns (ProductSnapshot memory);
    function snapshots(address account, IProduct[] calldata productAddresses) external returns (UserProductSnapshot[] memory);
    function snapshot(address account, IProduct product) external returns (UserProductSnapshot memory);

    // Product Values
    function name(IProduct product) external view returns (string memory);
    function symbol(IProduct product) external view returns (string memory);
    function info(IProduct product) external view returns (IProduct.ProductInfo memory _info);
    function collateral(IProduct product) external returns (UFixed18);
    function shortfall(IProduct product) external returns (UFixed18);
    function pre(IProduct product) external returns (PrePosition memory);
    function fees(IProduct product) external returns (UFixed18 protocolFees, UFixed18 productFees);
    function position(IProduct product) external returns (Position memory);
    function globalPosition(IProduct product) external returns (PrePosition memory, Position memory);
    function latestVersion(IProduct product) external returns (IOracleProvider.OracleVersion memory);
    function atVersions(IProduct product, uint[] memory versions) external returns (IOracleProvider.OracleVersion[] memory prices);
    function rate(IProduct product) external returns (Fixed18);
    function openInterest(IProduct product) external returns (Position memory);
    function dailyRate(IProduct product) external returns (Fixed18);

    // UserProduct Values
    function collateral(address account, IProduct product) external returns (UFixed18);
    function maintenance(address account, IProduct product) external returns (UFixed18);
    function liquidatable(address account, IProduct product) external returns (bool);
    function liquidating(address account, IProduct product) external returns (bool);
    function pre(address account, IProduct product) external returns (PrePosition memory);
    function position(address account, IProduct product) external returns (Position memory);
    function userPosition(address account, IProduct product) external returns (PrePosition memory, Position memory);
    function fees(address account, IProduct product) external returns (UFixed18);
    function openInterest(address account, IProduct product) external returns (Position memory);
    function exposure(address account, IProduct product) external returns (UFixed18);
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
