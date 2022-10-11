// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "../../../interfaces/types/Accumulator.sol";
import "../position/AccountPosition.sol";
import "./Version.sol";

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
     * @param versions Pointer to the global versions mapping
     * @param position Pointer to global position
     * @param versionTo Oracle version to sync account to
     * @return value The value accumulated sync last sync
     */
    function syncTo(
        AccountAccumulator storage self,
        mapping(uint256 => Version) storage versions,
        AccountPosition storage position,
        uint256 versionTo
    ) internal returns (Accumulator memory value) {
        value = position.position.mul(versions[versionTo].value().sub(versions[self.latestVersion].value()));
        self.latestVersion = versionTo;
    }
}
