// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial/contracts/interfaces/IProductProvider.sol";
import "@equilibria/root/curve/UtilizationCurveProvider.sol";
import "../oracle/OracleProvider.sol";

/**
 * @title ProductProvider
 * @notice Abstract contract defining the internal interface for product providers.
 */
abstract contract ProductProvider is IProductProvider, UtilizationCurveProvider, OracleProvider {
    /**
     * @notice Returns the oracle contract address
     * @return Oracle contract address
     */
    function oracle() external view returns (IOracleProvider) {
        return _readOracle();
    }

    /**
     * @notice Returns The per-second rate based on the provided `position`
     * @dev Handles 0-maker/taker edge cases
     * @param position Position to base utilization on
     * @return The per-second rate
     */
    function rate(Position memory position) external view returns (Fixed18) {
        UFixed18 utilization = position.taker.unsafeDiv(position.maker);
        Fixed18 annualizedRate = _computeRate(utilization);
        return annualizedRate.div(Fixed18Lib.from(365 days));
    }
}
