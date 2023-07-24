// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./Program.sol";

/// @dev ProductManager type
struct ProductManager {
    /// @dev Static program state
    ProgramInfo[] programInfos;

    /// @dev Dynamic program state
    mapping(uint256 => Program) programs;

    /// @dev Mapping of all active programs for each product
    EnumerableSet.UintSet activePrograms;

    /// @dev Mapping of all active programs for each user
    mapping(address => EnumerableSet.UintSet) activeProgramsFor;

    /// @dev Mapping of the next program to watch for for each user
    mapping(address => uint256) nextProgramFor;
}
using ProductManagerLib for ProductManager global;

/**
 * @title ProductManagerLib
 * @notice Library that manages each product's incentivization state and logic.
 */
library ProductManagerLib {
    using EnumerableSet for EnumerableSet.UintSet;

    /// @dev Result data for a sync event
    struct SyncResult {
        /// @dev The programId that was updated
        uint256 programId;

        /// @dev If non-zero, the new versionStart value of the program
        uint256 versionStarted;

        /// @dev If non-zero, the new versionComplete value of the program
        uint256 versionComplete;
    }

    /**
     * @notice Registers a new program on this product
     * @param self The Product manager to operate on
     * @param programInfo The static program info
     * @return programId The new program's ID
     */
    function register(
        ProductManager storage self,
        ProgramInfo memory programInfo
    ) internal returns (uint256 programId) {
        programId = self.programInfos.length;
        self.programInfos.push(programInfo);
        self.programs[programId].initialize(programInfo);
        self.activePrograms.add(programId);
    }

    /**
     * @notice Syncs this product with the latest data
     * @param self The Program manager to operate on
     * @param product This Product
     * @param currentOracleVersion The preloaded current oracle version
     */
    function sync(
        ProductManager storage self,
        IProduct product,
        IOracleProvider.OracleVersion memory currentOracleVersion
    ) internal returns (SyncResult[] memory results) {

        uint256[] memory activeProgramIds = self.activePrograms.values();
        results = new SyncResult[](activeProgramIds.length);

        for (uint256 i; i < activeProgramIds.length; i++) {
            // Load program
            uint256 programId = activeProgramIds[i];
            ProgramInfo memory programInfo = self.programInfos[programId];
            Program storage program = self.programs[programId];

            // If timestamp-started, grab current version (first version after start)
            uint256 versionStarted;
            if (program.versionStarted == 0 && programInfo.isStarted(currentOracleVersion.timestamp)) {
                versionStarted = _start(self, programId, currentOracleVersion);
            }

            // If timestamp-completed, grab previous version (last version before completion)
            uint256 versionComplete;
            if (program.versionComplete == 0 && programInfo.isComplete(currentOracleVersion.timestamp)) {
                versionComplete = _complete(self, product, programId);
            }

            // Save result
            results[i] = SyncResult(programId, versionStarted, versionComplete);
        }
    }

    /**
     * @notice Syncs an account for this product with the latest data
     * @dev Assumes that sync() has already been called as part of the transaction flow
     * @param self The Program manager to operate on
     * @param product This Product
     * @param account The account to sync
     * @param currentOracleVersion The preloaded current oracle version
     */
    function syncAccount(
        ProductManager storage self,
        IProduct product,
        address account,
        IOracleProvider.OracleVersion memory currentOracleVersion
    ) internal {

        // Add any unseen programs
        uint256 fromProgramId = self.nextProgramFor[account];
        uint256 toProgramId = self.programInfos.length;
        for (uint256 programId = fromProgramId; programId < toProgramId; programId++) {
            self.activeProgramsFor[account].add(programId);
        }
        self.nextProgramFor[account] = toProgramId;

        // Settle programs
        uint256[] memory activeProgramIds = self.activeProgramsFor[account].values();
        for (uint256 i; i < activeProgramIds.length; i++) {
            uint256 programId = activeProgramIds[i];
            Program storage program = self.programs[programId];
            program.settle(product, self.programInfos[programId], account, currentOracleVersion);
            if (!self.activePrograms.contains(programId) && currentOracleVersion.version >= program.versionComplete) {
                self.activeProgramsFor[account].remove(programId);
            }
        }
    }

    /**
     * @notice Returns the quantity of active programs for this product
     * @param self The Program manager to operate on
     * @return The quantity of active programs
     */
    function active(ProductManager storage self) internal view returns (uint256) {
        return self.activePrograms.length();
    }

    /**
     * @notice Forces the specified program to complete if it hasn't already
     * @param self The Program manager to operate on
     * @param product The Product to operate on
     * @param programId The Program to complete
     * @return result The sync result data from completion
     */
    function complete(
        ProductManager storage self,
        IProduct product,
        uint256 programId
    ) internal returns (SyncResult memory result) {
        Program storage program = self.programs[programId];

        // If not started, start first
        if (program.versionStarted == 0) {
            result.versionStarted = _start(self, programId, product.currentVersion());
        }

        // If not completed already, complete
        if (program.versionComplete == 0) {
            result.versionComplete = _complete(self, product, programId);
        }
    }

    /**
     * @notice Starts the program
     * @dev Rewards do not start accruing until the program has started
     *      Internal helper, does not prevent incorrectly-timed starting
     * @param self The Program manager to operate on
     * @param programId The Program to start
     * @param currentOracleVersion The effective starting oracle version
     * @return versionStarted The version that the program started
     */
    function _start(
        ProductManager storage self,
        uint256 programId,
        IOracleProvider.OracleVersion memory currentOracleVersion
    ) internal returns (uint256 versionStarted) {
        versionStarted = currentOracleVersion.version;
        self.programs[programId].start(currentOracleVersion.version);
    }

    /**
     * @notice Completes the program
     * @dev Completion stops rewards from accruing
     *      Internal helper, does not prevent incorrectly-timed completion
     * @param self The Program manager to operate on
     * @param product The Product to operate on
     * @param programId The Program to complete
     * @return versionComplete The version that the program complete
     */
    function _complete(
        ProductManager storage self,
        IProduct product,
        uint256 programId
    ) internal returns (uint256 versionComplete) {
        versionComplete = self.programs[programId].complete(product, self.programInfos[programId]);
        self.activePrograms.remove(programId);
    }

    /**
     * @notice Claims all of `account`'s rewards for a specific program
     * @param self The Program manager to operate on
     * @param account Account to claim rewards for
     * @param programId Program to claim rewards for
     * @return Amount claimed
     */
    function claim(ProductManager storage self, address account, uint256 programId) internal returns (UFixed18) {
        return self.programs[programId].claim(account);
    }

    /**
     * @notice Returns the total amount of unclaimed rewards for account `account`
     * @param self The Program manager to operate on
     * @param account The account to check for
     * @param programId The Program to check for
     * @return Total amount of unclaimed rewards for account
     */
    function unclaimed(ProductManager storage self, address account, uint256 programId) internal view returns (UFixed18) {
        if (!valid(self, programId)) return (UFixed18Lib.ZERO);
        return self.programs[programId].settled[account];
    }

    /**
     * @notice Returns the token denominatino of the program's rewards
     * @param self The Program manager to operate on
     * @param programId The Program to check for
     * @return The token for the program
     */
    function token(ProductManager storage self, uint256 programId) internal view returns (Token18) {
        return self.programInfos[programId].token;
    }

    /**
     * @notice Returns whether the supplied programId is valid
     * @param self The Program manager to operate on
     * @param programId The Program to check for
     * @return Whether the supplied programId is valid
     */
    function valid(ProductManager storage self, uint256 programId) internal view returns (bool) {
        return programId < self.programInfos.length;
    }
}
