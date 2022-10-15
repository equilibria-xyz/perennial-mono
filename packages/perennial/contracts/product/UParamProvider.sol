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
        _updateParameter(maintenance_, fundingFee_, makerFee_, takerFee_, positionFee_, false);
        _updateMakerLimit(makerLimit_);
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
    function parameter() public view returns (UFixed18 maintenance, UFixed18 fundingFee, UFixed18 makerFee, UFixed18 takerFee, UFixed18 positionFee, bool closed) {
        (maintenance, fundingFee, makerFee, takerFee, positionFee, closed) = _parameter.read();
        fundingFee = UFixed18Lib.max(fundingFee, controller().minFundingFee());
    }

    /// @dev The maker limit value
    UFixed18Storage private constant _makerLimit = UFixed18Storage.wrap(keccak256("equilibria.perennial.UParamProvider.makerLimit"));
    function makerLimit() public view returns (UFixed18) { return _makerLimit.read(); }

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
        bool newClosed
    ) private {
        _parameter.store(newMaintenance, newFundingFee, newMakerFee, newTakerFee, newPositionFee, newClosed);

        emit MaintenanceUpdated(newFundingFee);
        emit FundingFeeUpdated(newFundingFee);
        emit MakerFeeUpdated(newMakerFee);
        emit TakerFeeUpdated(newTakerFee);
        emit PositionFeeUpdated(newPositionFee);
        emit ClosedUpdated(newClosed);
    }

    function updateParameter(
        UFixed18 newMaintenance,
        UFixed18 newFundingFee,
        UFixed18 newMakerFee,
        UFixed18 newTakerFee,
        UFixed18 newPositionFee,
        bool newClosed
    ) external onlyProductOwner {
        _updateParameter(newMaintenance, newFundingFee, newMakerFee, newTakerFee, newPositionFee, newClosed);
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
