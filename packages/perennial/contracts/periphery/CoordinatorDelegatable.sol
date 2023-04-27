// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../interfaces/IProduct.sol";

/**
 * @title CoordinatorDelegatable
 * @notice Helper contract to allow delegating param updates to address(es)
 * @dev Creates a coordinator which can delegate param updates to a param admin
 *      Functions which the param admin can call are allowlisted. If new params are added, this
 *      owner will not be able to access them unless it is replaced or upgraded (if deployed behind a proxy).
 */
contract CoordinatorDelegatable is UOwnable {

    event CoordinatorDelegatableParamAdminUpdated(address indexed newParamAdmin);

    error CoordinatorDelegatableNotParamAdminError(address sender);

    /// @dev The owner address
    AddressStorage private constant _paramAdmin =
        AddressStorage.wrap(keccak256("equilibria.perennial.CoordinatorDelegatable.paramAdmin"));
    function paramAdmin() public view returns (address) { return _paramAdmin.read(); }

    /**
     * @notice Initializes the coordinator owner contract
     * @dev Sets the deployer as the default admin and param admin
     */
    function initialize() public initializer(1) {
        __UOwnable__initialize();
    }

    /**
     * @notice Updates the maintenance parameter for product `product` to `newMaintenance`
     * @dev Only callable by owner or paramAdmin
     * @param product The product to update
     * @param newMaintenance The new maintenance parameter
     */
    function updateMaintenance(IProduct product, UFixed18 newMaintenance) external onlyOwnerOrParamAdmin {
        product.updateMaintenance(newMaintenance);
    }

    /**
     * @notice Updates the funding fee for product `product` to `newFundingFee`
     * @dev Only callable by owner or paramAdmin
     * @param product The product to update
     * @param newFundingFee The new funding fee
     */
    function updateFundingFee(IProduct product, UFixed18 newFundingFee) external onlyOwnerOrParamAdmin {
        product.updateFundingFee(newFundingFee);
    }

    /**
     * @notice Updates the maker fee for product `product` to `newMakerFee`
     * @dev Only callable by owner or paramAdmin
     * @param product The product to update
     * @param newMakerFee The new maker fee
     */
    function updateMakerFee(IProduct product, UFixed18 newMakerFee) external onlyOwnerOrParamAdmin {
        product.updateMakerFee(newMakerFee);
    }

    /**
     * @notice Updates the taker fee for product `product` to `newTakerFee`
     * @dev Only callable by owner or paramAdmin
     * @param product The product to update
     * @param newTakerFee The new taker fee
     */
    function updateTakerFee(IProduct product, UFixed18 newTakerFee) external onlyOwnerOrParamAdmin {
        product.updateTakerFee(newTakerFee);
    }

    /**
     * @notice Updates the position fee for product `product` to `newPositionFee`
     * @dev Only callable by owner or paramAdmin
     * @param product The product to update
     * @param newPositionFee The new position fee
     */
    function updatePositionFee(IProduct product, UFixed18 newPositionFee) external onlyOwnerOrParamAdmin {
        product.updatePositionFee(newPositionFee);
    }

    /**
     * @notice Updates the maker limit for product `product` to `newMakerLimit`
     * @dev Only callable by owner or paramAdmin
     * @param product The product to update
     * @param newMakerLimit The new maker limit
     */
    function updateMakerLimit(IProduct product, UFixed18 newMakerLimit) external onlyOwnerOrParamAdmin {
        product.updateMakerLimit(newMakerLimit);
    }

    /**
     * @notice Updates the utilization curve for product `product` to `newUtilizationCurve`
     * @dev Only callable by owner or paramAdmin
     * @param product The product to update
     * @param newUtilizationCurve The new utilization curve
     */
    function updateUtilizationCurve(IProduct product, JumpRateUtilizationCurve memory newUtilizationCurve) external onlyOwnerOrParamAdmin {
        product.updateUtilizationCurve(newUtilizationCurve);
    }

    /**
     * @notice Updates the param admin to `newParamAdmin`
     * @dev Only callable by the owner
     * @param newParamAdmin address of the new param admin
     */
    function updateParamAdmin(address newParamAdmin) external onlyOwner {
        _paramAdmin.store(newParamAdmin);

        emit CoordinatorDelegatableParamAdminUpdated(newParamAdmin);
    }

    /**
     * @notice Executes an arbitrary function call or value transfer
     * @dev Only callable by the owner
     * @param to The target address
     * @param data The calldata
     * @param value The value to transfer
     */
    function execute(
        address payable to,
        bytes memory data,
        uint256 value
    ) payable external onlyOwner returns (bytes memory ret) {
        if (data.length == 0) {
            Address.sendValue(to, value);
        } else {
            ret = Address.functionCallWithValue(to, data, value);
        }
    }

    modifier onlyOwnerOrParamAdmin {
        if (_sender() != owner() && _sender() != paramAdmin())
            revert CoordinatorDelegatableNotParamAdminError(_sender());
        _;
    }
}
