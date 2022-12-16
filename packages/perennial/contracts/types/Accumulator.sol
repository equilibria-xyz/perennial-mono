// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed18.sol";

/// @dev Accumulator type
struct Accumulator {
    /// @dev maker accumulator per share
    PackedFixed18 _maker;
    /// @dev taker accumulator per share
    PackedFixed18 _taker;
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

    function maker(Accumulator memory self) internal pure returns (Fixed18) {
        return self._maker.unpack();
    }

    function taker(Accumulator memory self) internal pure returns (Fixed18) {
        return self._taker.unpack();
    }

    function incrementMaker(Accumulator memory self, Fixed18 amount, UFixed18 total) internal pure {
        self._maker = self._maker.unpack().add(amount.div(Fixed18Lib.from(total))).pack();
    }

    function decrementMaker(Accumulator memory self, Fixed18 amount, UFixed18 total) internal pure {
        self._maker = self._maker.unpack().add(amount.div(Fixed18Lib.from(total)).mul(Fixed18Lib.NEG_ONE)).pack();
    }

    function incrementTaker(Accumulator memory self, Fixed18 amount, UFixed18 total) internal pure {
        self._taker = self._taker.unpack().add(amount.div(Fixed18Lib.from(total))).pack();
    }

    function decrementTaker(Accumulator memory self, Fixed18 amount, UFixed18 total) internal pure {
        self._taker = self._taker.unpack().add(amount.div(Fixed18Lib.from(total)).mul(Fixed18Lib.NEG_ONE)).pack();
    }

    /**
     * @notice Adds two accumulators together
     * @param a The first accumulator to sum
     * @param b The second accumulator to sum
     * @return The resulting summed accumulator
     */
    function add(Accumulator memory a, Accumulator memory b) internal pure returns (Accumulator memory) {
        return Accumulator(
            PackedFixed18.wrap(PackedFixed18.unwrap(a._maker) + PackedFixed18.unwrap(b._maker)),
            PackedFixed18.wrap(PackedFixed18.unwrap(a._taker) + PackedFixed18.unwrap(b._taker))
        );
    }

    /**
     * @notice Subtracts accumulator `b` from `a`
     * @param a The accumulator to subtract from
     * @param b The accumulator to subtract
     * @return The resulting subtracted accumulator
     */
    function sub(Accumulator memory a, Accumulator memory b) internal pure returns (Accumulator memory) {
        return Accumulator(
            PackedFixed18.wrap(PackedFixed18.unwrap(a._maker) - PackedFixed18.unwrap(b._maker)),
            PackedFixed18.wrap(PackedFixed18.unwrap(a._taker) - PackedFixed18.unwrap(b._taker))
        );
    }

    /**
     * @notice Multiplies two accumulators together
     * @param a The first accumulator to multiply
     * @param b The second accumulator to multiply
     * @return The resulting multiplied accumulator
     */
    function mul(Accumulator memory a, Accumulator memory b) internal pure returns (Accumulator memory) {
        return Accumulator(a.maker().mul(b.maker()).pack(), a.taker().mul(b.taker()).pack());
    }

    /**
     * @notice Sums the maker and taker together from a single accumulator
     * @param self The struct to operate on
     * @return The sum of its maker and taker
     */
    function sum(Accumulator memory self) internal pure returns (Fixed18) {
        return self.maker().add(self.taker());
    }
}
