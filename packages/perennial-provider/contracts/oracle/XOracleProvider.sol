// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleProvider.sol";

/**
 * @title XOracleProvider
 * @notice Library for manage storing and surfacing an oracle provider.
 * @dev Uses an immutable storage pattern to store the oracle address which is more gas efficient,
 *      but does not allow parameters to be updated over time.
 */
abstract contract XOracleProvider is OracleProvider {
    /// @dev The address of the oracle feed for this product
    IOracleProvider private immutable _oracle;

    /**
     * @notice Initializes the contract state
     * @param oracle_ Oracle for the product
     */
    constructor(IOracleProvider oracle_) {
        _oracle = oracle_;
    }

    /**
     * @notice Returns the oracle contract address
     * @return Oracle contract address
     */
    function _readOracle() internal override view returns (IOracleProvider) {
        return _oracle;
    }
}
