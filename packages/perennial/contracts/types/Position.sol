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
    function maker(Position memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._maker) * 1e12);
    }

    function taker(Position memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._taker) * 1e12);
    }

    function makerNext(Position memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._makerNext) * 1e12);
    }

    function takerNext(Position memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self._takerNext) * 1e12);
    }

    function update(Position memory self, Fixed18 makerAmount, Fixed18 takerAmount) internal pure {
        self._makerNext = uint64(int64(self._makerNext) + int64(Fixed18.unwrap(makerAmount) / 1e12));
        self._takerNext = uint64(int64(self._takerNext) + int64(Fixed18.unwrap(takerAmount) / 1e12));
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
        return _socializationFactor(maker(self), taker(self));
    }

    function socializationFactorNext(Position memory self) internal pure returns (UFixed18) {
        return _socializationFactor(makerNext(self), takerNext(self));
    }

    function _socializationFactor(UFixed18 makerAmount, UFixed18 takerAmount) private pure returns (UFixed18) {
        return takerAmount.isZero() ? UFixed18Lib.ONE : UFixed18Lib.min(UFixed18Lib.ONE, makerAmount.div(takerAmount));
    }
}
