// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../interfaces/IPayoffProvider.sol";
import "./OracleVersion.sol";

/// @dev Payoff type
struct Payoff {
    IPayoffProvider provider;
    bool short;
}
using PayoffLib for Payoff global;

/**
 * @title PayoffLib
 * @notice
 * @dev
 */
library PayoffLib {
    function transform(Payoff memory self, OracleVersion memory oracleVersion) internal pure {
        if (address(self.provider) != address(0)) oracleVersion.price = self.provider.payoff(oracleVersion.price);
        if (self.short) oracleVersion.price = oracleVersion.price.mul(Fixed6Lib.NEG_ONE);
    }
}
