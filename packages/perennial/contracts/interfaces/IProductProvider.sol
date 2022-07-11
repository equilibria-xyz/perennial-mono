// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed18.sol";

interface IProductProvider {
    function payoff(Fixed18 price) external view returns (Fixed18 payoff);
}
