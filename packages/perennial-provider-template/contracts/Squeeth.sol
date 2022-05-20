// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.13;

import "@equilibria/root/curve/unstructured/UJumpRateUtilizationCurveProvider.sol";
import "@equilibria/perennial-provider/contracts/oracle/XOracleProvider.sol";
import "@equilibria/perennial-provider/contracts/product/UProductProvider.sol";

//TODO: choose your utilization model
//TODO: choose your data-access pattern for your utilization model, oracle, and product params
contract Squeeth is UJumpRateUtilizationCurveProvider, XOracleProvider, UProductProvider {
    string public name = "Squeeth"; //TODO: choose your provider's name
    string public symbol = "SQTH";  //TODO: choose your provider's symbol

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
        return price.mul(price); //TODO: create your payoff function over your oracle
    }
}
