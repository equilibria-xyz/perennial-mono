// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./root/Fixed6.sol";

/// @dev A singular oracle version with its corresponding data
struct OracleVersion {
    /// @dev The iterative version
    uint256 version;

    /// @dev the timestamp of the oracle update
    uint256 timestamp;

    /// @dev The oracle price of the corresponding version
    Fixed6 price;
}
