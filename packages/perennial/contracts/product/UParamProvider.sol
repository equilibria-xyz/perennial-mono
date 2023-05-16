// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "../controller/UControllerProvider.sol";
import "../interfaces/IParamProvider.sol";
import "../interfaces/IProduct.sol";
import "../interfaces/types/PendingFeeUpdates.sol";

/**
 * @title UParamProvider
 * @notice Library for manage storing, surfacing, and upgrading a product's parameters.
 * @dev Uses an unstructured storage pattern to store the parameters which allows this
        provider to be safely used with upgradeable contracts. For certain paramters, a
        staged update pattern is used.
 */
abstract contract UParamProvider is IParamProvider, UControllerProvider {
    /**
     * @notice Initializes the contract state
     * @param maintenance_ product maintenance ratio
     * @param fundingFee_ product funding fee
     * @param makerFee_ product maker fee
     * @param takerFee_ product taker fee
     * @param makerLimit_ product maker limit
     * @param utilizationCurve_ utilization curve definition
     */
    // solhint-disable-next-line func-name-mixedcase
    function __UParamProvider__initialize(
        UFixed18 maintenance_,
        UFixed18 fundingFee_,
        UFixed18 makerFee_,
        UFixed18 takerFee_,
        UFixed18 positionFee_,
        UFixed18 makerLimit_,
        JumpRateUtilizationCurve memory utilizationCurve_
    ) internal onlyInitializer {
        _updateMaintenance(maintenance_);
        _updateFundingFee(fundingFee_);
        _updateMakerFee(makerFee_);
        _updateTakerFee(takerFee_);
        _updatePositionFee(positionFee_);
        _updateMakerLimit(makerLimit_);
        _updateUtilizationCurve(utilizationCurve_);
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

    /// @dev The positon fee share value
    UFixed18Storage private constant _positionFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.UParamProvider.positionFee"));
    function positionFee() public view returns (UFixed18) { return _positionFee.read(); }

    /// @dev The maker limit value
    UFixed18Storage private constant _makerLimit = UFixed18Storage.wrap(keccak256("equilibria.perennial.UParamProvider.makerLimit"));
    function makerLimit() public view returns (UFixed18) { return _makerLimit.read(); }

    /// @dev The utilization buffer value
    UFixed18Storage private constant _utilizationBuffer = UFixed18Storage.wrap(keccak256("equilibria.perennial.UParamProvider.utilizationBuffer"));
    function utilizationBuffer() public view returns (UFixed18) { return _utilizationBuffer.read(); }

    /// @dev The JumpRateUtilizationCurve params
    JumpRateUtilizationCurveStorage private constant _utilizationCurve =
        JumpRateUtilizationCurveStorage.wrap(keccak256("equilibria.perennial.UParamProvider.jumpRateUtilizationCurve"));
    function utilizationCurve() public view returns (JumpRateUtilizationCurve memory) { return _utilizationCurve.read(); }

    /// @dev The pending fee updates value
    PendingFeeUpdatesStorage private constant _pendingFeeUpdates =
        PendingFeeUpdatesStorage.wrap(keccak256("equilibria.perennial.UParamProvider.pendingFeeUpdates"));
    function pendingFeeUpdates() public view returns (PendingFeeUpdates memory) { return _pendingFeeUpdates.read(); }

    /**
     * @notice Updates the maintenance to `newMaintenance`
     * @param newMaintenance new maintenance value
     */
    function _updateMaintenance(UFixed18 newMaintenance) private {
        _maintenance.store(newMaintenance);
        emit MaintenanceUpdated(newMaintenance, _productVersion());
    }

    /**
     * @notice Updates the maintenance to `newMaintenance`
     * @dev only callable by product owner
     * @param newMaintenance new maintenance value
     */
    function updateMaintenance(UFixed18 newMaintenance) external onlyProductOwner settleProduct {
        _updateMaintenance(newMaintenance);
    }

    /**
     * @notice Updates the funding fee to `newFundingFee`
     * @param newFundingFee new funding fee value
     */
    function _updateFundingFee(UFixed18 newFundingFee) private {
        if (newFundingFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidParamValue();
        _fundingFee.store(newFundingFee);
        emit FundingFeeUpdated(newFundingFee, _productVersion());
    }

    /**
     * @notice Updates the funding fee to `newFundingFee`
     * @dev only callable by product owner
     * @param newFundingFee new funding fee value
     */
    function updateFundingFee(UFixed18 newFundingFee) external onlyProductOwner settleProduct {
        _updateFundingFee(newFundingFee);
    }

    /**
     * @notice Updates the maker fee to `newMakerFee`
     * @param newMakerFee new maker fee value
     */
    function _updateMakerFee(UFixed18 newMakerFee) private {
        if (newMakerFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidParamValue();
        _makerFee.store(newMakerFee);
        emit MakerFeeUpdated(newMakerFee, _productVersion());
    }

    /**
     * @notice Updates the pending maker fee to `newMakerFee`
     * @param newMakerFee new maker fee value
     */
    function _updatePendingMakerFee(UFixed18 newMakerFee) private {
        if (newMakerFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidParamValue();
        PendingFeeUpdates memory pendingFees_ = pendingFeeUpdates();
        pendingFees_.updateMakerFee(newMakerFee);
        _pendingFeeUpdates.store(pendingFees_);
        emit PendingMakerFeeUpdated(newMakerFee);
    }

    /**
     * @notice Updates the maker fee to `newMakerFee`
     * @dev only callable by product owner
     * @param newMakerFee new maker fee value
     */
    function updateMakerFee(UFixed18 newMakerFee) external onlyProductOwner settleProduct {
        if (!_noPendingPositions()) {
            _updatePendingMakerFee(newMakerFee);
        } else {
            _updateMakerFee(newMakerFee);
        }
    }

    /**
     * @notice Updates the taker fee to `newTakerFee`
     * @param newTakerFee new taker fee value
     */
    function _updateTakerFee(UFixed18 newTakerFee) private {
        if (newTakerFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidParamValue();
        _takerFee.store(newTakerFee);
        emit TakerFeeUpdated(newTakerFee, _productVersion());
    }

    /**
     * @notice Updates the pending taker fee to `newTakerFee`
     * @param newTakerFee new taker fee value
     */
    function _updatePendingTakerFee(UFixed18 newTakerFee) private {
        if (newTakerFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidParamValue();
        PendingFeeUpdates memory pendingFees_ = pendingFeeUpdates();
        pendingFees_.updateTakerFee(newTakerFee);
        _pendingFeeUpdates.store(pendingFees_);
        emit PendingTakerFeeUpdated(newTakerFee);
    }

    /**
     * @notice Updates the taker fee to `newTakerFee`
     * @dev only callable by product owner
     * @param newTakerFee new taker fee value
     */
    function updateTakerFee(UFixed18 newTakerFee) external onlyProductOwner settleProduct {
        if (!_noPendingPositions()) {
            _updatePendingTakerFee(newTakerFee);
        } else {
            _updateTakerFee(newTakerFee);
        }
    }

    /**
     * @notice Updates the position fee to `newPositionFee`
     * @param newPositionFee new position fee value
     */
    function _updatePositionFee(UFixed18 newPositionFee) private {
        if (newPositionFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidParamValue();
        _positionFee.store(newPositionFee);
        emit PositionFeeUpdated(newPositionFee, _productVersion());
    }

    /**
     * @notice Updates the pending position fee to `newPositionFee`
     * @param newPositionFee new position fee value
     */
    function _updatePendingPositionFee(UFixed18 newPositionFee) private {
        if (newPositionFee.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidParamValue();
        PendingFeeUpdates memory pendingFees_ = pendingFeeUpdates();
        pendingFees_.updatePositionFee(newPositionFee);
        _pendingFeeUpdates.store(pendingFees_);
        emit PendingPositionFeeUpdated(newPositionFee);
    }

    /**
     * @notice Updates the position fee to `newPositionFee`
     * @dev only callable by product owner
     * @param newPositionFee new position fee value
     */
    function updatePositionFee(UFixed18 newPositionFee) external onlyProductOwner settleProduct {
        if (!_noPendingPositions()) {
            _updatePendingPositionFee(newPositionFee);
        } else {
            _updatePositionFee(newPositionFee);
        }
    }

    /**
     * @notice Updates the maker limit to `newMakerLimit`
     * @param newMakerLimit new maker limit value
     */
    function _updateMakerLimit(UFixed18 newMakerLimit) private {
        _makerLimit.store(newMakerLimit);
        emit MakerLimitUpdated(newMakerLimit, _productVersion());
    }

    /**
     * @notice Updates the maker limit to `newMakerLimit`
     * @dev only callable by product owner
     * @param newMakerLimit new maker limit value
     */
    function updateMakerLimit(UFixed18 newMakerLimit) external onlyProductOwner settleProduct {
        _updateMakerLimit(newMakerLimit);
    }

    /**
     * @notice Updates the utilization buffer to `newUtilizationBuffer`
     * @dev only callable by product owner
     * @param newUtilizationBuffer new utilization buffer value
     */
    function updateUtilizationBuffer(UFixed18 newUtilizationBuffer) external onlyProductOwner settleProduct {
        if (newUtilizationBuffer.gt(UFixed18Lib.ONE)) revert ParamProviderInvalidParamValue();
        _utilizationBuffer.store(newUtilizationBuffer);
        emit UtilizationBufferUpdated(newUtilizationBuffer, _productVersion());
    }

    /**
     * @notice Updates the utilization curve to `newUtilizationCurve`
     * @param newUtilizationCurve new utilization curve value
     */
    function _updateUtilizationCurve(JumpRateUtilizationCurve memory newUtilizationCurve) private {
        _utilizationCurve.store(newUtilizationCurve);
        emit JumpRateUtilizationCurveUpdated(newUtilizationCurve, _productVersion());
    }

    /**
     * @notice Updates the utilization curve to `newUtilizationCurve`
     * @dev only callable by product owner
     * @param newUtilizationCurve new utilization curve value
     */
    function updateUtilizationCurve(JumpRateUtilizationCurve calldata newUtilizationCurve) external onlyProductOwner settleProduct {
        _updateUtilizationCurve(newUtilizationCurve);
    }

    function _settleFeeUpdates() internal {
        PendingFeeUpdates memory pendingFeeUpdates_ = pendingFeeUpdates();
        if (!pendingFeeUpdates_.hasUpdates()) return;
        if (pendingFeeUpdates_.makerFeeUpdated) _updateMakerFee(pendingFeeUpdates_.makerFee());
        if (pendingFeeUpdates_.takerFeeUpdated) _updateTakerFee(pendingFeeUpdates_.takerFee());
        if (pendingFeeUpdates_.positionFeeUpdated) _updatePositionFee(pendingFeeUpdates_.positionFee());

        pendingFeeUpdates_.clear();
        _pendingFeeUpdates.store(pendingFeeUpdates_);
    }

    function _productVersion() private view returns (uint256) {
        // If this product is being constructed then return 0
        if (!Address.isContract(address(this))) return 0;
        return IProduct(address(this)).latestVersion();
    }

    /**
     * @notice Checks whether the Product's `pre` position is empty
     * @return Whether or not the pre position is empty
     */
    function _noPendingPositions() private view returns (bool) {
        return IProduct(address(this)).pre().isEmpty();
    }

    /// @dev Only allow the Product's coordinator owner to call
    modifier onlyProductOwner {
        uint256 coordinatorId = controller().coordinatorFor(IProduct(address(this)));
        if (controller().owner(coordinatorId) != msg.sender) revert NotOwnerError(coordinatorId);

        _;
    }

    /// @dev Settles the product
    modifier settleProduct {
        IProduct(address(this)).settle();

        _;
    }
}
