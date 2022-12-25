// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/OracleVersion.sol";

interface IOracleProvider {
    function sync() external returns (OracleVersion memory);
    function currentVersion() external view returns (OracleVersion memory);
    function atVersion(uint256 oracleVersion) external view returns (OracleVersion memory);
}
