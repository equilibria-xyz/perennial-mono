// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "../product/types/Parameter.sol";
import "./types/Accumulator.sol";

interface IParamProvider {
    event ParameterUpdated(Parameter newParameter);
    
    function parameter() external view returns (Parameter memory);
    function updateParameter(Parameter memory newParameter) external;
}
