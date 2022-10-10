// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "@equilibria/root/number/types/UFixed18.sol";

/// @dev AccumulatorParams type
struct AccumulatorParams {
    JumpRateUtilizationCurve utilizationCurve;
    UFixed18 funding;
    UFixed18 maker;
    UFixed18 taker;
    bool closed;
}
using AccumulatorParamsLib for AccumulatorParams global;

/**
 * @title AccumulatorParamsLib
 * @notice
 */
library AccumulatorParamsLib {

}
