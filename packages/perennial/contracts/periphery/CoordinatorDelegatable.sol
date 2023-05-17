// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./types/UFixed18ParamLimits.sol";
import "./types/UtilizationCurveLimits.sol";
import "../interfaces/IProduct.sol";

/**
 * @title CoordinatorDelegatable
 * @notice Helper contract to allow delegating param updates to address(es)
 * @dev Creates a coordinator which can delegate param updates to a param admin
 *      Functions which the param admin can call are allowlisted. If new params are added, this
 *      owner will not be able to access them unless it is replaced or upgraded (if deployed behind a proxy).
 */
contract CoordinatorDelegatable is UOwnable {

    /// @dev Event emitted when param admin is updated
    event CoordinatorDelegatableParamAdminUpdated(address indexed newParamAdmin);

    /// @dev Event emitted when a param limit is updated
    event CoordinatorDelegatableParamLimitsUpdated(UFixed18ParamLimits newLimits);

    /// @dev Event emitted when a utilization curve limit is updated
    event CoordinatorDelegatableUtilizationCurveLimitsUpdated(UtilizationCurveLimits newLimits);

    /// @dev Error thrown on unauthorized param update call
    error CoordinatorDelegatableNotParamAdminError(address sender);

    /// @dev Error thrown on invalid param update
    error CoordinatorDelegatableInvalidUFixed18UpdateError(UFixed18 value);

    /// @dev Error thrown on invalid utilization curve update
    error CoordinatorDelegatableInvalidUtilizationCurveUpdateError(JumpRateUtilizationCurve value);

    /// @dev The product this coordinator is for
    IProduct immutable product;

    /// @dev The owner address
    AddressStorage private constant _paramAdmin =
        AddressStorage.wrap(keccak256("equilibria.perennial.CoordinatorDelegatable.paramAdmin"));
    function paramAdmin() public view returns (address) { return _paramAdmin.read(); }

    /// @dev The maintenance value limits
    UFixed18ParamLimitsStorage private constant _maintenanceLimits = UFixed18ParamLimitsStorage.wrap(
        keccak256("equilibria.perennial.CoordinatorDelegatable.maintenanceLimits")
    );
    function maintenanceLimits() public view returns (UFixed18ParamLimits memory) { return _maintenanceLimits.read(); }

    /// @dev The maker fee value limits
    UFixed18ParamLimitsStorage private constant _makerFeeLimits = UFixed18ParamLimitsStorage.wrap(
        keccak256("equilibria.perennial.CoordinatorDelegatable.makerFeeLimits")
    );
    function makerFeeLimits() public view returns (UFixed18ParamLimits memory) { return _makerFeeLimits.read(); }

    /// @dev The taker fee value limits
    UFixed18ParamLimitsStorage private constant _takerFeeLimits = UFixed18ParamLimitsStorage.wrap(
        keccak256("equilibria.perennial.CoordinatorDelegatable.takerFeeLimits")
    );
    function takerFeeLimits() public view returns (UFixed18ParamLimits memory) { return _takerFeeLimits.read(); }

    /// @dev The maker limit value limits
    UFixed18ParamLimitsStorage private constant _makerLimitLimits = UFixed18ParamLimitsStorage.wrap(
        keccak256("equilibria.perennial.CoordinatorDelegatable.makerLimitLimits")
    );
    function makerLimitLimits() public view returns (UFixed18ParamLimits memory) { return _makerLimitLimits.read(); }

    /// @dev The utilization buffer value limits
    UFixed18ParamLimitsStorage private constant _utilizationBufferLimits = UFixed18ParamLimitsStorage.wrap(
        keccak256("equilibria.perennial.CoordinatorDelegatable.utilizationBufferLimits")
    );
    function utilizationBufferLimits() public view returns (UFixed18ParamLimits memory) { return _utilizationBufferLimits.read(); }

    /// @dev The utilization curve limits
    UtilizationCurveLimitsStorage private constant _utilizationCurveLimits = UtilizationCurveLimitsStorage.wrap(
        keccak256("equilibria.perennial.CoordinatorDelegatable.utilizationCurveLimits")
    );
    function utilizationCurveLimits() public view returns (UtilizationCurveLimits memory) { return _utilizationCurveLimits.read(); }

    /**
     * @notice Constructors a new CoordinatorDelegatable
     * @param _product The product this coordinator is for
     */
    constructor(IProduct _product) {
        product = _product;
    }

    /**
     * @notice Initializes the coordinator owner contract
     * @param paramAdmin_ The address of the param admin
     * @param maintenanceLimits_ The maintenance value limits
     * @param makerFeeLimits_ The maker fee value limits
     * @param takerFeeLimits_ The taker fee value limits
     * @param makerLimitLimits_ The maker limit value limits
     * @param utilizationBufferLimits_ The utilization buffer value limits
     * @param utilizationCurveLimits_ The utilization curve limits
     * @dev Sets the deployer as the default admin and param admin
     */
    function initialize(
        address paramAdmin_,
        UFixed18ParamLimits memory maintenanceLimits_,
        UFixed18ParamLimits memory makerFeeLimits_,
        UFixed18ParamLimits memory takerFeeLimits_,
        UFixed18ParamLimits memory makerLimitLimits_,
        UFixed18ParamLimits memory utilizationBufferLimits_,
        UtilizationCurveLimits memory utilizationCurveLimits_
    ) external initializer(1) {
        __UOwnable__initialize();
        updateParamAdmin(paramAdmin_);
        updateMaintenanceLimits(maintenanceLimits_);
        updateMakerFeeLimits(makerFeeLimits_);
        updateTakerFeeLimits(takerFeeLimits_);
        updateMakerLimitLimits(makerLimitLimits_);
        updateUtilizationBufferLimits(utilizationBufferLimits_);
        updateUtilizationCurveLimits(utilizationCurveLimits_);
    }

    /**
     * @notice Updates the maintenance parameter for product `product` to `newMaintenance`
     * @dev Only callable by owner or paramAdmin
     * @param newMaintenance The new maintenance parameter
     */
    function updateMaintenance(UFixed18 newMaintenance) external onlyOwnerOrParamAdmin {
        if (!maintenanceLimits().valid(newMaintenance))
            revert CoordinatorDelegatableInvalidUFixed18UpdateError(newMaintenance);
        product.updateMaintenance(newMaintenance);
    }

    /**
     * @notice Updates the maintenance limit value
     * @param newLimits New maintenance limit value
     */
    function updateMaintenanceLimits(UFixed18ParamLimits memory newLimits) public onlyOwner {
        _maintenanceLimits.store(newLimits);
        emit CoordinatorDelegatableParamLimitsUpdated(newLimits);
    }

    /**
     * @notice Updates the maker fee for product `product` to `newMakerFee`
     * @dev Only callable by owner or paramAdmin
     * @param newMakerFee The new maker fee
     */
    function updateMakerFee(UFixed18 newMakerFee) external onlyOwnerOrParamAdmin {
        if (!makerFeeLimits().valid(newMakerFee))
            revert CoordinatorDelegatableInvalidUFixed18UpdateError(newMakerFee);
        product.updateMakerFee(newMakerFee);
    }

    /**
     * @notice Updates the maker fee limit value
     * @param newLimits New maker fee limit value
     */
    function updateMakerFeeLimits(UFixed18ParamLimits memory newLimits) public onlyOwner {
        _makerFeeLimits.store(newLimits);
        emit CoordinatorDelegatableParamLimitsUpdated(newLimits);
    }

    /**
     * @notice Updates the taker fee for product `product` to `newTakerFee`
     * @dev Only callable by owner or paramAdmin
     * @param newTakerFee The new taker fee
     */
    function updateTakerFee(UFixed18 newTakerFee) external onlyOwnerOrParamAdmin {
        if (!takerFeeLimits().valid(newTakerFee))
            revert CoordinatorDelegatableInvalidUFixed18UpdateError(newTakerFee);
        product.updateTakerFee(newTakerFee);
    }

    /**
     * @notice Updates the taker fee limit value
     * @param newLimits New taker fee limit value
     */
    function updateTakerFeeLimits(UFixed18ParamLimits memory newLimits) public onlyOwner {
        _takerFeeLimits.store(newLimits);
        emit CoordinatorDelegatableParamLimitsUpdated(newLimits);
    }

    /**
     * @notice Updates the maker limit for product `product` to `newMakerLimit`
     * @dev Only callable by owner or paramAdmin
     * @param newMakerLimit The new maker limit
     */
    function updateMakerLimit(UFixed18 newMakerLimit) external onlyOwnerOrParamAdmin {
        if (!makerLimitLimits().valid(newMakerLimit))
            revert CoordinatorDelegatableInvalidUFixed18UpdateError(newMakerLimit);
        product.updateMakerLimit(newMakerLimit);
    }

    /**
     * @notice Updates the maker limit limit value
     * @param newLimits New maker limit limit value
     */
    function updateMakerLimitLimits(UFixed18ParamLimits memory newLimits) public onlyOwner {
        _makerLimitLimits.store(newLimits);
        emit CoordinatorDelegatableParamLimitsUpdated(newLimits);
    }

    /**
     * @notice Updates the utilization buffer for product `product` to `newUtilizationBuffer`
     * @dev Only callable by owner or paramAdmin
     * @param newUtilizationBuffer The new utilization buffer
     */
    function updateUtilizationBuffer(UFixed18 newUtilizationBuffer) external onlyOwnerOrParamAdmin {
        if (!utilizationBufferLimits().valid(newUtilizationBuffer))
            revert CoordinatorDelegatableInvalidUFixed18UpdateError(newUtilizationBuffer);
        product.updateUtilizationBuffer(newUtilizationBuffer);
    }

    /**
     * @notice Updates the utilization buffer limit value
     * @param newLimits New utilization buffer limit value
     */
    function updateUtilizationBufferLimits(UFixed18ParamLimits memory newLimits) public onlyOwner {
        _utilizationBufferLimits.store(newLimits);
        emit CoordinatorDelegatableParamLimitsUpdated(newLimits);
    }

    /**
     * @notice Updates the utilization curve for product `product` to `newUtilizationCurve`
     * @dev Only callable by owner or paramAdmin
     * @param newUtilizationCurve The new utilization curve
     */
    function updateUtilizationCurve(JumpRateUtilizationCurve memory newUtilizationCurve) external onlyOwnerOrParamAdmin {
        if (!utilizationCurveLimits().valid(newUtilizationCurve))
            revert CoordinatorDelegatableInvalidUtilizationCurveUpdateError(newUtilizationCurve);
        product.updateUtilizationCurve(newUtilizationCurve);
    }

    /**
     * @notice Updates the utilization curve limit value
     * @param newLimits New utilization curve limit value
     */
    function updateUtilizationCurveLimits(UtilizationCurveLimits memory newLimits) public onlyOwner {
        _utilizationCurveLimits.store(newLimits);
        emit CoordinatorDelegatableUtilizationCurveLimitsUpdated(newLimits);
    }

    /**
     * @notice Updates the param admin to `newParamAdmin`
     * @dev Only callable by the owner
     * @param newParamAdmin address of the new param admin
     */
    function updateParamAdmin(address newParamAdmin) public onlyOwner {
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
