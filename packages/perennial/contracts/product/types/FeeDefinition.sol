// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/number/types/UFixed18.sol";

/// @dev FeeDefinition type
struct FeeDefinition {
    UFixed18 funding;
    UFixed18 maker;
    UFixed18 taker;
}
using FeeDefinitionLib for FeeDefinition global;

/**
 * @title FeeDefinitionLib
 * @notice
 */
library FeeDefinitionLib {

}
