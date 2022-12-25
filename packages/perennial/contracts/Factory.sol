// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "./interfaces/IFactory.sol";

/**
 * @title Factory
 * @notice Manages creating new markets and global protocol parameters.
 */
contract Factory is IFactory, UInitializable, UOwnable {
    StoredProtocolParameterStorage private _parameter;

    /// @dev Market implementation address
    address public implementation;

    /// @dev Protocol pauser address. address(0) defaults to owner(0)
    address private _treasury;

    /// @dev Protocol pauser address. address(0) defaults to owner(0)
    address private _pauser;

    /**
     * @notice Initializes the contract state
     * @dev Must be called atomically as part of the upgradeable proxy deployment to
     *      avoid front-running
     * @param implementation_ Market implementation address
     */
    function initialize(address implementation_) external initializer(1) {
        __UOwnable__initialize();
        updateImplementation(implementation_);
    }

    function updateImplementation(address newImplementation) public onlyOwner {
        implementation = newImplementation;
        emit ImplementationUpdated(newImplementation);
    }

    function updateParameter(ProtocolParameter memory newParameter) public onlyOwner {
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    /**
     * @notice Updates the treasury of an existing coordinator
     * @dev Must be called by the current owner. Defaults to the coordinator `owner` if set to address(0)
     * @param newTreasury New treasury address
     */
    function updateTreasury(address newTreasury) external onlyOwner {
        _treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    /**
     * @notice Updates the protocol pauser address. Zero address defaults to owner(0)
     * @param newPauser New protocol pauser address
     */
    function updatePauser(address newPauser) public onlyOwner {
        _pauser = newPauser;
        emit PauserUpdated(newPauser);
    }

    /**
     * @notice Creates a new market market with `provider`
     * @return New market contract address
     */
    function createMarket(
        IMarket.MarketDefinition calldata definition,
        MarketParameter calldata marketParameter
    ) external returns (IMarket newMarket) {
        newMarket = IMarket(address(new BeaconProxy(
            address(this),
            abi.encodeCall(IMarket.initialize, (definition, marketParameter))
        )));
        UOwnable(address(newMarket)).updatePendingOwner(msg.sender); //TODO: IOwnable in root

        //TODO: create2 or registration?

        emit MarketCreated(newMarket, definition, marketParameter);
    }

    function parameter() public view returns (ProtocolParameter memory) {
        return _parameter.read();
    }

    function treasury() external view returns (address) {
        return _treasury == address(0) ? owner() : _treasury;
    }

    function pauser() public view returns (address) {
        return _pauser == address(0) ? owner() : _pauser;
    }

    /**
     * @notice Updates the protocol paused state
     * @param newPaused New protocol paused state
     */
    function updatePaused(bool newPaused) public {
        if (msg.sender != pauser()) revert FactoryNotPauserError();
        ProtocolParameter memory newParameter = parameter();
        newParameter.paused = newPaused;
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }
}
