// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../../../interfaces/types/Accumulator.sol";
import "../position/AccountPosition.sol";
import "./VersionedAccumulator.sol";

/// @dev AccountAccumulator type
struct AccountAccumulator {
    /// @dev latest version that the account was synced too
    uint256 latestVersion;
}
using AccountAccumulatorLib for AccountAccumulator global;

/**
 * @title AccountAccumulatorLib
 * @notice Library that manages syncing an account-level accumulator.
 */
library AccountAccumulatorLib {
    /**
     * @notice Syncs the account to oracle version `versionTo`
     * @param self The struct to operate on
     * @param global Pointer to global accumulator
     * @param position Pointer to global position
     * @param versionTo Oracle version to sync account to
     * @return value The value accumulated sync last sync
     */
    function syncTo(
        AccountAccumulator storage self,
        VersionedAccumulator storage global,
        AccountPosition storage position,
        uint256 versionTo
    ) internal returns (Accumulator memory value) {
        Accumulator memory valueAccumulated = global.valueAtVersion(versionTo)
            .sub(global.valueAtVersion(self.latestVersion));
        value = position.position.mul(valueAccumulated);
        self.latestVersion = versionTo;
    }
}
