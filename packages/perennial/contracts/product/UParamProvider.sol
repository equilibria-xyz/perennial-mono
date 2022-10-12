// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "../controller/UControllerProvider.sol";
import "../interfaces/IParamProvider.sol";
import "../interfaces/IProduct.sol";

abstract contract UParamProvider is IParamProvider, UControllerProvider {
    /**
     * @notice Initializes the contract state
     * @param maintenance_ product maintenance ratio
     * @param fundingFee_ product funding fee
     * @param makerFee_ product maker fee
     * @param takerFee_ product taker fee
     * @param makerLimit_ product maker limit
     * @param utilizationCurve_ utulization curve definition
     */
    // solhint-disable-next-line func-name-mixedcase
    function __UParamProvider__initialize(
        UFixed18 maintenance_,
        UFixed18 fundingFee_,
        UFixed18 makerFee_,
        UFixed18 takerFee_,
        UFixed18 makerLimit_,
        JumpRateUtilizationCurve memory utilizationCurve_
    ) internal onlyInitializer {
        _updateMaintenance(maintenance_);
        _updateFundingFee(fundingFee_);
        _updateMakerFee(makerFee_);
        _updateTakerFee(takerFee_);
        _updateMakerLimit(makerLimit_);
        _updateUtilizationCurve(utilizationCurve_);
    }

    /// @dev Only allow the Product's coordinator owner to call
    modifier onlyProductOwner {
        uint256 coordinatorId = controller().coordinatorFor(IProduct(address(this)));
        if (controller().owner(coordinatorId) != msg.sender) revert NotOwnerError(coordinatorId);

        _;
    }

    /// @dev The maintenance value
    UFixed18Storage private constant _maintenance = UFixed18Storage.wrap(keccak256("equilibria.perennial.UParamProvider.maintenance"));
    function maintenance() public view returns (UFixed18) { return _maintenance.read(); }

    /// @dev The funding fee value
    UFixed18Storage private constant _fundingFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.UParamProvider.fundingFee"));
    function fundingFee() public view returns (UFixed18) { return _fundingFee.read(); }

    /// @dev The maker fee value
    UFixed18Storage private constant _makerFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.UParamProvider.makerFee"));
    function makerFee() public view returns (UFixed18) { return _makerFee.read(); }

    /// @dev The taker fee value
    UFixed18Storage private constant _takerFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.UParamProvider.takerFee"));
    function takerFee() public view returns (UFixed18) { return _takerFee.read(); }

    /// @dev The taker fee value
    UFixed18Storage private constant _positionFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.UParamProvider.positionFee"));
    function positionFee() public view returns (UFixed18) { return _positionFee.read(); }

    /// @dev The maker limit value
    UFixed18Storage private constant _makerLimit = UFixed18Storage.wrap(keccak256("equilibria.perennial.UParamProvider.makerLimit"));
    function makerLimit() public view returns (UFixed18) { return _makerLimit.read(); }

    /// @dev The JumpRateUtilizationCurve params
    JumpRateUtilizationCurveStorage private constant _utilizationCurve =
        JumpRateUtilizationCurveStorage.wrap(keccak256("equilibria.perennial.UParamProvider.jumpRateUtilizationCurve"));
    function utilizationCurve() public view returns (JumpRateUtilizationCurve memory) { return _utilizationCurve.read(); }

    /**
     * @notice Updates the maintenance to `newMaintenance`
     * @param newMaintenance new maintenance value
     */
    function _updateMaintenance(UFixed18 newMaintenance) private {
        _maintenance.store(newMaintenance);
        emit MaintenanceUpdated(newMaintenance);
    }

    /**
     * @notice Updates the maintenance to `newMaintenance`
     * @dev only callable by product owner
     * @param newMaintenance new maintenance value
     */
    function updateMaintenance(UFixed18 newMaintenance) external onlyProductOwner {
        _updateMaintenance(newMaintenance);
    }

    /**
     * @notice Updates the funding fee to `newFundingFee`
     * @param newFundingFee new funding fee value
     */
    function _updateFundingFee(UFixed18 newFundingFee) private {
        if (newFundingFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidFundingFee();
        _fundingFee.store(newFundingFee);
        emit FundingFeeUpdated(newFundingFee);
    }

    /**
     * @notice Updates the funding fee to `newFundingFee`
     * @dev only callable by product owner
     * @param newFundingFee new funding fee value
     */
    function updateFundingFee(UFixed18 newFundingFee) external onlyProductOwner {
        _updateFundingFee(newFundingFee);
    }

    /**
     * @notice Updates the maker fee to `newMakerFee`
     * @param newMakerFee new maker fee value
     */
    function _updateMakerFee(UFixed18 newMakerFee) private {
        if (newMakerFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidMakerFee();
        _makerFee.store(newMakerFee);
        emit MakerFeeUpdated(newMakerFee);
    }

     /**
     * @notice Updates the maker fee to `newMakerFee`
     * @dev only callable by product owner
     * @param newMakerFee new maker fee value
     */
    function updateMakerFee(UFixed18 newMakerFee) external onlyProductOwner {
        _updateMakerFee(newMakerFee);
    }

    /**
     * @notice Updates the taker fee to `newTakerFee`
     * @param newTakerFee new taker fee value
     */
    function _updateTakerFee(UFixed18 newTakerFee) private {
        if (newTakerFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidTakerFee();
        _takerFee.store(newTakerFee);
        emit TakerFeeUpdated(newTakerFee);
    }

    /**
     * @notice Updates the taker fee to `newTakerFee`
     * @dev only callable by product owner
     * @param newTakerFee new taker fee value
     */
    function updateTakerFee(UFixed18 newTakerFee) external onlyProductOwner {
        _updateTakerFee(newTakerFee);
    }

    /**
     * @notice Updates the position fee to `newPositionFee`
     * @param newPositionFee new position fee value
     */
    function _updatePositionFee(UFixed18 newPositionFee) private {
        if (newPositionFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidPositionFee();
        _positionFee.store(newPositionFee);
        emit PositionFeeUpdated(newPositionFee);
    }

    /**
     * @notice Updates the position fee to `newPositionFee`
     * @dev only callable by product owner
     * @param newPositionFee new position fee value
     */
    function updatePositionFee(UFixed18 newPositionFee) external onlyProductOwner {
        _updatePositionFee(newPositionFee);
    }

    /**
     * @notice Updates the maker limit to `newMakerLimit`
     * @param newMakerLimit new maker limit value
     */
    function _updateMakerLimit(UFixed18 newMakerLimit) private {
        _makerLimit.store(newMakerLimit);
        emit MakerLimitUpdated(newMakerLimit);
    }

    /**
     * @notice Updates the maker limit to `newMakerLimit`
     * @dev only callable by product owner
     * @param newMakerLimit new maker limit value
     */
    function updateMakerLimit(UFixed18 newMakerLimit) external onlyProductOwner {
        _updateMakerLimit(newMakerLimit);
    }

    /**
     * @notice Updates the utilization curve to `newUtilizationCurve`
     * @param newUtilizationCurve new utilization curve value
     */
    function _updateUtilizationCurve(JumpRateUtilizationCurve memory newUtilizationCurve) private {
        _utilizationCurve.store(newUtilizationCurve);
        emit JumpRateUtilizationCurveUpdated(
            newUtilizationCurve.minRate.unpack(),
            newUtilizationCurve.maxRate.unpack(),
            newUtilizationCurve.targetRate.unpack(),
            newUtilizationCurve.targetUtilization.unpack()
        );
    }

    /**
     * @notice Updates the utilization curve to `newUtilizationCurve`
     * @dev only callable by product owner
     * @param newUtilizationCurve new utilization curve value
     */
    function updateUtilizationCurve(JumpRateUtilizationCurve calldata newUtilizationCurve) external onlyProductOwner {
        _updateUtilizationCurve(newUtilizationCurve);
    }
}
