// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "../interfaces/IPayoffProvider.sol";

contract TestnetContractPayoffProvider is IPayoffProvider {
    function payoff(Fixed18 price) public pure returns (Fixed18) {
        return price.mul(price);
    }
}
