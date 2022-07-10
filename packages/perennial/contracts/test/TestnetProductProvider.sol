// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "../interfaces/IProductProvider.sol";

contract TestnetProductProvider is IProductProvider {
    function payoff(Fixed18 price) public pure returns (Fixed18) {
        return price.mul(price);
    }
}
