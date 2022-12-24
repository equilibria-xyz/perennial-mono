// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./ProtocolParameter.sol";

//TODO: add interface fee?

/// @dev Fee type
struct Fee {
    uint64 _protocol; // 6 decimals

    uint64 _market; // 6 decimals
}
using FeeLib for Fee global;

/**
 * @title FeeLib
 * @notice
 */
library FeeLib {
    function update(Fee memory self, UFixed6 amount, ProtocolParameter memory protocolParameter) internal pure {
        UFixed6 protocolAmount = amount.mul(protocolParameter.protocolFee);
        UFixed6 marketAmount = amount.sub(protocolAmount);
        self._protocol = uint64(UFixed6.unwrap(protocol(self).add(protocolAmount)));
        self._market = uint64(UFixed6.unwrap(market(self).add(marketAmount)));
    }

    function protocol(Fee memory self) internal pure returns (UFixed6) {
        return UFixed6.wrap(uint256(self._protocol));
    }

    function market(Fee memory self) internal pure returns (UFixed6) {
        return UFixed6.wrap(uint256(self._market));
    }
}
