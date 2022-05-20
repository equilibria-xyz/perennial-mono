// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.13;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@equilibria/root/storage/UStorage.sol";
import "./OracleProvider.sol";

/**
 * @title UOracleProvider
 * @notice Library for manage storing, surfacing, and upgrading an oracle provider.
 * @dev Uses an unstructured storage pattern to store the oracle address which allows this provider to be safely used
 *      with upgradeable contracts.
 */
abstract contract UOracleProvider is OracleProvider, UOwnable {
    event OracleUpdated(IOracleProvider newOracle);

    /// @dev The oracle contract address
    AddressStorage private constant _oracle = AddressStorage.wrap(keccak256("equilibria.perennial.UOracleProvider.oracle"));
    function _readOracle() internal override view returns (IOracleProvider) { return IOracleProvider(_oracle.read()); }

    /**
     * @notice Initializes the contract state
     * @param initialOracle Initial oracle for the product
     */
    function __UOracleProvider__initialize(IOracleProvider initialOracle)
    internal onlyInitializer {
        updateOracle(initialOracle);
    }

    /**
     * @notice Updates the oracle address to `newOracle`
     * @param newOracle new oracle address
     */
    function updateOracle(IOracleProvider newOracle) public onlyOwner {
        _oracle.store(address(newOracle));
        emit OracleUpdated(newOracle);
    }
}
