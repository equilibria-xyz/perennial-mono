// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.13;

import "@equilibria/perennial/contracts/interfaces/IOracleProvider.sol";
import "@equilibria/root/curve/UtilizationCurveProvider.sol";

/**
 * @title OracleProvider
 * @notice Abstract contract defining the internal interface for oracle providers.
 */
abstract contract OracleProvider is IOracleProvider, UtilizationCurveProvider {
    /**
     * @notice Returns the oracle contract address from storage implementation
     * @return Oracle contract address
     */
    function _readOracle() internal virtual view returns (IOracleProvider);

    /**
     * @notice Returns the transformed oracle version
     * @param oracleVersion Oracle version to transform
     * @return Transformed oracle version
     */
    function _transform(OracleVersion memory oracleVersion) internal view virtual returns (OracleVersion memory) {
        return OracleVersion({
            version: oracleVersion.version,
            timestamp: oracleVersion.timestamp,
            price: _payoff(oracleVersion.price)
        });
    }

    /**
     * @notice Returns the transformed oracle price
     * @param price Oracle price to transform
     * @return Transformed oracle price
     */
    function _payoff(Fixed18 price) internal view virtual returns (Fixed18) {
        return price;
    }

    /**
     * @notice Pass-through hook to call sync() on the oracle provider
     */
    function sync() external override returns (OracleVersion memory) {
        return _transform(_readOracle().sync());
    }

    /**
     * @notice Returns the current oracle version
     * @return Current oracle version
     */
    function currentVersion() external override view returns (OracleVersion memory) {
        return _transform(_readOracle().currentVersion());
    }

    /**
     * @notice Returns the oracle version at `oracleVersion`
     * @param oracleVersion Oracle version to return for
     * @return Oracle version at `oracleVersion` with price transformed by payoff function
     */
    function atVersion(uint256 oracleVersion) external override view returns (OracleVersion memory) {
        return _transform(_readOracle().atVersion(oracleVersion));
    }
}
