// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed18.sol";

/// @dev Accumulator type
struct Accumulator {
    /// @dev maker accumulator per share
    Fixed18 maker;
    /// @dev taker accumulator per share
    Fixed18 taker;
}
using AccumulatorLib for Accumulator global;

/**
 * @title AccountAccumulatorLib
 * @notice Library that surfaces math operations for the Accumulator type.
 * @dev Accumulators track the cumulative change in position value over time for the maker and taker positions
 *      respectively. Account-level accumulators can then use two of these values `a` and `a'` to compute the
 *      change in position value since last sync. This change in value is then used to compute P&L and fees.
 */
library AccumulatorLib {
    function incrementMaker(Accumulator memory self, Fixed18 amount, UFixed18 total) internal pure {
        self.maker = self.maker.add(amount.div(Fixed18Lib.from(total)));
    }

    function decrementMaker(Accumulator memory self, Fixed18 amount, UFixed18 total) internal pure {
        self.maker = self.maker.add(amount.div(Fixed18Lib.from(total)).mul(Fixed18Lib.NEG_ONE));
    }

    function incrementTaker(Accumulator memory self, Fixed18 amount, UFixed18 total) internal pure {
        self.taker = self.taker.add(amount.div(Fixed18Lib.from(total)));
    }

    function decrementTaker(Accumulator memory self, Fixed18 amount, UFixed18 total) internal pure {
        self.taker = self.taker.add(amount.div(Fixed18Lib.from(total)).mul(Fixed18Lib.NEG_ONE));
    }
}
