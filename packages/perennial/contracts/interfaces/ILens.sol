// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./IOracleProvider.sol";
import "./IMarket.sol";
import "./IFactory.sol";

/**
 * @title Lens contract to conveniently pull protocol, market, and usermarket data
 * @notice All functions should be called using `callStatic`
 */
interface ILens {
    /// @dev Snapshot of Market information
    struct MarketSnapshot {
        IMarket.MarketDefinition definition;
        MarketParameter parameter;
        address marketAddress;
        Fixed18 rate;
        Fixed18 dailyRate;
        OracleVersion latestVersion;
        Fixed18 collateral;
        PrePosition pre;
        Position position;
        Fee fee;
        UFixed18 openMakerInterest;
        UFixed18 openTakerInterest;
    }

    /// @dev Snapshot of User state for a Market
    struct UserMarketSnapshot {
        address marketAddress;
        address userAddress;
        Fixed18 collateral;
        UFixed18 maintenance;
        Fixed18 pre;
        Fixed18 position;
        bool liquidatable;
        bool liquidating;
        Fixed18 openInterest;
        Fixed18 exposure;
    }

    // Protocol Values
    function factory() external view returns (IFactory);

    // Snapshot Functions for batch values
    function snapshots(IMarket[] calldata marketAddresses) external returns (MarketSnapshot[] memory);
    function snapshot(IMarket market) external returns (MarketSnapshot memory);
    function snapshots(address account, IMarket[] calldata marketAddresses) external returns (UserMarketSnapshot[] memory);
    function snapshot(address account, IMarket market) external returns (UserMarketSnapshot memory);

    // Market Values
    function name(IMarket market) external view returns (string memory);
    function symbol(IMarket market) external view returns (string memory);
    function token(IMarket market) external view returns (Token18);
    function definition(IMarket market) external view returns (IMarket.MarketDefinition memory);
    function parameter(IMarket market) external view returns (MarketParameter memory);
    function collateral(IMarket market) external returns (Fixed18);
    function pre(IMarket market) external returns (PrePosition memory);
    function fees(IMarket market) external returns (Fee memory);
    function position(IMarket market) external returns (Position memory);
    function globalPosition(IMarket market) external returns (PrePosition memory, Position memory);
    function latestVersion(IMarket market) external returns (OracleVersion memory);
    function atVersions(IMarket market, uint[] memory versions) external returns (OracleVersion[] memory);
    function rate(IMarket market) external returns (Fixed18);
    function openInterest(IMarket market) external returns (UFixed18, UFixed18);
    function dailyRate(IMarket market) external returns (Fixed18);

    // UserMarket Values
    function collateral(address account, IMarket market) external returns (Fixed18);
    function maintenance(address account, IMarket market) external returns (UFixed18);
    function maintenanceNext(address account, IMarket market) external returns (UFixed18);
    function liquidatable(address account, IMarket market) external returns (bool);
    function liquidating(address account, IMarket market) external returns (bool);
    function pre(address account, IMarket market) external returns (Fixed18);
    function position(address account, IMarket market) external returns (Fixed18);
    function userPosition(address account, IMarket market) external returns (Fixed18, Fixed18);
    function openInterest(address account, IMarket market) external returns (Fixed18);
    function exposure(address account, IMarket market) external returns (Fixed18);
    function maintenanceRequired(
        address account,
        IMarket market,
        Fixed18 positionSize
    ) external returns (UFixed18);
}
