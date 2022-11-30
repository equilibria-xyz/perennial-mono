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
     * @param utilizationCurve_ utulization curve definition
     */
    // solhint-disable-next-line func-name-mixedcase
    function __UParamProvider__initialize(
        Parameter memory parameter_,
        JumpRateUtilizationCurve memory utilizationCurve_
    ) internal onlyInitializer {
        _updateParameter(parameter_);
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
    function parameter() public view returns (Parameter memory) { return _parameter.read(); }

    /// @dev The JumpRateUtilizationCurve params
    JumpRateUtilizationCurveStorage private constant _utilizationCurve =
        JumpRateUtilizationCurveStorage.wrap(keccak256("equilibria.perennial.UParamProvider.jumpRateUtilizationCurve"));
    function utilizationCurve() public view returns (JumpRateUtilizationCurve memory) { return _utilizationCurve.read(); }

    function _updateParameter(Parameter memory newParameter) private {
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    function updateParameter(Parameter memory newParameter) external onlyProductOwner {
        _updateParameter(newParameter);
    }

    /**
     * @notice Updates the utilization curve to `newUtilizationCurve`
     * @param newUtilizationCurve new utilization curve value
     */
    function _updateUtilizationCurve(JumpRateUtilizationCurve memory newUtilizationCurve) private {
        _utilizationCurve.store(newUtilizationCurve);
        emit JumpRateUtilizationCurveUpdated(newUtilizationCurve);
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
