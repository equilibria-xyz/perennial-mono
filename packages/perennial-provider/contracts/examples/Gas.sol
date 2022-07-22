// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/perennial/contracts/interfaces/IContractPayoffProvider.sol";

contract Gas is IContractPayoffProvider {
    function payoff(Fixed18 price) external pure override returns (Fixed18) {
        return price;
    }
}
