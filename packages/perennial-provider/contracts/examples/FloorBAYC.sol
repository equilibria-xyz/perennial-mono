// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.14;

import "@equilibria/root/curve/immutable/XJumpRateUtilizationCurveProvider.sol";
import "../oracle/XOracleProvider.sol";
import "../product/XProductProvider.sol";

contract FloorBAYC is XJumpRateUtilizationCurveProvider, XOracleProvider, XProductProvider {
    string public constant name = "Floor BAYC";
    string public constant symbol = "fBAYC";

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
    { } // solhint-disable-line no-empty-blocks
}
