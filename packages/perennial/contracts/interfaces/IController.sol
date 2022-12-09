// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "./IProduct.sol";
import "./types/PayoffDefinition.sol";
import "../controller/types/ProtocolParameter.sol"; //TODO: not right package

interface IController {
    event ProductBeaconUpdated(IBeacon newProductBeacon);
    event ParameterUpdated(ProtocolParameter newParameter);
    event LiquidationFeeUpdated(UFixed18 newLiquidationFee);
    event TreasuryUpdated(address newTreasury);
    event PauserUpdated(address newPauser);
    event ProductCreated(IProduct indexed product, IProduct.ProductDefinition definition, Parameter parameter);

    error ControllerNotPauserError();
    error ControllerInvalidLiquidationFeeError();
    error ControllerNotContractAddressError();

    function productBeacon() external view returns (IBeacon);
    function parameter() external view returns (ProtocolParameter memory);
    function liquidationFee() external view returns (UFixed18);
    function treasury() external view returns (address);
    function pauser() external view returns (address);
    function initialize(IBeacon productBeacon_) external;
    function updateTreasury(address newTreasury) external;
    function createProduct(IProduct.ProductDefinition calldata definition, Parameter calldata parameter) external returns (IProduct);
    function updateProductBeacon(IBeacon newProductBeacon) external;
    function updateParameter(ProtocolParameter memory newParameter) external;
    function updateLiquidationFee(UFixed18 newLiquidationFee) external;
    function updatePauser(address newPauser) external;
    function updatePaused(bool newPaused) external;
}
