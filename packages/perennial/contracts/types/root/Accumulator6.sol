// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Fixed6.sol";

/// @dev Accumulator6 type
struct Accumulator6 {
    Fixed6 _value;
}
using Accumulator6Lib for Accumulator6 global;

/**
 * @title Accumulator6Lib
 * @notice
 * @dev
 */
library Accumulator6Lib {
    function accumulated(Accumulator6 memory self, Accumulator6 memory from) internal pure returns (Fixed6) {
        return self._value.sub(from._value);
    }

    function increment(Accumulator6 memory self, Fixed6 amount, UFixed6 total) internal pure {
        self._value = self._value.add(amount.div(Fixed6Lib.from(total)));
    }

    function decrement(Accumulator6 memory self, Fixed6 amount, UFixed6 total) internal pure {
        self._value = self._value.add(amount.div(Fixed6Lib.from(total)).mul(Fixed6Lib.NEG_ONE));
    }
}
