// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/number/types/Fixed18.sol";
import "./types/Position.sol";
import "./IOracleProvider.sol";

interface IProductProvider is IOracleProvider {
    function oracle() external view returns (IOracleProvider);
}
