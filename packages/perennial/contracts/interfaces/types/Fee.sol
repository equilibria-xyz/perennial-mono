// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../IProduct.sol";
import "./PrePosition.sol";
import "./Version.sol";

//TODO: add interface fee?

/// @dev Fee type
struct Fee {
    uint128 _protocol; // 18 decimals

    uint128 _product; // 18 decimals
}
using FeeLib for Fee global;

/**
 * @title FeeLib
 * @notice
 */
library FeeLib {
    function update(Fee memory self, UFixed18 amount, UFixed18 protocolFee) internal pure {
        UFixed18 protocolAmount = amount.mul(protocolFee);
        UFixed18 productAmount = amount.sub(protocolAmount);
        self._protocol = uint128(UFixed18.unwrap(protocol(self).add(protocolAmount)));
        self._product = uint128(UFixed18.unwrap(product(self).add(productAmount)));
    }

    function protocol(Fee memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._protocol));
    }

    function product(Fee memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._product));
    }
}
