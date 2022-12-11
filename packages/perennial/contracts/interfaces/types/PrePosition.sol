// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/perennial-oracle/contracts/interfaces/IOracleProvider.sol";
import "./Parameter.sol";
import "./Position.sol";
import "../IMarket.sol";

/// @dev PrePosition type
struct PrePosition {
    PackedFixed18 _maker;
    PackedFixed18 _taker;
    PackedUFixed18 _makerFee;
    PackedUFixed18 _takerFee; //TODO: introduce intra-version netting for fees
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
    function maker(PrePosition memory self) internal pure returns (Fixed18) {
        return self._maker.unpack();
    }

    function taker(PrePosition memory self) internal pure returns (Fixed18) {
        return self._taker.unpack();
    }

    function fees(PrePosition memory self) internal pure returns (Position memory) {
        return Position(self._makerFee.unpack(), self._takerFee.unpack());
    }

    /**
     * @notice Returns whether there is no pending-settlement position delta
     * @dev Can be "empty" even with a non-zero oracleVersion if a position is opened and
     *      closed in the same version netting out to a zero position delta
     * @param self The struct to operate on
     * @return Whether the pending-settlement position delta is empty
     */
    function isEmpty(PrePosition memory self) internal pure returns (bool) {
        return self.maker().isZero() && self.taker().isZero() && self.fees().isEmpty();
    }

    function clear(PrePosition memory self) internal pure {
        self._maker = PackedFixed18.wrap(0);
        self._taker = PackedFixed18.wrap(0);
        self._makerFee = PackedUFixed18.wrap(0);
        self._takerFee = PackedUFixed18.wrap(0);
    }

    function update(
        PrePosition memory self,
        Fixed18 makerAmount,
        Fixed18 takerAmount,
        IOracleProvider.OracleVersion memory currentOracleVersion,
        Parameter memory parameter
    ) internal pure {
        self._maker = self.maker().add(makerAmount).pack();
        self._taker = self.taker().add(takerAmount).pack();
        self._makerFee = self._makerFee //TODO: double computing
            .unpack()
            .add(makerAmount.mul(currentOracleVersion.price).abs().mul(parameter.makerFee))
            .pack();
        self._takerFee = self._takerFee
            .unpack()
            .add(takerAmount.mul(currentOracleVersion.price).abs().mul(parameter.takerFee))
            .pack();
    }
}
