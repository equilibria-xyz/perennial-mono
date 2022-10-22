// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "../controller/UControllerProvider.sol";
import "../interfaces/IParamProvider.sol";
import "../interfaces/IProduct.sol";
import "./types/Parameter.sol";

//TODO: add version to versioned params
abstract contract UParamProvider is IParamProvider, UControllerProvider {
    /**
     * @notice Initializes the contract state
     * @param maintenance_ product maintenance ratio
     * @param fundingFee_ product funding fee
     * @param makerFee_ product maker fee
     * @param takerFee_ product taker fee
     * @param positionFee_ product position fee
     * @param makerLimit_ product maker limit
     * @param utilizationCurve_ utulization curve definition
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
        _updateParameter(maintenance_, fundingFee_, makerFee_, takerFee_, positionFee_, makerLimit_, false);
        _updateUtilizationCurve(utilizationCurve_);
    }

    /// @dev Only allow the Product's coordinator owner to call
    modifier onlyProductOwner {
        uint256 coordinatorId = controller().coordinatorFor(IProduct(address(this)));
        if (controller().owner(coordinatorId) != msg.sender) revert NotOwnerError(coordinatorId);

        _;
    }

    /// @dev The parameter values
    ParameterStorage private constant _parameter = ParameterStorage.wrap(keccak256("equilibria.perennial.UParamProvider.parameter"));
    function parameter() public view returns (UFixed18 maintenance, UFixed18 fundingFee, UFixed18 makerFee, UFixed18 takerFee, UFixed18 positionFee, UFixed18 makerLimit, bool closed) {
        (maintenance, fundingFee, makerFee, takerFee, positionFee, makerLimit, closed) = _parameter.read();
    }

    /// @dev The JumpRateUtilizationCurve params
    JumpRateUtilizationCurveStorage private constant _utilizationCurve =
        JumpRateUtilizationCurveStorage.wrap(keccak256("equilibria.perennial.UParamProvider.jumpRateUtilizationCurve"));
    function utilizationCurve() public view returns (JumpRateUtilizationCurve memory) { return _utilizationCurve.read(); }

    function _updateParameter(
        UFixed18 newMaintenance,
        UFixed18 newFundingFee,
        UFixed18 newMakerFee,
        UFixed18 newTakerFee,
        UFixed18 newPositionFee,
        UFixed18 newMakerLimit,
        bool newClosed
    ) private {
        _parameter.store(newMaintenance, newFundingFee, newMakerFee, newTakerFee, newPositionFee, newMakerLimit, newClosed);

        emit MaintenanceUpdated(newFundingFee);
        emit FundingFeeUpdated(newFundingFee);
        emit MakerFeeUpdated(newMakerFee);
        emit TakerFeeUpdated(newTakerFee);
        emit PositionFeeUpdated(newPositionFee);
        emit MakerLimitUpdated(newMakerLimit);
        emit ClosedUpdated(newClosed);
    }

    function updateParameter(
        UFixed18 newMaintenance,
        UFixed18 newFundingFee,
        UFixed18 newMakerFee,
        UFixed18 newTakerFee,
        UFixed18 newPositionFee,
        UFixed18 newMakerLimit,
        bool newClosed
    ) external onlyProductOwner {
        _updateParameter(newMaintenance, newFundingFee, newMakerFee, newTakerFee, newPositionFee, newMakerLimit, newClosed);
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
