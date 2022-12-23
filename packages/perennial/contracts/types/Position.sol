// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import "./Accumulator.sol";
import "./PrePosition.sol";

/// @dev Position type
struct Position {
    /// @dev Quantity of the maker position
    uint64 _maker; // 6 decimals
    /// @dev Quantity of the taker position
    uint64 _taker; // 6 decimals
}
using PositionLib for Position global;

/**
 * @title PositionLib
 * @notice Library that surfaces math and settlement computations for the Position type.
 * @dev Positions track the current quantity of the account's maker and taker positions respectively
 *      denominated as a unit of the product's payoff function.
 */
library PositionLib {
    function maker(Position memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._maker) * 1e12);
    }

    function taker(Position memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._taker) * 1e12);
    }

    /**
     * @notice Computes the next position after the pending-settlement position delta is included
     * @param self The current Position
     * @param pre The pending-settlement position delta
     * @return Next Position
     */
    function next(Position memory self, PrePosition memory pre) internal pure returns (Position memory) {
        return Position(
            uint64(UFixed18.unwrap(UFixed18Lib.from(Fixed18Lib.from(self.maker()).add(pre.maker()))) / 1e12),
            uint64(UFixed18.unwrap(UFixed18Lib.from(Fixed18Lib.from(self.taker()).add(pre.taker()))) / 1e12)
        );
    }

    /**
     * @notice Returns the utilization ratio for the current position
     * @param self The Position to operate on
     * @return utilization ratio
     */
    function utilization(Position memory self) internal pure returns (UFixed18) {
        return self.taker().unsafeDiv(self.maker());
    }

    /**
     * @notice Returns the socialization factor for the current position
     * @dev Socialization account for the case where `taker` > `maker` temporarily due to a liquidation
     *      on the maker side. This dampens the taker's exposure pro-rata to ensure that the maker side
     *      is never exposed over 1 x short.
     * @param self The Position to operate on
     * @return Socialization factor
     */
    function socializationFactor(Position memory self) internal pure returns (UFixed18) {
        return self.taker().isZero() ? UFixed18Lib.ONE : UFixed18Lib.min(UFixed18Lib.ONE, self.maker().div(self.taker()));
    }
}
