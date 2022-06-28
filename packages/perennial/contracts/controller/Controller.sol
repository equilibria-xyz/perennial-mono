// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "../interfaces/IController.sol";
import "../interfaces/ICollateral.sol";
import "../interfaces/IIncentivizer.sol";
import "../interfaces/IProduct.sol";

/**
 * @title Controller
 * @notice Manages creating new products and global protocol parameters.
 */
contract Controller is IController, UInitializable {
    /// @dev Collateral contract address for the protocol
    AddressStorage private constant _collateral = AddressStorage.wrap(keccak256("equilibria.perennial.Controller.collateral"));
    function collateral() public view returns (ICollateral) { return ICollateral(_collateral.read()); }

    /// @dev Incentivizer contract address for the protocol
    AddressStorage private constant _incentivizer = AddressStorage.wrap(keccak256("equilibria.perennial.Controller.incentivizer"));
    function incentivizer() public view returns (IIncentivizer) { return IIncentivizer(_incentivizer.read()); }

    /// @dev Product implementation beacon address for the protocol
    AddressStorage private constant _productBeacon = AddressStorage.wrap(keccak256("equilibria.perennial.Controller.productBeacon"));
    function productBeacon() public view returns (IBeacon) { return IBeacon(_productBeacon.read()); }

    /// @dev Percent of collected fees that go to the protocol treasury vs the product treasury
    UFixed18Storage private constant _protocolFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Controller.protocolFee"));
    function protocolFee() public view returns (UFixed18) { return _protocolFee.read(); }

    /// @dev Minimum allowable funding fee for a product
    UFixed18Storage private constant _minFundingFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Controller.minFundingFee"));
    function minFundingFee() public view returns (UFixed18) { return _minFundingFee.read(); }

    /// @dev Fee on maintenance for liquidation
    UFixed18Storage private constant _liquidationFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Controller.liquidationFee"));
    function liquidationFee() public view returns (UFixed18) { return _liquidationFee.read(); }

    /// @dev Fee on incentivization programs
    UFixed18Storage private constant _incentivizationFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Controller.incentivizationFee"));
    function incentivizationFee() public view returns (UFixed18) { return _incentivizationFee.read(); }

    /// @dev Minimum allowable collateral amount per user account
    UFixed18Storage private constant _minCollateral = UFixed18Storage.wrap(keccak256("equilibria.perennial.Controller.minCollateral"));
    function minCollateral() public view returns (UFixed18) { return _minCollateral.read(); }

    /// @dev Maximum incentivization programs per product allowed
    Uint256Storage private constant _programsPerProduct = Uint256Storage.wrap(keccak256("equilibria.perennial.Controller.programsPerProduct"));
    function programsPerProduct() public view returns (uint256) { return _programsPerProduct.read(); }

    /// @dev List of product coordinators
    Coordinator[] private _coordinators;

    /// @dev Mapping of the coordinator for each  product
    mapping(IProduct => uint256) public coordinatorFor;

    /**
     * @notice Initializes the contract state
     * @dev Must be called atomically as part of the upgradeable proxy deployment to
     *      avoid front-running
     * @param collateral_ Collateral contract address
     * @param incentivizer_ Incentivizer contract address
     * @param productBeacon_ Product implementation beacon address
     */
    function initialize(
        ICollateral collateral_,
        IIncentivizer incentivizer_,
        IBeacon productBeacon_
    ) external initializer(1) {
        _createCoordinator();

        updateCollateral(collateral_);
        updateIncentivizer(incentivizer_);
        updateProductBeacon(productBeacon_);
    }

    /**
     * @notice Creates a new coordinator with `msg.sender` as the owner
     * @dev Can only be called by the protocol owner
     * @return New coordinator ID
     */
    function createCoordinator() external returns (uint256) {
        return _createCoordinator();
    }

    /**
     * @notice Creates a new coordinator with `msg.sender` as the owner
     * @dev `treasury` and `pauser` initialize as the 0-address, defaulting to the `owner`
     * @return New coordinator ID
     */
    function _createCoordinator() private returns (uint256) {
        uint256 coordinatorId = _coordinators.length;

        _coordinators.push(Coordinator({
            pendingOwner: address(0),
            owner: msg.sender,
            treasury: address(0),
            pauser: address(0),
            paused: false
        }));

        emit CoordinatorCreated(coordinatorId, msg.sender);

        return coordinatorId;
    }

    /**
     * @notice Updates the pending owner of an existing coordinator
     * @dev Must be called by the coordinator's current owner
     * @param coordinatorId Coordinator to update
     * @param newPendingOwner New pending owner address
     */
    function updateCoordinatorPendingOwner(uint256 coordinatorId, address newPendingOwner) external onlyOwner(coordinatorId) {
        _coordinators[coordinatorId].pendingOwner = newPendingOwner;
        emit CoordinatorPendingOwnerUpdated(coordinatorId, newPendingOwner);
    }

    /**
     * @notice Accepts ownership over an existing coordinator
     * @dev Must be called by the coordinator's pending owner
     * @param coordinatorId Coordinator to update
     */
    function acceptCoordinatorOwner(uint256 coordinatorId) external {
        Coordinator storage coordinator = _coordinators[coordinatorId];
        address newPendingOwner = coordinator.pendingOwner;

        if (msg.sender != newPendingOwner) revert ControllerNotPendingOwnerError(coordinatorId);

        coordinator.pendingOwner = address(0);
        coordinator.owner = newPendingOwner;
        emit CoordinatorOwnerUpdated(coordinatorId, newPendingOwner);
    }

    /**
     * @notice Updates the treasury of an existing coordinator
     * @dev Must be called by the coordinator's current owner. Defaults to the coordinator `owner` if set to address(0)
     * @param coordinatorId Coordinator to update
     * @param newTreasury New treasury address
     */
    function updateCoordinatorTreasury(uint256 coordinatorId, address newTreasury) external onlyOwner(coordinatorId) {
        _coordinators[coordinatorId].treasury = newTreasury;
        emit CoordinatorTreasuryUpdated(coordinatorId, newTreasury);
    }

    /**
     * @notice Updates the pauser of an existing coordinator
     * @dev Must be called by the coordinator's current owner. Defaults to the coordinator `owner` if set to address(0)
     * @param coordinatorId Coordinator to update
     * @param newPauser New pauser address
     */
    function updateCoordinatorPauser(uint256 coordinatorId, address newPauser) external onlyOwner(coordinatorId) {
        _coordinators[coordinatorId].pauser = newPauser;
        emit CoordinatorPauserUpdated(coordinatorId, newPauser);
    }

    /**
     * @notice Updates the paused status of an existing coordinator
     * @dev Must be called by the coordinator's current owner
     * @param coordinatorId Coordinator to update
     * @param newPaused New paused status
     */
    function updateCoordinatorPaused(uint256 coordinatorId, bool newPaused) external onlyPauser(coordinatorId) {
        _coordinators[coordinatorId].paused = newPaused;
        emit CoordinatorPausedUpdated(coordinatorId, newPaused);
    }

    /**
     * @notice Creates a new product market with `provider`
     * @dev Can only be called by the coordinator owner
     * @param coordinatorId Coordinator that will own the product
     * @param productParams Params used to initialize the product
     * @return New product contract address
     */
    function createProduct(uint256 coordinatorId, ProductInitParams calldata productParams) external onlyOwner(coordinatorId) returns (IProduct) {
        if (coordinatorId == 0) revert ControllerNoZeroCoordinatorError();

        BeaconProxy newProductProxy = new BeaconProxy(address(productBeacon()), abi.encodeCall(IProduct.initialize, productParams));
        IProduct newProduct = IProduct(address(newProductProxy));
        coordinatorFor[newProduct] = coordinatorId;
        emit ProductCreated(newProduct, productParams.productProvider);

        return newProduct;
    }

    /**
     * @notice Updates the Collateral contract address
     * @param newCollateral New Collateral contract address
     */
    function updateCollateral(ICollateral newCollateral) public onlyOwner(0) {
        if (!Address.isContract(address(newCollateral))) revert ControllerNotContractAddressError();
        _collateral.store(address(newCollateral));
        emit CollateralUpdated(newCollateral);
    }

    /**
     * @notice Updates the Incentivizer contract address
     * @param newIncentivizer New Incentivizer contract address
     */
    function updateIncentivizer(IIncentivizer newIncentivizer) public onlyOwner(0) {
        if (!Address.isContract(address(newIncentivizer))) revert ControllerNotContractAddressError();
        _incentivizer.store(address(newIncentivizer));
        emit IncentivizerUpdated(newIncentivizer);
    }

    /**
     * @notice Updates the Product implementation beacon address
     * @param newProductBeacon New Product implementation beacon address
     */
    function updateProductBeacon(IBeacon newProductBeacon) public onlyOwner(0) {
        if (!Address.isContract(address(newProductBeacon))) revert ControllerNotContractAddressError();
        _productBeacon.store(address(newProductBeacon));
        emit ProductBeaconUpdated(newProductBeacon);
    }

    /**
     * @notice Updates the protocol-product fee split
     * @param newProtocolFee New protocol-product fee split
     */
    function updateProtocolFee(UFixed18 newProtocolFee) public onlyOwner(0) {
        if (newProtocolFee.gt(UFixed18Lib.ONE)) revert ControllerInvalidProtocolFeeError();

        _protocolFee.store(newProtocolFee);
        emit ProtocolFeeUpdated(newProtocolFee);
    }

    /**
     * @notice Updates the minimum allowed funding fee
     * @param newMinFundingFee New minimum allowed funding fee
     */
    function updateMinFundingFee(UFixed18 newMinFundingFee) public onlyOwner(0) {
        if (newMinFundingFee.gt(UFixed18Lib.ONE)) revert ControllerInvalidMinFundingFeeError();

        _minFundingFee.store(newMinFundingFee);
        emit MinFundingFeeUpdated(newMinFundingFee);
    }

    /**
     * @notice Updates the liquidation fee
     * @param newLiquidationFee New liquidation fee
     */
    function updateLiquidationFee(UFixed18 newLiquidationFee) public onlyOwner(0) {
        if (newLiquidationFee.gt(UFixed18Lib.ONE)) revert ControllerInvalidLiquidationFeeError();

        _liquidationFee.store(newLiquidationFee);
        emit LiquidationFeeUpdated(newLiquidationFee);
    }

    /**
     * @notice Updates the incentivization fee
     * @param newIncentivizationFee New incentivization fee
     */
    function updateIncentivizationFee(UFixed18 newIncentivizationFee) public onlyOwner(0) {
        if (newIncentivizationFee.gt(UFixed18Lib.ONE)) revert ControllerInvalidIncentivizationFeeError();

        _incentivizationFee.store(newIncentivizationFee);
        emit IncentivizationFeeUpdated(newIncentivizationFee);
    }

    /**
     * @notice Updates the minimum allowed collateral amount per user account
     * @param newMinCollateral New minimum allowed collateral amount
     */
    function updateMinCollateral(UFixed18 newMinCollateral) public onlyOwner(0) {
        _minCollateral.store(newMinCollateral);
        emit MinCollateralUpdated(newMinCollateral);
    }

    /**
     * @notice Updates the maximum incentivization programs per product allowed
     * @param newProgramsPerProduct New maximum incentivization programs per product allowed
     */
    function updateProgramsPerProduct(uint256 newProgramsPerProduct) public onlyOwner(0) {
        _programsPerProduct.store(newProgramsPerProduct);
        emit ProgramsPerProductUpdated(newProgramsPerProduct);
    }

    /**
     * @notice Returns whether a contract is a product
     * @param product Contract address to check
     * @return Whether a contract is a product
     */
    function isProduct(IProduct product) external view returns (bool) {
        return coordinatorFor[product] != 0;
    }

    /**
     * @notice Returns coordinator state for coordinator `coordinatorId`
     * @param coordinatorId Coordinator to return for
     * @return Coordinator state
     */
    function coordinators(uint256 coordinatorId) external view returns (Coordinator memory) {
        return _coordinators[coordinatorId];
    }

    /**
     * @notice Returns the pending owner of the protocol
     * @return Owner of the protocol
     */
    function pendingOwner() public view returns (address) {
        return pendingOwner(0);
    }

    /**
     * @notice Returns the pending owner of the coordinator `coordinatorId`
     * @param coordinatorId Coordinator to return for
     * @return Pending owner of the coordinator
     */
    function pendingOwner(uint256 coordinatorId) public view returns (address) {
        return _coordinators[coordinatorId].pendingOwner;
    }

    /**
     * @notice Returns the owner of the protocol
     * @return Owner of the protocol
     */
    function owner() public view returns (address) {
        return owner(0);
    }

    /**
     * @notice Returns the owner of the coordinator `coordinatorId`
     * @param coordinatorId Coordinator to return for
     * @return Owner of the coordinator
     */
    function owner(uint256 coordinatorId) public view returns (address) {
        return _coordinators[coordinatorId].owner;
    }

    /**
     * @notice Returns the owner of the product `product`
     * @param product Product to return for
     * @return Owner of the product
     */
    function owner(IProduct product) external view returns (address) {
        return owner(coordinatorFor[product]);
    }

    /**
     * @notice Returns the treasury of the protocol
     * @dev Defaults to the `owner` when `treasury` is unset
     * @return Treasury of the protocol
     */
    function treasury() external view returns (address) {
        return treasury(0);
    }

    /**
     * @notice Returns the treasury of the coordinator `coordinatorId`
     * @dev Defaults to the `owner` when `treasury` is unset
     * @param coordinatorId Coordinator to return for
     * @return Treasury of the coordinator
     */
    function treasury(uint256 coordinatorId) public view returns (address) {
        address _treasury = _coordinators[coordinatorId].treasury;
        return _treasury == address(0) ? owner(coordinatorId) : _treasury;
    }

    /**
     * @notice Returns the treasury of the product `product`
     * @dev Defaults to the `owner` when `treasury` is unset
     * @param product Product to return for
     * @return Treasury of the product
     */
    function treasury(IProduct product) external view returns (address) {
        return treasury(coordinatorFor[product]);
    }

    /**
     * @notice Returns the pauser of the protocol
     * @dev Defaults to the `owner` when `pauser` is unset
     * @return Pauser of the protocol
     */
    function pauser() external view returns (address) {
        return pauser(0);
    }

    /**
     * @notice Returns the pauser of the coordinator `coordinatorId`
     * @dev Defaults to the `owner` when `pauser` is unset
     * @param coordinatorId Coordinator to return for
     * @return Pauser of the coordinator
     */
    function pauser(uint256 coordinatorId) public view returns (address) {
        address _pauser = _coordinators[coordinatorId].pauser;
        return _pauser == address(0) ? owner(coordinatorId) : _pauser;
    }

    /**
     * @notice Returns the pauser of the product `product`
     * @dev Defaults to the `owner` when `pauser` is unset
     * @param product Product to return for
     * @return Pauser of the product
     */
    function pauser(IProduct product) external view returns (address) {
        return pauser(coordinatorFor[product]);
    }

    /**
     * @notice Returns the paused status of the protocol
     * @return Paused status of the protocol
     */
    function paused() public view returns (bool) {
        return _coordinators[0].paused;
    }

    /**
     * @notice Returns the paused status of the coordinator `coordinatorId`
     * @param coordinatorId Coordinator to return for
     * @return Paused status of the coordinator
     */
    function paused(uint256 coordinatorId) public view returns (bool) {
        return paused() || _coordinators[coordinatorId].paused;
    }

    /**
     * @notice Returns the paused status of the product `product`
     * @param product Product to return for
     * @return Paused status of the product
     */
    function paused(IProduct product) external view returns (bool) {
        return paused(coordinatorFor[product]);
    }

    /// @dev Only allow owner of `coordinatorId` to call
    modifier onlyOwner(uint256 coordinatorId) {
        if (msg.sender != owner(coordinatorId)) revert ControllerNotOwnerError(coordinatorId);

        _;
    }

    /// @dev Only pauser owner of `coordinatorId` to call
    modifier onlyPauser(uint256 coordinatorId) {
        if (msg.sender != pauser(coordinatorId)) revert ControllerNotPauserError(coordinatorId);

        _;
    }
}
