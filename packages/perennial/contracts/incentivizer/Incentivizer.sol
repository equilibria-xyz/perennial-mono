// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UReentrancyGuard.sol";
import "../interfaces/IIncentivizer.sol";
import "../interfaces/IController.sol";
import "../controller/UControllerProvider.sol";
import "./types/ProductManager.sol";

/**
 * @title Incentivizer
 * @notice Manages logic and state for all incentive programs in the protocol.
 */
contract Incentivizer is IIncentivizer, UInitializable, UControllerProvider, UReentrancyGuard {
    /// @dev Product management state
    mapping(IProduct => ProductManager) private _products;

    /// @dev Fees that have been collected, but remain unclaimed
    mapping(Token18 => UFixed18) public fees;

    /**
     * @notice Initializes the contract state
     * @dev Must be called atomically as part of the upgradeable proxy deployment to
     *      avoid front-running
     * @param controller_ Factory contract address
     */
    function initialize(IController controller_) external initializer(1) {
        __UControllerProvider__initialize(controller_);
        __UReentrancyGuard__initialize();
    }

    /**
     * @notice Creates a new incentive program
     * @dev Must be called as the product or protocol owner
     * @param product The product to create the new program on
     * @param programInfo Parameters for the new program
     * @return programId New program's ID
     */
    function create(IProduct product, ProgramInfo memory programInfo)
    external
    nonReentrant
    isProduct(product)
    notPaused
    onlyOwner(programInfo.coordinatorId)
    returns (uint256 programId) {
        IController _controller = controller();

        // Validate
        if (programInfo.coordinatorId != 0 && programInfo.coordinatorId != _controller.coordinatorFor(product))
            revert IncentivizerNotAllowedError(product);
        if (active(product) >= _controller.programsPerProduct())
            revert IncentivizerTooManyProgramsError();
        ProgramInfoLib.validate(programInfo);

        // Take fee
        UFixed18 programTotal = programInfo.amount.sum();
        UFixed18 programFeeAmount = programInfo.deductFee(_controller.incentivizationFee());
        fees[programInfo.token] = fees[programInfo.token].add(programFeeAmount);

        // Register program
        programId = _products[product].register(programInfo);

        // Charge creator
        programInfo.token.pull(msg.sender, programTotal);

        emit ProgramCreated(
            product,
            programId,
            programInfo,
            programFeeAmount
        );
    }

    /**
     * @notice Completes an in-progress program early
     * @dev Must be called as the program owner
     * @param product Product that the program is running on
     * @param programId Program to complete early
     */
    function complete(IProduct product, uint256 programId)
    external
    nonReentrant
    isProgram(product, programId)
    notPaused
    onlyProgramOwner(product, programId)
    {
        ProductManagerLib.SyncResult memory syncResult = _products[product].complete(product, programId);
        _handleSyncResult(product, syncResult);
    }

    /**
     * @notice Starts and completes programs as they become available
     * @dev Called every settle() from each product
     * @param currentOracleVersion The preloaded current oracle version
     */
    function sync(IOracleProvider.OracleVersion memory currentOracleVersion) external onlyProduct {
        IProduct product = IProduct(msg.sender);

        ProductManagerLib.SyncResult[] memory syncResults = _products[product].sync(product, currentOracleVersion);
        for (uint256 i = 0; i < syncResults.length; i++) {
            _handleSyncResult(product, syncResults[i]);
        }
    }

    /**
     * @notice Handles refunding and event emitting on program start and completion
     * @param product Product that the program is running on
     * @param syncResult The data from the sync event to handle
     */
    function _handleSyncResult(IProduct product, ProductManagerLib.SyncResult memory syncResult) private {
        uint256 programId = syncResult.programId;
        if (syncResult.versionStarted != 0)
            emit ProgramStarted(product, programId, syncResult.versionStarted);
        if (syncResult.versionComplete != 0)
            emit ProgramComplete(product, programId, syncResult.versionComplete);
    }

    /**
     * @notice Settles unsettled balance for `account`
     * @dev Called immediately proceeding a position update in the corresponding product
     * @param account Account to sync
     * @param currentOracleVersion The preloaded current oracle version
     */
    function syncAccount(
        address account,
        IOracleProvider.OracleVersion memory currentOracleVersion
    ) external onlyProduct {
        IProduct product = IProduct(msg.sender);
        _products[product].syncAccount(product, account, currentOracleVersion);
    }

    /**
     * @notice Claims all of `msg.sender`'s rewards for `product` programs
     * @param product Product to claim rewards for
     * @param programIds Programs to claim rewards for
     */
    function claim(IProduct product, uint256[] calldata programIds)
    external
    nonReentrant
    {
        _claimProduct(msg.sender, product, programIds);
    }

    /**
     * @notice Claims all of `account`'s rewards for `product` programs
     * @param account Account to claim rewards for
     * @param product Product to claim rewards for
     * @param programIds Programs to claim rewards for
     */
    function claimFor(address account, IProduct product, uint256[] calldata programIds)
    external
    nonReentrant
    onlyAccountOrMultiInvoker(account)
    {
        _claimProduct(account, product, programIds);
    }

    /**
     * @notice Claims all of `msg.sender`'s rewards for a specific program
     * @param products Products to claim rewards for
     * @param programIds Programs to claim rewards for
     */
    function claim(IProduct[] calldata products, uint256[][] calldata programIds)
    external
    nonReentrant
    {
        if (products.length != programIds.length) revert IncentivizerBatchClaimArgumentMismatchError();
        for (uint256 i; i < products.length; i++) {
            _claimProduct(msg.sender, products[i], programIds[i]);
        }
    }

    /**
     * @notice Claims all of `msg.sender`'s rewards for `product` programs
     * @dev Internal helper with validation checks
     * @param account Account to claim rewards for
     * @param product Product to claim rewards for
     * @param programIds Programs to claim rewards for
     */
    function _claimProduct(address account, IProduct product, uint256[] calldata programIds)
    private
    isProduct(product)
    notPaused
    settleForAccount(account, product)
    {
        for (uint256 i; i < programIds.length; i++) {
            _claimProgram(account, product, programIds[i]);
        }
    }

    /**
     * @notice Claims all of `msg.sender`'s rewards for `programId` on `product`
     * @dev Internal helper with validation checks
     * @param account Account to claim rewards for
     * @param product Product to claim rewards for
     * @param programId Program to claim rewards for
     */
    function _claimProgram(address account, IProduct product, uint256 programId)
    private
    isProgram(product, programId)
    {
        ProductManager storage productManager = _products[product];
        UFixed18 claimAmount = productManager.claim(account, programId);
        productManager.token(programId).push(account, claimAmount);
        emit Claim(product, account, programId, claimAmount);
    }

    /**
     * @notice Claims all `tokens` fees to the protocol treasury
     * @param tokens Tokens to claim fees for
     */
    function claimFee(Token18[] calldata tokens) external notPaused {
        for(uint256 i; i < tokens.length; i++) {
            Token18 token = tokens[i];
            UFixed18 amount = fees[token];

            fees[token] = UFixed18Lib.ZERO;
            token.push(controller().treasury(), amount);

            emit FeeClaim(token, amount);
        }
    }

    /**
     * @notice Returns the quantity of active programs for a given product
     * @param product Product to check for
     * @return Number of active programs
     */
    function active(IProduct product) public view returns (uint256) {
        return _products[product].active();
    }

    /**
     * @notice Returns the quantity of programs for a given product
     * @param product Product to check for
     * @return Number of programs (inactive or active)
     */
    function count(IProduct product) external view returns (uint256) {
        return _products[product].programInfos.length;
    }

    /**
     * @notice Returns program info for program `programId`
     * @param product Product to return for
     * @param programId Program to return for
     * @return Program info
     */
    function programInfos(IProduct product, uint256 programId) external view returns (ProgramInfo memory) {
        return _products[product].programInfos[programId];
    }

    /**
     * @notice Returns `account`'s total unclaimed rewards for a specific program
     * @param product Product to return for
     * @param account Account to return for
     * @param programId Program to return for
     * @return `account`'s total unclaimed rewards for `programId`
     */
    function unclaimed(IProduct product, address account, uint256 programId) external view returns (UFixed18) {
        return _products[product].unclaimed(account, programId);
    }

    /**
     * @notice Returns available rewards for a specific program
     * @param product Product to return for
     * @param programId Program to return for
     * @return Available rewards for `programId`
     */
    function available(IProduct product, uint256 programId) external view returns (UFixed18) {
        return _products[product].programs[programId].available;
    }

    /**
     * @notice Returns the version started for a specific program
     * @param product Product to return for
     * @param programId Program to return for
     * @return The version started for `programId`
     */
    function versionStarted(IProduct product, uint256 programId) external view returns (uint256) {
        return _products[product].programs[programId].versionStarted;
    }

    /**
     * @notice Returns the version completed for a specific program
     * @param product Product to return for
     * @param programId Program to return for
     * @return The version completed for `programId`
     */
    function versionComplete(IProduct product, uint256 programId) external view returns (uint256) {
        return _products[product].programs[programId].versionComplete;
    }

    /**
     * @notice Returns the owner of a specific program
     * @param product Product to return for
     * @param programId Program to return for
     * @return The owner of `programId`
     */
    function owner(IProduct product, uint256 programId) isProgram(product, programId) public view returns (address) {
        return controller().owner(_products[product].programInfos[programId].coordinatorId);
    }

    /**
     * @notice Returns the treasury of a specific program
     * @param product Product to return for
     * @param programId Program to return for
     * @return The treasury of `programId`
     */
    function treasury(IProduct product, uint256 programId) isProgram(product, programId) public view returns (address) {
        return controller().treasury(_products[product].programInfos[programId].coordinatorId);
    }

    /**
     * @notice Returns the treasury of a specific program
     * @param coordinatorId Coordinator to get the treasury for to return for
     * @return The treasury of `programId`
     */
    function treasury(uint256 coordinatorId) public view returns (address) {
        return controller().treasury(coordinatorId);
    }

    /// @dev Helper to fully settle an account's state
    modifier settleForAccount(address account, IProduct product) {
        product.settleAccount(account);

        _;
    }

    /// @dev Only allow the owner of `programId` to call
    modifier onlyProgramOwner(IProduct product, uint256 programId) {
        if (msg.sender != owner(product, programId)) revert IncentivizerNotProgramOwnerError(product, programId);

        _;
    }

    /// @dev Only allow a valid `programId`
    modifier isProgram(IProduct product, uint256 programId) {
        if (!_products[product].valid(programId)) revert IncentivizerInvalidProgramError(product, programId);

        _;
    }
}
