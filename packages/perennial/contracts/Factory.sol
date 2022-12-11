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
    ProtocolParameterStorage private constant _parameter = ProtocolParameterStorage.wrap(keccak256("equilibria.perennial.UParamProvider.parameter"));
    function parameter() public view returns (ProtocolParameter memory) { return _parameter.read(); }

    /// @dev Market implementation beacon address for the protocol
    AddressStorage private constant _marketBeacon = AddressStorage.wrap(keccak256("equilibria.perennial.Factory.marketBeacon"));
    function marketBeacon() public view returns (IBeacon) { return IBeacon(_marketBeacon.read()); }

    /// @dev Fee on maintenance for liquidation
    UFixed18Storage private constant _liquidationFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Factory.liquidationFee"));
    function liquidationFee() public view returns (UFixed18) { return _liquidationFee.read(); }

    /// @dev Protocol pauser address. address(0) defaults to owner(0)
    AddressStorage private constant _treasury = AddressStorage.wrap(keccak256("equilibria.perennial.Factory.treasury"));
    function treasury() public view returns (address) {
        address treasury_ = _treasury.read();
        return treasury_ == address(0) ? owner() : treasury_;
    }

    /// @dev Protocol pauser address. address(0) defaults to owner(0)
    AddressStorage private constant _pauser = AddressStorage.wrap(keccak256("equilibria.perennial.Factory.pauser"));
    function pauser() public view returns (address) {
        address pauser_ = _pauser.read();
        return pauser_ == address(0) ? owner() : pauser_;
    }

    /**
     * @notice Initializes the contract state
     * @dev Must be called atomically as part of the upgradeable proxy deployment to
     *      avoid front-running
     * @param marketBeacon_ Market implementation beacon address
     */
    function initialize(IBeacon marketBeacon_) external initializer(1) {
        __UOwnable__initialize();
        updateMarketBeacon(marketBeacon_);
    }

    /**
     * @notice Updates the treasury of an existing coordinator
     * @dev Must be called by the current owner. Defaults to the coordinator `owner` if set to address(0)
     * @param newTreasury New treasury address
     */
    function updateTreasury(address newTreasury) external onlyOwner {
        _treasury.store(newTreasury);
        emit TreasuryUpdated(newTreasury);
    }

    /**
     * @notice Updates the protocol pauser address. Zero address defaults to owner(0)
     * @param newPauser New protocol pauser address
     */
    function updatePauser(address newPauser) public onlyOwner {
        _pauser.store(newPauser);
        emit PauserUpdated(newPauser);
    }

    /**
     * @notice Creates a new market market with `provider`
     * @dev Can only be called by the coordinator owner
     * @return New market contract address
     */
    function createMarket(IMarket.MarketDefinition calldata definition, MarketParameter calldata marketParameter)
        external
        returns (IMarket)
    {
        BeaconProxy newMarketProxy = new BeaconProxy(
            address(marketBeacon()),
            abi.encodeCall(IMarket.initialize, (definition, marketParameter))
        );
        IMarket newMarket = IMarket(address(newMarketProxy));

        UOwnable(address(newMarket)).updatePendingOwner(msg.sender); //TODO: IOwnable in root

        //TODO: create2 or registration?

        emit MarketCreated(newMarket, definition, marketParameter);

        return newMarket;
    }

    /**
     * @notice Updates the Market implementation beacon address
     * @param newMarketBeacon New Market implementation beacon address
     */
    function updateMarketBeacon(IBeacon newMarketBeacon) public onlyOwner {
        if (!Address.isContract(address(newMarketBeacon))) revert FactoryNotContractAddressError();
        _marketBeacon.store(address(newMarketBeacon));
        emit MarketBeaconUpdated(newMarketBeacon);
    }

    function updateParameter(ProtocolParameter memory newParameter) public onlyOwner {
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    /**
     * @notice Updates the liquidation fee
     * @param newLiquidationFee New liquidation fee
     */
    function updateLiquidationFee(UFixed18 newLiquidationFee) public onlyOwner {
        if (newLiquidationFee.gt(UFixed18Lib.ONE)) revert FactoryInvalidLiquidationFeeError();

        _liquidationFee.store(newLiquidationFee);
        emit LiquidationFeeUpdated(newLiquidationFee);
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
