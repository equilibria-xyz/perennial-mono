// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "./IMarket.sol";
import "../types/ProtocolParameter.sol";

interface IFactory is IBeacon {
    event ParameterUpdated(ProtocolParameter newParameter);
    event TreasuryUpdated(address newTreasury);
    event PauserUpdated(address newPauser);
    event MarketCreated(IMarket indexed market, IMarket.MarketDefinition definition, MarketParameter marketParameter);

    error FactoryNotPauserError();
    error FactoryPausedError();
    error FactoryNotContractAddressError();

    function parameter() external view returns (ProtocolParameter memory);
    function treasury() external view returns (address);
    function pauser() external view returns (address);
    function initialize() external;
    function updateParameter(ProtocolParameter memory newParameter) external;
    function updateTreasury(address newTreasury) external;
    function updatePauser(address newPauser) external;
    function createMarket(IMarket.MarketDefinition calldata definition, MarketParameter calldata marketParameter) external returns (IMarket);
    function updatePaused(bool newPaused) external;
}
