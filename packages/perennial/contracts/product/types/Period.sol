// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/perennial-oracle/contracts/interfaces/IOracleProvider.sol";

/// @dev Period type
struct Period {
    IOracleProvider.OracleVersion fromVersion;
    IOracleProvider.OracleVersion toVersion;
}
using PeriodLib for Period global;

/**
 * @title PeriodLib
 * @notice
 */
library PeriodLib {
    /**
     * @notice Returns the change in timestamp during the period
     * @param self The struct to operate on
     * @return The change in timestamp during the period
     */
    function timestampDelta(Period memory self) internal pure returns (UFixed18) {
        return UFixed18Lib.from(self.toVersion.timestamp - self.fromVersion.timestamp);
    }

    /**
     * @notice Returns the change in price during the period
     * @param self The struct to operate on
     * @return The change in price during the period
     */
    function priceDelta(Period memory self) internal pure returns (Fixed18) {
        return self.toVersion.price.sub(self.fromVersion.price);
    }
}
