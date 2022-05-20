// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.13;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/types/Position.sol";
import "../interfaces/types/Accumulator.sol";
import "../interfaces/IIncentivizer.sol";
import "../interfaces/IController.sol";
import "../controller/UControllerProvider.sol";
import "./types/Program.sol";

contract Incentivizer is IIncentivizer, UInitializable, UControllerProvider, UReentrancyGuard {
    using EnumerableSet for EnumerableSet.UintSet;

    /// @dev Static program state
    ProgramInfo[] private _programInfos;

    /// @dev Dynamic program state
    mapping(uint256 => Program) private _programs;

    /// @dev Mapping of all programs for each product
    mapping(IProduct => EnumerableSet.UintSet) private _registry;

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
     * @param info Parameters for the new program
     * @return new program's ID
     */
    function create(ProgramInfo calldata info)
    external
    nonReentrant
    notPausedProduct(info.product)
    isProduct(info.product)
    returns (uint256) {
        IController _controller = controller();
        bool protocolOwned = msg.sender == _controller.owner();

        if (programsForLength(info.product) >= _controller.programsPerProduct()) revert IncentivizerTooManyProgramsError();
        if (!protocolOwned && msg.sender != _controller.owner(info.product))
            revert NotProductOwnerError(info.product);

        uint256 programId = _programInfos.length;
        UFixed18 incentivizationFee = _controller.incentivizationFee();
        (ProgramInfo memory programInfo, UFixed18 programFee) = ProgramInfoLib.create(incentivizationFee, info);

        _programInfos.push(programInfo);
        _programs[programId].initialize(programInfo, protocolOwned);
        _registry[info.product].add(programId);
        fees[info.token] = fees[info.token].add(programFee);

        info.token.pull(msg.sender, info.amount.sum());

        emit ProgramCreated(
            programId,
            programInfo.product,
            programInfo.token,
            programInfo.amount.maker,
            programInfo.amount.taker,
            programInfo.start,
            programInfo.duration,
            programInfo.grace,
            programFee
        );

        return programId;
    }

    /**
     * @notice Completes an in-progress program early
     * @dev Must be called as the program owner
     * @param programId Program to end
     */
    function end(uint256 programId)
    external
    nonReentrant
    validProgram(programId)
    notPausedProgram(programId)
    onlyProgramOwner(programId)
    {
        completeInternal(programId);
    }

    /**
     * @notice Closes a program, returning all unclaimed rewards
     * @param programId Program to end
     */
    function close(uint256 programId)
    external
    nonReentrant
    validProgram(programId)
    notPausedProgram(programId)
    {
        Program storage program = _programs[programId];
        ProgramInfo storage programInfo = _programInfos[programId];

        if (!program.canClose(programInfo, block.timestamp)) revert IncentivizerProgramNotClosableError();

        // complete if not yet completed
        if (program.versionComplete == 0) {
            completeInternal(programId);
        }

        // close
        UFixed18 amountToReturn = _programs[programId].close();
        programInfo.token.push(treasury(programId), amountToReturn);
        _registry[programInfo.product].remove(programId);

        emit ProgramClosed(programId, amountToReturn);
    }

    /**
     * @notice Completes any in-progress programs that newly completable
     * @dev Called every settle() from each product
     */
    function sync(IOracleProvider.OracleVersion memory currentOracleVersion) external onlyProduct {
        IProduct product = IProduct(msg.sender);
        uint256 programCount = programsForLength(product);

        for (uint256 i; i < programCount; i++) {
            uint256 programId = programsForAt(product, i);

            if (_programs[programId].versionComplete != 0) continue;
            if (!_programInfos[programId].isComplete(currentOracleVersion.timestamp)) continue;

            completeInternal(programId);
        }
    }

    /**
     * @notice Completes a program
     * @dev Internal helper
     * @param programId Program to complete
     */
    function completeInternal(uint256 programId) private {
        uint256 version = _programInfos[programId].product.latestVersion();
        _programs[programId].complete(version);

        emit ProgramCompleted(programId, version);
    }

    /**
     * @notice Settles unsettled balance for `account`
     * @dev Called immediately proceeding a position update in the corresponding product
     * @param account Account to sync
     * @param userShareDelta User's change in share
     * @param currentOracleVersion Current oracle version
     */
    function syncAccount(
        address account,
        Accumulator memory userShareDelta,
        IOracleProvider.OracleVersion memory currentOracleVersion
    ) external onlyProduct {
        IProduct product = IProduct(msg.sender);

        uint256 programCount = programsForLength(product);

        for (uint256 i; i < programCount; i++) {
            uint256 programId = programsForAt(product, i);
            _programs[programId].settle(_programInfos[programId], account, userShareDelta, currentOracleVersion);
        }
    }

    /**
     * @notice Claims all of `msg.sender`'s rewards for `product` programs
     * @param product Product to claim rewards for
     */
    function claim(IProduct product) external nonReentrant notPausedProduct(product) isProduct(product) {
        // settle product markets
        product.settle();
        product.settleAccount(msg.sender);

        // claim
        uint256 programCount = programsForLength(product);
        for (uint256 i; i < programCount; i++) {
            claimInternal(msg.sender, programsForAt(product, i));
        }
    }

    /**
     * @notice Claims all of `msg.sender`'s rewards for a specific program
     * @param programId Program to claim rewards for
     */
    function claim(uint256 programId) external nonReentrant validProgram(programId) notPausedProgram(programId) {
        IProduct product = _programInfos[programId].product;

        // settle product markets
        product.settle();
        product.settleAccount(msg.sender);

        // claim
        claimInternal(msg.sender, programId);
    }

    /**
     * @notice Claims all of `account`'s rewards for a specific program
     * @dev Internal helper, assumes account has already been product-settled prior to calling
     * @param account Account to claim rewards for
     * @param programId Program to claim rewards for
     */
    function claimInternal(address account, uint256 programId) private {
        Program storage program = _programs[programId];
        ProgramInfo memory programInfo = _programInfos[programId];

        // program.settle(programInfo, account);
        UFixed18 claimedAmount = program.claim(account);

        programInfo.token.push(account, claimedAmount);

        emit Claim(account, programId, claimedAmount);
    }

    /**
     * @notice Claims all `tokens` fees to the protocol treasury
     * @param tokens Tokens to claim fees for
     */
    function claimFee(Token18[] calldata tokens) external notPaused {
        for(uint256 i; i < tokens.length; i++) {
            Token18 token = tokens[i];
            UFixed18 amount = fees[token];
            if (amount.isZero()) continue;

            fees[token] = UFixed18Lib.ZERO;
            token.push(controller().treasury(), amount);

            emit FeeClaim(token, amount);
        }
    }

    /**
     * @notice Returns program info for program `programId`
     * @param programId Program to return for
     * @return Program info
     */
    function programInfos(uint256 programId) external view returns (ProgramInfo memory) {
        return _programInfos[programId];
    }

    /**
     * @notice Returns `account`'s total unclaimed rewards for a specific program
     * @param account Account to return for
     * @param programId Program to return for
     * @return `account`'s total unclaimed rewards for `programId`
     */
    function unclaimed(address account, uint256 programId) external view returns (UFixed18) {
        if (programId >= _programInfos.length) return (UFixed18Lib.ZERO);

        return _programs[programId].unclaimed(account);
    }

    /**
     * @notice Returns `account`'s latest synced version for a specific program
     * @param account Account to return for
     * @param programId Program to return for
     * @return `account`'s latest synced version for `programId`
     */
    function latestVersion(address account, uint256 programId) external view returns (uint256) {
        return _programs[programId].latestVersion[account];
    }

    /**
     * @notice Returns `account`'s settled rewards for a specific program
     * @param account Account to return for
     * @param programId Program to return for
     * @return `account`'s settled rewards for `programId`
     */
    function settled(address account, uint256 programId) external view returns (UFixed18) {
        return _programs[programId].settled[account];
    }

    /**
     * @notice Returns available rewards for a specific program
     * @param programId Program to return for
     * @return Available rewards for `programId`
     */
    function available(uint256 programId) external view returns (UFixed18) {
        return _programs[programId].available;
    }

    /**
     * @notice Returns the version completed for a specific program
     * @param programId Program to return for
     * @return The version completed for `programId`
     */
    function versionComplete(uint256 programId) external view returns (uint256) {
        return _programs[programId].versionComplete;
    }

    /**
     * @notice Returns whether closed for a specific program
     * @param programId Program to return for
     * @return whether closed for `programId`
     */
    function closed(uint256 programId) external view returns (bool) {
        return _programs[programId].closed;
    }

    /**
     * @notice Returns quantity of programs for a specific product
     * @param product Product to return for
     * @return Quantity of programs for `product`
     */
    function programsForLength(IProduct product) public view returns (uint256) {
        return _registry[product].length();
    }

    /**
     * @notice Returns the program at index `index` for a specific product
     * @param product Product to return for
     * @param index Index to return for
     * @return The program at index `index` for `product`
     */
    function programsForAt(IProduct product, uint256 index) public view returns (uint256) {
        return _registry[product].at(index);
    }

    /**
     * @notice Returns the owner of a specific program
     * @param programId Program to return for
     * @return The owner of `programId`
     */
    function owner(uint256 programId) public view returns (address) {
        Program storage program = _programs[programId];
        ProgramInfo storage programInfo = _programInfos[programId];
        return program.protocolOwned ? controller().owner() : controller().owner(programInfo.product);
    }

    /**
     * @notice Returns the treasury of a specific program
     * @param programId Program to return for
     * @return The treasury of `programId`
     */
    function treasury(uint256 programId) public view returns (address) {
        Program storage program = _programs[programId];
        ProgramInfo storage programInfo = _programInfos[programId];
        return program.protocolOwned ? controller().treasury() : controller().treasury(programInfo.product);
    }

    /**
     * @notice Returns the paused status of a specific program
     * @param programId Program to return for
     * @return The paused status of `programId`
     */
    function paused(uint256 programId) public view returns (bool) {
        return controller().paused(_programInfos[programId].product);
    }

    /// @dev Only allow the owner of `programId` to call
    modifier onlyProgramOwner(uint256 programId) {
        if (msg.sender != owner(programId)) revert IncentivizerNotProgramOwnerError(programId);

        _;
    }

    /// @dev Only allow when `programId` is not paused
    modifier notPausedProgram(uint256 programId) {
        if (paused(programId)) revert IncentivizerProgramPausedError(programId);

        _;
    }

    /// @dev Only allow a valid `programId`
    modifier validProgram(uint256 programId) {
        if (programId >= _programInfos.length) revert IncentivizerInvalidProgramError(programId);

        _;
    }
}
