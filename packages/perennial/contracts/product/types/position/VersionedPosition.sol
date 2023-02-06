// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../../../interfaces/types/PrePosition.sol";
import "../../../interfaces/types/PackedPosition.sol";

//// @dev VersionedPosition type
struct VersionedPosition {
    /// @dev Mapping of global position at each version
    mapping(uint256 => PackedPosition) _positionAtVersion;

    /// @dev Current global pending-settlement position delta
    PrePosition pre;
}
using VersionedPositionLib for VersionedPosition global;

/**
 * @title VersionedPositionLib
 * @notice Library that manages global position state.
 * @dev Global position state is used to compute utilization rate and socialization, and to account for and
 *      distribute fees globally.
 *
 *      Positions are stamped for historical lookup anytime there is a global settlement, which services
 *      the delayed-position accounting. It is not guaranteed that every version will have a value stamped, but
 *      only versions when a settlement occurred are needed for this historical computation.
 */
library VersionedPositionLib {
    /**
     * @notice Returns the current global position
     * @return Current global position
     */
    function positionAtVersion(VersionedPosition storage self, uint256 oracleVersion) internal view returns (Position memory) {
        return self._positionAtVersion[oracleVersion].unpack();
    }

    /**
     * @notice Settled the global position to oracle version `toOracleVersion`
     * @param self The struct to operate on
     * @param latestVersion The latest settled oracle version
     * @param toOracleVersion The oracle version to settle to
     */
    function settle(
        VersionedPosition storage self,
        uint256 latestVersion,
        IOracleProvider.OracleVersion memory toOracleVersion
    ) internal {
        (Position memory newPosition, bool settled) =
            positionAtVersion(self, latestVersion).settled(self.pre, toOracleVersion);

        self._positionAtVersion[toOracleVersion.version] = newPosition.pack();
        if (settled) delete self.pre;
    }
}
