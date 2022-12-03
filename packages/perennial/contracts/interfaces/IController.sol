// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "./IProduct.sol";
import "./types/PayoffDefinition.sol";
import "../controller/types/ProtocolParameter.sol"; //TODO: not right package

interface IController {
    /// @dev Coordinator of a one or many products
    struct Coordinator {
        /// @dev Pending owner of the product, can accept ownership
        address pendingOwner;

        /// @dev Owner of the product, allowed to update select parameters
        address owner;

        /// @dev Treasury of the product, collects fees
        address treasury;
    }

    event ProductBeaconUpdated(IBeacon newProductBeacon);
    event ParameterUpdated(ProtocolParameter newParameter);
    event LiquidationFeeUpdated(UFixed18 newLiquidationFee);
    event PauserUpdated(address newPauser);
    event CoordinatorPendingOwnerUpdated(uint256 indexed coordinatorId, address newPendingOwner);
    event CoordinatorOwnerUpdated(uint256 indexed coordinatorId, address newOwner);
    event CoordinatorTreasuryUpdated(uint256 indexed coordinatorId, address newTreasury);
    event CoordinatorCreated(uint256 indexed coordinatorId, address owner);
    event ProductCreated(IProduct indexed product, IProduct.ProductDefinition definition, Parameter parameter);

    error ControllerNoZeroCoordinatorError();
    error ControllerNotPauserError();
    error ControllerNotOwnerError(uint256 controllerId);
    error ControllerNotPendingOwnerError(uint256 controllerId);
    error ControllerInvalidLiquidationFeeError();
    error ControllerNotContractAddressError();

    function productBeacon() external view returns (IBeacon);
    function coordinators(uint256 collateralId) external view returns (Coordinator memory);
    function coordinatorFor(IProduct product) external view returns (uint256);
    function parameter() external view returns (ProtocolParameter memory);
    function liquidationFee() external view returns (UFixed18);
    function pauser() external view returns (address);
    function initialize(IBeacon productBeacon_) external;
    function createCoordinator() external returns (uint256);
    function updateCoordinatorPendingOwner(uint256 coordinatorId, address newPendingOwner) external;
    function acceptCoordinatorOwner(uint256 coordinatorId) external;
    function updateCoordinatorTreasury(uint256 coordinatorId, address newTreasury) external;
    function createProduct(
        uint256 coordinatorId,
        IProduct.ProductDefinition calldata definition,
        Parameter calldata parameter
    ) external returns (IProduct);
    function updateProductBeacon(IBeacon newProductBeacon) external;
    function updateParameter(ProtocolParameter memory newParameter) external;
    function updateLiquidationFee(UFixed18 newLiquidationFee) external;
    function updatePauser(address newPauser) external;
    function updatePaused(bool newPaused) external;
    function isProduct(IProduct product) external view returns (bool);
    function owner() external view returns (address);
    function owner(uint256 coordinatorId) external view returns (address);
    function owner(IProduct product) external view returns (address);
    function treasury() external view returns (address);
    function treasury(uint256 coordinatorId) external view returns (address);
    function treasury(IProduct product) external view returns (address);
    function settlementParameters() external returns (ProtocolParameter memory, address);
}
