// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "../interfaces/IParamProvider.sol";

abstract contract UParamProvider is IParamProvider, UInitializable {
    /// @dev The maintenance value
    UFixed18Storage internal constant _maintenance = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.maintenance"));
    function maintenance() public view returns (UFixed18) { return _maintenance.read(); }

    /// @dev The funding fee value
    UFixed18Storage internal constant _fundingFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.fundingFee"));
    function fundingFee() public view returns (UFixed18) { return _fundingFee.read(); }

    /// @dev The maker fee value
    UFixed18Storage internal constant _makerFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.makerFee"));
    function makerFee() public view returns (UFixed18) { return _makerFee.read(); }

    /// @dev The taker fee value
    UFixed18Storage internal constant _takerFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.takerFee"));
    function takerFee() public view returns (UFixed18) { return _takerFee.read(); }

    /// @dev The maker limit value
    UFixed18Storage internal constant _makerLimit = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.makerLimit"));
    function makerLimit() public view returns (UFixed18) { return _makerLimit.read(); }

    /// @dev The JumpRateUtilizationCurve params
    JumpRateUtilizationCurveStorage internal constant _utilizationCurve =
        JumpRateUtilizationCurveStorage.wrap(keccak256("equilibria.perennial.Product.jumpRateUtilizationCurve"));
    function utilizationCurve() public view returns (JumpRateUtilizationCurve memory) { return _utilizationCurve.read(); }
}
