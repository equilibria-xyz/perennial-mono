// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./root/UFixed6.sol";
import "./OracleVersion.sol";

/// @dev Position type
struct Position {
    uint256 latestVersion;
    /// @dev Quantity of the maker position
    UFixed6 maker;
    /// @dev Quantity of the taker position
    UFixed6 taker;
    /// @dev Quantity of the next maker position
    UFixed6 makerNext;
    /// @dev Quantity of the next taker position
    UFixed6 takerNext;
}
using PositionLib for Position global;
struct StoredPosition {
    uint32 _latestVersion;
    uint56 _maker;
    uint56 _taker;
    uint56 _makerNext;
    uint56 _takerNext;
}
struct StoredPositionStorage { StoredPosition value; }
using StoredPositionStorageLib for StoredPositionStorage global;

/**
 * @title PositionLib
 * @notice Library that surfaces math and settlement computations for the Position type.
 * @dev Positions track the current quantity of the account's maker and taker positions respectively
 *      denominated as a unit of the product's payoff function.
 */
library PositionLib {
    function update(Position memory self, Fixed6 makerAmount, Fixed6 takerAmount) internal pure {
        self.makerNext = UFixed6Lib.from(Fixed6Lib.from(self.makerNext).add(makerAmount));
        self.takerNext = UFixed6Lib.from(Fixed6Lib.from(self.takerNext).add(takerAmount));
    }

    function settle(Position memory self, OracleVersion memory toOracleVersion) internal pure {
        self.latestVersion = toOracleVersion.version;
        self.maker = self.makerNext;
        self.taker = self.takerNext;
    }

    /**
     * @notice Returns the utilization ratio for the current position
     * @param self The Position to operate on
     * @return utilization ratio
     */
    function utilization(Position memory self) internal pure returns (UFixed6) {
        return self.taker.unsafeDiv(self.maker);
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
        return _socializationFactor(self.maker, self.taker);
    }

    function socializationFactorNext(Position memory self) internal pure returns (UFixed6) {
        return _socializationFactor(self.makerNext, self.takerNext);
    }

    function _socializationFactor(UFixed6 makerAmount, UFixed6 takerAmount) private pure returns (UFixed6) {
        return takerAmount.isZero() ? UFixed6Lib.ONE : UFixed6Lib.min(UFixed6Lib.ONE, makerAmount.div(takerAmount));
    }
}

library StoredPositionStorageLib {
    function read(StoredPositionStorage storage self) internal view returns (Position memory) {
        StoredPosition memory storedValue =  self.value;
        return Position(
            uint256(storedValue._latestVersion),
            UFixed6.wrap(uint256(storedValue._maker)),
            UFixed6.wrap(uint256(storedValue._taker)),
            UFixed6.wrap(uint256(storedValue._makerNext)),
            UFixed6.wrap(uint256(storedValue._takerNext))
        );
    }

    function store(StoredPositionStorage storage self, Position memory newValue) internal {
        self.value = StoredPosition(
            uint32(newValue.latestVersion),
            uint56(UFixed6.unwrap(newValue.maker)),
            uint56(UFixed6.unwrap(newValue.taker)),
            uint56(UFixed6.unwrap(newValue.makerNext)),
            uint56(UFixed6.unwrap(newValue.takerNext))
        );
    }
}
