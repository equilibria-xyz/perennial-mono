// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";

/// @dev PendingFeeUpdates type. Fees can be between 0 and 1 ** 10^18, so uint64 is sufficient
struct PendingFeeUpdates {
    bool makerFeeUpdated;
    uint64 pendingMakerFee;
    bool takerFeeUpdated;
    uint64 pendingTakerFee;
    bool positionFeeUpdated;
    uint64 pendingPositionFee;
}
using PendingFeeUpdatesLib for PendingFeeUpdates global;
type PendingFeeUpdatesStorage is bytes32;
using PendingFeeUpdatesStorageLib for PendingFeeUpdatesStorage global;

/**
 * @title PendingFeeUpdatesLib
 * @dev Library that surfaces convenience functions for the PendingFeeUpdates type
 * @notice Library for the PendingFeeUpdates type. Allows for setting and reading fee updates and clearing state
 */
library PendingFeeUpdatesLib {
    error PendingFeeUpdatesUnsupportedValue(UFixed18 value);

    /**
     * @notice Updates the pending maker fee to `newMakerFee` and sets the `makerFeeUpdated` flag
     * @dev Reverts if `newMakerFee` is invalid
     * @param self PendingFeeUpdates struct
     * @param newMakerFee new maker fee value
     */
    function updateMakerFee(PendingFeeUpdates memory self, UFixed18 newMakerFee) internal pure {
        if (UFixed18.unwrap(newMakerFee) > type(uint64).max) revert PendingFeeUpdatesUnsupportedValue(newMakerFee);
        self.pendingMakerFee = uint64(UFixed18.unwrap(newMakerFee));
        self.makerFeeUpdated = true;
    }

    /// @dev Returns the UFixed18-wrapped pending maker fee
    function makerFee(PendingFeeUpdates memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self.pendingMakerFee));
    }

    /**
     * @notice Updates the pending taker fee to `newTakerFee` and sets the `takerFeeUpdated` flag
     * @dev Reverts if `newTakerFee` is invalid
     * @param self PendingFeeUpdates struct
     * @param newTakerFee new taker fee value
     */
    function updateTakerFee(PendingFeeUpdates memory self, UFixed18 newTakerFee) internal pure {
        if (UFixed18.unwrap(newTakerFee) > type(uint64).max) revert PendingFeeUpdatesUnsupportedValue(newTakerFee);
        self.pendingTakerFee = uint64(UFixed18.unwrap(newTakerFee));
        self.takerFeeUpdated = true;
    }

    /// @dev Returns the UFixed18-wrapped pending taker fee
    function takerFee(PendingFeeUpdates memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self.pendingTakerFee));
    }

    /**
     * @notice Updates the pending position fee to `newPositionFee` and sets the `positionFeeUpdated` flag
     * @dev Reverts if `newPositionFee` is invalid
     * @param self PendingFeeUpdates struct
     * @param newPositionFee new position fee value
     */
    function updatePositionFee(PendingFeeUpdates memory self, UFixed18 newPositionFee) internal pure {
        if (UFixed18.unwrap(newPositionFee) > type(uint64).max) revert PendingFeeUpdatesUnsupportedValue(newPositionFee);
        self.pendingPositionFee = uint64(UFixed18.unwrap(newPositionFee));
        self.positionFeeUpdated = true;
    }

    /// @dev Returns the UFixed18-wrapped pending position fee
    function positionFee(PendingFeeUpdates memory self) internal pure returns (UFixed18) {
        return UFixed18.wrap(uint256(self.pendingPositionFee));
    }

    /// @dev Returns true if any of the updated flags are true
    function hasUpdates(PendingFeeUpdates memory self) internal pure returns (bool) {
        return self.makerFeeUpdated || self.takerFeeUpdated || self.positionFeeUpdated;
    }

    /// @dev Resets all struct values to defaults
    function clear(PendingFeeUpdates memory self) internal pure {
        self.makerFeeUpdated = false;
        self.pendingMakerFee = 0;
        self.takerFeeUpdated = false;
        self.pendingTakerFee = 0;
        self.positionFeeUpdated = false;
        self.pendingPositionFee = 0;
    }
}

/**
 * @title PendingFeeUpdatesStorageLib
 * @notice Library that surfaces storage read and writes for the PendingFeeUpdates type
 */
library PendingFeeUpdatesStorageLib {
    struct PendingFeeUpdatesStoragePointer {
        PendingFeeUpdates value;
    }

    function read(PendingFeeUpdatesStorage self) internal view returns (PendingFeeUpdates memory) {
        return _storagePointer(self).value;
    }

    function store(PendingFeeUpdatesStorage self, PendingFeeUpdates memory value) internal {
        _storagePointer(self).value = value;
    }

    function _storagePointer(
        PendingFeeUpdatesStorage self
    ) private pure returns (PendingFeeUpdatesStoragePointer storage pointer) {
        /// @solidity memory-safe-assembly
        assembly { pointer.slot := self } // solhint-disable-line no-inline-assembly
    }
}
