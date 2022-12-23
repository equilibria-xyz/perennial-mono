// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./ProtocolParameter.sol";

//TODO: add interface fee?

/// @dev Fee type
struct Fee {
    uint128 _protocol; // 18 decimals

    uint128 _market; // 18 decimals
}
using FeeLib for Fee global;

/**
 * @title FeeLib
 * @notice
 */
library FeeLib {
    function update(Fee memory self, UFixed18 amount, ProtocolParameter memory protocolParameter) internal pure {
        UFixed18 protocolAmount = amount.mul(protocolParameter.protocolFee);
        UFixed18 marketAmount = amount.sub(protocolAmount);
        self._protocol = uint128(UFixed18.unwrap(protocol(self).add(protocolAmount)));
        self._market = uint128(UFixed18.unwrap(market(self).add(marketAmount)));
    }

    function protocol(Fee memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._protocol));
    }

    function market(Fee memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._market));
    }
}
