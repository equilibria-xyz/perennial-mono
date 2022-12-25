// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./CurveMath6.sol";
import "./Fixed6.sol";

/// @dev JumpRateUtilizationCurve6 type
struct JumpRateUtilizationCurve6 {
    Fixed6 minRate;
    Fixed6 maxRate;
    Fixed6 targetRate;
    UFixed6 targetUtilization;
}
using JumpRateUtilizationCurve6Lib for JumpRateUtilizationCurve6 global;

/**
 * @title JumpRateUtilizationCurveLib
 * @notice Library for the Jump Rate utilization curve type
 */
library JumpRateUtilizationCurve6Lib {
    /**
     * @notice Computes the corresponding rate for a utilization ratio
     * @param utilization The utilization ratio
     * @return The corresponding rate
     */
    function compute(JumpRateUtilizationCurve6 memory self, UFixed6 utilization) internal pure returns (Fixed6) {
        UFixed6 targetUtilization = self.targetUtilization;
        if (utilization.lt(targetUtilization)) {
            return CurveMath6.linearInterpolation(
                UFixed6Lib.ZERO,
                self.minRate,
                targetUtilization,
                self.targetRate,
                utilization
            );
        }
        if (utilization.lt(UFixed6Lib.ONE)) {
            return CurveMath6.linearInterpolation(
                targetUtilization,
                self.targetRate,
                UFixed6Lib.ONE,
                self.maxRate,
                utilization
            );
        }
        return self.maxRate;
    }
}
