// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/perennial-oracle/contracts/interfaces/IOracleProvider.sol";
import "./Position.sol";
import "../IProduct.sol";

/// @dev PrePosition type
struct PrePosition {
    /// @dev Size of position to open at oracle version
    Position openPosition;

    /// @dev Size of position to close at oracle version
    Position closePosition;
}
using PrePositionLib for PrePosition global;

/**
 * @title PrePositionLib
 * @notice Library that manages a pre-settlement position delta.
 * @dev PrePositions track the currently awaiting-settlement deltas to a settled Position. These are
 *      Primarily necessary to introduce lag into the settlement system such that oracle lag cannot be
 *      gamed to a user's advantage. When a user opens or closes a new position, it sits as a PrePosition
 *      for one oracle version until it's settle into the Position, making it then effective. PrePositions
 *      are automatically settled at the correct oracle version even if a flywheel call doesn't happen until
 *      several version into the future by using the historical version lookups in the corresponding "Versioned"
 *      global state types.
 */
library PrePositionLib {
    /**
     * @notice Returns whether there is no pending-settlement position delta
     * @dev Can be "empty" even with a non-zero oracleVersion if a position is opened and
     *      closed in the same version netting out to a zero position delta
     * @param self The struct to operate on
     * @return Whether the pending-settlement position delta is empty
     */
    function isEmpty(PrePosition memory self) internal pure returns (bool) {
        return self.openPosition.isEmpty() && self.closePosition.isEmpty();
    }

    function update(PrePosition storage self, Fixed18 position, Fixed18 amount) internal {
        if (amount.sign() == 1) {
            if (position.sign() == 1) {
                self.openPosition.taker = self.openPosition.taker.add(amount.abs());
            } else {
                if (position.sign() == position.add(amount).sign() || position.add(amount).sign() == 0) {
                    self.closePosition.maker = self.closePosition.maker.add(amount.abs());
                } else {
                    self.closePosition.maker = self.closePosition.maker.add(position.abs());
                    self.openPosition.taker = self.openPosition.taker.add(amount.abs().sub(position.abs()));
                }
            }
        } else {
            if (position.sign() == 1) {
                if (position.sign() == position.add(amount).sign() || position.add(amount).sign() == 0) {
                    self.closePosition.taker = self.closePosition.taker.add(amount.abs());
                } else {
                    self.closePosition.taker = self.closePosition.taker.add(position.abs());
                    self.openPosition.maker = self.openPosition.maker.add(amount.abs().sub(position.abs()));
                }
            } else {
                self.openPosition.maker = self.openPosition.maker.add(amount.abs());
            }
        }
    }

    /**
     * @notice Computes the fee incurred for opening or closing the pending-settlement position
     * @dev Must be called from a valid product to get the proper fee amounts
     * @param self The struct to operate on
     * @param toOracleVersion The oracle version at which settlement takes place
     * @param makerFee The fee for opening or closing a maker position
     * @param takerFee The fee for opening or closing a taker position
     * @return positionFee The maker / taker fee incurred
     */
    function computeFee(
        PrePosition memory self,
        IOracleProvider.OracleVersion memory toOracleVersion,
        UFixed18 makerFee,
        UFixed18 takerFee
    ) internal pure returns (Position memory) {
        Position memory positionDelta = self.openPosition.add(self.closePosition);

        (UFixed18 makerNotional, UFixed18 takerNotional) = (
            Fixed18Lib.from(positionDelta.maker).mul(toOracleVersion.price).abs(),
            Fixed18Lib.from(positionDelta.taker).mul(toOracleVersion.price).abs()
        );

        return Position(makerNotional.mul(makerFee), takerNotional.mul(takerFee));
    }
}
