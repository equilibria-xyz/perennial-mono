// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial/contracts/interfaces/IContractPayoffProvider.sol";

contract Squeeth is IContractPayoffProvider {
    function payoff(Fixed18 price) external pure override returns (Fixed18) {
        return price.mul(price).div(Fixed18Lib.from(1000)); //TODO: create your payoff function over your oracle
    }
}
