// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./root/UFixed6.sol";
import "./Accumulator.sol";

/// @dev Position type
struct Position {
    /// @dev Quantity of the maker position
    uint64 _maker; // 6 decimals
    /// @dev Quantity of the taker position
    uint64 _taker; // 6 decimals

    /// @dev Quantity of the maker position
    uint64 _makerNext; // 6 decimals
    /// @dev Quantity of the taker position
    uint64 _takerNext; // 6 decimals
}
using PositionLib for Position global;

/**
 * @title PositionLib
 * @notice Library that surfaces math and settlement computations for the Position type.
 * @dev Positions track the current quantity of the account's maker and taker positions respectively
 *      denominated as a unit of the product's payoff function.
 */
library PositionLib {
    function maker(Position memory self) internal pure returns (UFixed6) {
        return UFixed6.wrap(uint256(self._maker));
    }

    function taker(Position memory self) internal pure returns (UFixed6) {
        return UFixed6.wrap(uint256(self._taker));
    }

    function makerNext(Position memory self) internal pure returns (UFixed6) {
        return UFixed6.wrap(uint256(self._makerNext));
    }

    function takerNext(Position memory self) internal pure returns (UFixed6) {
        return UFixed6.wrap(uint256(self._takerNext));
    }

    function update(Position memory self, Fixed6 makerAmount, Fixed6 takerAmount) internal pure {
        self._makerNext = uint64(int64(self._makerNext) + int64(Fixed6.unwrap(makerAmount)));
        self._takerNext = uint64(int64(self._takerNext) + int64(Fixed6.unwrap(takerAmount)));
    }

    function settle(Position memory self) internal pure {
        self._maker = self._makerNext;
        self._taker = self._takerNext;
    }

    /**
     * @notice Returns the utilization ratio for the current position
     * @param self The Position to operate on
     * @return utilization ratio
     */
    function utilization(Position memory self) internal pure returns (UFixed6) {
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
    function socializationFactor(Position memory self) internal pure returns (UFixed6) {
        return _socializationFactor(maker(self), taker(self));
    }

    function socializationFactorNext(Position memory self) internal pure returns (UFixed6) {
        return _socializationFactor(makerNext(self), takerNext(self));
    }

    function _socializationFactor(UFixed6 makerAmount, UFixed6 takerAmount) private pure returns (UFixed6) {
        return takerAmount.isZero() ? UFixed6Lib.ONE : UFixed6Lib.min(UFixed6Lib.ONE, makerAmount.div(takerAmount));
    }
}
