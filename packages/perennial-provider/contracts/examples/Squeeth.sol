// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.14;

import "@equilibria/root/curve/unstructured/UJumpRateUtilizationCurveProvider.sol";
import "../oracle/XOracleProvider.sol";
import "../product/UProductProvider.sol";

contract Squeeth is UJumpRateUtilizationCurveProvider, XOracleProvider, UProductProvider {
    string public constant name = "milli-Squeeth";
    string public constant symbol = "mSQTH";

    // solhint-disable-next-line no-empty-blocks
    constructor(IOracleProvider oracle_) XOracleProvider(oracle_) { }

    function initialize(
        UFixed18 maintenance_,
        UFixed18 fundingFee_,
        UFixed18 makerFee_,
        UFixed18 takerFee_,
        UFixed18 makerLimit_,
        JumpRateUtilizationCurve memory utilizationCurve_
    ) external initializer(1) {
        __UOwnable__initialize();
        __UProductProvider__initialize(maintenance_, fundingFee_, makerFee_, takerFee_, makerLimit_);
        __UJumpRateUtilizationCurveProvider__initialize(utilizationCurve_);
    }

    function _payoff(Fixed18 price) internal pure override returns (Fixed18) {
        return price.mul(price).div(Fixed18Lib.from(1000));
    }
}
