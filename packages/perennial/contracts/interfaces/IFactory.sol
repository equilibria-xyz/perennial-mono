// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "./IMarket.sol";
import "../types/PayoffDefinition.sol";
import "../types/ProtocolParameter.sol";

interface IFactory {
    event MarketBeaconUpdated(IBeacon newMarketBeacon);
    event ParameterUpdated(ProtocolParameter newParameter);
    event LiquidationFeeUpdated(UFixed18 newLiquidationFee);
    event TreasuryUpdated(address newTreasury);
    event PauserUpdated(address newPauser);
    event MarketCreated(IMarket indexed market, IMarket.MarketDefinition definition, Parameter parameter);

    error FactoryNotPauserError();
    error FactoryPausedError();
    error FactoryInvalidLiquidationFeeError();
    error FactoryNotContractAddressError();

    function marketBeacon() external view returns (IBeacon);
    function parameter() external view returns (ProtocolParameter memory);
    function liquidationFee() external view returns (UFixed18);
    function treasury() external view returns (address);
    function pauser() external view returns (address);
    function initialize(IBeacon marketBeacon_) external;
    function updateTreasury(address newTreasury) external;
    function createMarket(IMarket.MarketDefinition calldata definition, Parameter calldata parameter) external returns (IMarket);
    function updateMarketBeacon(IBeacon newMarketBeacon) external;
    function updateParameter(ProtocolParameter memory newParameter) external;
    function updateLiquidationFee(UFixed18 newLiquidationFee) external;
    function updatePauser(address newPauser) external;
    function updatePaused(bool newPaused) external;
}
