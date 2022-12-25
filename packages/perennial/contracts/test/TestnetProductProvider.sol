// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../interfaces/IPayoffProvider.sol";

contract TestnetContractPayoffProvider is IPayoffProvider {
    function payoff(Fixed6 price) public pure returns (Fixed6) {
        return price.mul(price);
    }
}
