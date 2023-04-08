//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial/contracts/interfaces/IProduct.sol";

struct MarketDefinition {
    IProduct long;
    IProduct short;
    uint256 weight;
}
