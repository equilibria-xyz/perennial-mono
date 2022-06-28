// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../IProductProvider.sol";

/// @dev Product Creation parameters
struct ProductInitParams {
    /// @dev name of the product
    string name;

    /// @dev symbol of the product
    string symbol;

    /// @dev product provider address
    IProductProvider productProvider;
}
