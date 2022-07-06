// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "../interfaces/IProductProvider.sol";

contract TestnetProductProvider is IProductProvider {

    IOracleProvider public immutable oracle;

    constructor(IOracleProvider oracle_) {
        oracle = oracle_;
    }

    function sync() external returns (OracleVersion memory) {
        return _transform(oracle.sync());
    }

    function currentVersion() external view returns (OracleVersion memory) {
        return _transform(oracle.currentVersion());
    }

    function atVersion(uint256 oracleVersion) external view returns (OracleVersion memory) {
        return _transform(oracle.atVersion(oracleVersion));
    }

    function _transform(OracleVersion memory oracleVersion) internal pure returns (OracleVersion memory) {
        return OracleVersion({
            version: oracleVersion.version,
            timestamp: oracleVersion.timestamp,
            price: _payoff(oracleVersion.price)
        });
    }

    function _payoff(Fixed18 price) internal pure returns (Fixed18) {
        return price.mul(price);
    }
}
