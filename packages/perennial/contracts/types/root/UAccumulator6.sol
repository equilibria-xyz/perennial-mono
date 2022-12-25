// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Fixed6.sol";

/// @dev UAccumulator6 type
struct UAccumulator6 {
    UFixed6 _value;
}
using UAccumulator6Lib for UAccumulator6 global;

/**
 * @title UAccumulator6Lib
 * @notice
 * @dev
 */
library UAccumulator6Lib {
    function accumulated(UAccumulator6 memory self, UAccumulator6 memory from) internal pure returns (UFixed6) {
        return self._value.sub(from._value);
    }

    function increment(UAccumulator6 memory self, UFixed6 amount, UFixed6 total) internal pure {
        self._value = self._value.add(amount.div(total));
    }
}
