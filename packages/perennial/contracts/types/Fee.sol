// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./ProtocolParameter.sol";

//TODO: add interface fee?

/// @dev Fee type
struct Fee {
    UFixed6 protocol;
    UFixed6 market;
}
using FeeLib for Fee global;
struct StoredFee {
    uint64 _protocol;
    uint64 _market;
}
struct FeeStorage { StoredFee value; }
using FeeStorageLib for FeeStorage global;

/**
 * @title FeeLib
 * @notice
 */
library FeeLib {
    function update(Fee memory self, UFixed6 amount, ProtocolParameter memory protocolParameter) internal pure {
        UFixed6 protocolAmount = amount.mul(protocolParameter.protocolFee);
        UFixed6 marketAmount = amount.sub(protocolAmount);
        self.protocol = self.protocol.add(protocolAmount);
        self.market = self.market.add(marketAmount);
    }
}

library FeeStorageLib {
    function read(FeeStorage storage self) internal view returns (Fee memory) {
        StoredFee memory storedValue =  self.value;
        return Fee(
            UFixed6.wrap(uint256(storedValue._protocol)),
            UFixed6.wrap(uint256(storedValue._market))
        );
    }

    function store(FeeStorage storage self, Fee memory newValue) internal {
        self.value = StoredFee(
            uint64(UFixed6.unwrap(newValue.protocol)),
            uint64(UFixed6.unwrap(newValue.market))
        );
    }
}
