// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/number/types/Fixed18.sol";
import "./types/Position.sol";
import "./IOracleProvider.sol";

interface IProductProvider is IOracleProvider {
    function oracle() external view returns (IOracleProvider);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function rate(Position memory position) external view returns (Fixed18);
    function maintenance() external view returns (UFixed18);
    function fundingFee() external view returns (UFixed18);
    function makerFee() external view returns (UFixed18);
    function takerFee() external view returns (UFixed18);
    function makerLimit() external view returns (UFixed18);
}
