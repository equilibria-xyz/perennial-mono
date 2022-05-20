// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.13;

import "@equilibria/root/curve/unstructured/UJumpRateUtilizationCurveProvider.sol";
import "../oracle/UOracleProvider.sol";
import "../product/UProductProvider.sol";

contract ShortEther is UJumpRateUtilizationCurveProvider, UOracleProvider, UProductProvider {
    string public name = "Short Ether";
    string public symbol = "SETH";

    function initialize(
        IOracleProvider oracle_,
        UFixed18 maintenance_,
        UFixed18 fundingFee_,
        UFixed18 makerFee_,
        UFixed18 takerFee_,
        UFixed18 makerLimit_,
        JumpRateUtilizationCurve memory utilizationCurve_
    ) external initializer(1) {
        __UOwnable__initialize();
        __UProductProvider__initialize(maintenance_, fundingFee_, makerFee_, takerFee_, makerLimit_);
        __UOracleProvider__initialize(oracle_);
        __UJumpRateUtilizationCurveProvider__initialize(utilizationCurve_);
    }

    function _payoff(Fixed18 price) internal pure override returns (Fixed18) {
        return Fixed18Lib.from(-1).mul(price);
    }
}
