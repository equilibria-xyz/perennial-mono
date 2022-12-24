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
        Fixed6 rate;
        Fixed6 dailyRate;
        OracleVersion latestVersion;
        Fixed6 collateral;
        Position position;
        Fee fee;
        UFixed6 openMakerInterest;
        UFixed6 openTakerInterest;
    }

    /// @dev Snapshot of User state for a Market
    struct UserMarketSnapshot {
        address marketAddress;
        address userAddress;
        Fixed6 collateral;
        UFixed6 maintenance;
        Fixed6 next;
        Fixed6 position;
        bool liquidatable;
        Fixed6 openInterest;
        Fixed6 exposure;
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
    function collateral(IMarket market) external returns (Fixed6);
    function fees(IMarket market) external returns (Fee memory);
    function position(IMarket market) external returns (Position memory);
    function latestVersion(IMarket market) external returns (OracleVersion memory);
    function atVersions(IMarket market, uint[] memory versions) external returns (OracleVersion[] memory);
    function rate(IMarket market) external returns (Fixed6);
    function openInterest(IMarket market) external returns (UFixed6, UFixed6);
    function dailyRate(IMarket market) external returns (Fixed6);

    // UserMarket Values
    function collateral(address account, IMarket market) external returns (Fixed6);
    function maintenance(address account, IMarket market) external returns (UFixed6);
    function maintenanceNext(address account, IMarket market) external returns (UFixed6);
    function liquidatable(address account, IMarket market) external returns (bool);
    function next(address account, IMarket market) external returns (Fixed6);
    function position(address account, IMarket market) external returns (Fixed6);
    function userPosition(address account, IMarket market) external returns (Fixed6, Fixed6);
    function openInterest(address account, IMarket market) external returns (Fixed6);
    function exposure(address account, IMarket market) external returns (Fixed6);
    function maintenanceRequired(
        address account,
        IMarket market,
        Fixed6 positionSize
    ) external returns (UFixed6);
}
