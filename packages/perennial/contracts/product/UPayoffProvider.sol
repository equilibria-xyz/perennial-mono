// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/perennial-oracle/contracts/interfaces/IOracleProvider.sol";
import "@equilibria/root/storage/UStorage.sol";
import "../interfaces/IPayoffProvider.sol";
import "../interfaces/types/PayoffDefinition.sol";

/**
 * @title UPayoffProvider
 * @notice Library for manage storing, surfacing, and upgrading a payoff provider.
 * @dev Uses an unstructured storage pattern to store the oracle address and payoff definition which allows this
        provider to be safely used with upgradeable contracts.
 */
abstract contract UPayoffProvider is IPayoffProvider, UInitializable {
    /// @dev The oracle contract address
    AddressStorage private constant _oracle =
        AddressStorage.wrap(keccak256("equilibria.perennial.UPayoffProvider.oracle"));
    function oracle() public view returns (IOracleProvider) { return IOracleProvider(_oracle.read()); }

    /// @dev Payoff definition struct
    PayoffDefinitionStorage private constant _payoffDefinition =
        PayoffDefinitionStorage.wrap(keccak256("equilibria.perennial.UPayoffProvider.payoffDefinition"));
    function payoffDefinition() public view returns (PayoffDefinition memory) { return _payoffDefinition.read(); }

    /**
     * @notice Initializes the contract state
     * @param oracle_ Oracle address
     * @param payoffDefinition_ Payoff provider
     */
    // solhint-disable-next-line func-name-mixedcase
    function __UPayoffProvider__initialize(IOracleProvider oracle_, PayoffDefinition calldata payoffDefinition_) internal onlyInitializer {
        _updateOracle(address(oracle_), 0);

        if (!payoffDefinition_.valid()) revert PayoffProviderInvalidPayoffDefinitionError();
        _payoffDefinition.store(payoffDefinition_);
    }

    /**
     * @notice Returns the current oracle version transformed by the payoff definition
     * @return Current oracle version transformed by the payoff definition
     */
    function currentVersion() public view returns (IOracleProvider.OracleVersion memory) {
        return _transform(oracle().currentVersion());
    }

    /**
     * @notice Returns the oracle version at `oracleVersion` transformed by the payoff definition
     * @param oracleVersion Oracle version to return for
     * @return Oracle version at `oracleVersion` with price transformed by payoff function
     */
    function atVersion(uint256 oracleVersion) public view returns (IOracleProvider.OracleVersion memory) {
        return _transform(oracle().atVersion(oracleVersion));
    }

    /**
     * @notice Updates oracle to newOracle address
     * @param newOracle New oracle address
     * @param oracleVersion Oracle version of update
     */
    function _updateOracle(address newOracle, uint256 oracleVersion) internal {
        if (!Address.isContract(newOracle)) revert PayoffProviderInvalidOracle();
        _oracle.store(newOracle);

        emit OracleUpdated(newOracle, oracleVersion);
    }

    /**
     * @notice Hook to call sync() on the oracle provider and transform the resulting oracle version
     */
    function _sync() internal returns (IOracleProvider.OracleVersion memory) {
        return _transform(oracle().sync());
    }

    /**
     * @notice Returns the transformed oracle version
     * @param oracleVersion Oracle version to transform
     * @return Transformed oracle version
     */
    function _transform(IOracleProvider.OracleVersion memory oracleVersion)
    internal view virtual returns (IOracleProvider.OracleVersion memory) {
        oracleVersion.price = payoffDefinition().transform(oracleVersion.price);
        return oracleVersion;
    }
}
