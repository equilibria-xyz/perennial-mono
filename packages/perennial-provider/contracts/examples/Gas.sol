// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.13;

import "@equilibria/root/curve/immutable/XJumpRateUtilizationCurveProvider.sol";
import "../oracle/XOracleProvider.sol";
import "../product/XProductProvider.sol";

contract Gas is XJumpRateUtilizationCurveProvider, XOracleProvider, XProductProvider {
    string public name = "Gas Price Index";
    string public symbol = "GAS";

    // solhint-disable-next-line no-empty-blocks
    constructor(
        IOracleProvider oracle_,
        UFixed18 maintenance_,
        UFixed18 fundingFee_,
        UFixed18 makerFee_,
        UFixed18 takerFee_,
        UFixed18 makerLimit_,
        JumpRateUtilizationCurve memory utilizationCurve_
    )
    XProductProvider(maintenance_, fundingFee_, makerFee_, takerFee_, makerLimit_)
    XOracleProvider(oracle_)
    XJumpRateUtilizationCurveProvider(utilizationCurve_)
    { }
}
