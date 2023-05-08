// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../../interfaces/IIncentivizer.sol";
import "../../interfaces/types/ProgramInfo.sol";

/// @dev Program type
struct Program {
    /// @dev Mapping of latest rewards settled for each account
    mapping(address => UFixed18) settled;

    /// @dev Total amount of rewards yet to be claimed
    UFixed18 available;

    /// @dev Oracle version that the program started, 0 when hasn't started
    uint256 versionStarted;

    /// @dev Oracle version that the program completed, 0 is still ongoing
    uint256 versionComplete;
}
using ProgramLib for Program global;

/**
 * @title ProgramLib
 * @notice Library that manages all of the mutable state for a single incentivization program.
 */
library ProgramLib {
    /**
     * @notice Initializes the program state
     * @param self The Program to operate on
     * @param programInfo Static program information
     */
    function initialize(Program storage self, ProgramInfo memory programInfo) internal {
        self.available = programInfo.amount.sum();
    }

    /**
     * @notice Starts the program
     * @dev Rewards do not start accruing until the program has started accruing
     *      Does not stop double-starting
     * @param self The Program to operate on
     * @param oracleVersion The effective starting oracle version
     */
    function start(Program storage self, uint256 oracleVersion) internal {
        self.versionStarted = oracleVersion;
    }

    /**
     * @notice Completes the program
     * @dev Completion stops rewards from accruing
     *      Does not prevent double-completion
     * @param self The Program to operate on
     * @param product The Product to operate on
     * @param programInfo Static program information
     * @return versionComplete The version that the program completed on
     */
    function complete(
        Program storage self,
        IProduct product,
        ProgramInfo memory programInfo
    ) internal returns (uint256 versionComplete) {
        uint256 versionStarted = self.versionStarted;
        versionComplete = Math.max(versionStarted, product.latestVersion());
        self.versionComplete = versionComplete;

        IOracleProvider.OracleVersion memory fromOracleVersion = product.atVersion(versionStarted);
        IOracleProvider.OracleVersion memory toOracleVersion = product.atVersion(versionComplete);

        uint256 inactiveDuration = programInfo.duration - (toOracleVersion.timestamp - fromOracleVersion.timestamp);
        UFixed18 refundAmount = programInfo.amount.sum().muldiv(inactiveDuration, programInfo.duration);
        self.available = self.available.sub(refundAmount);
        address treasury = IIncentivizer(address(this)).treasury(programInfo.coordinatorId);
        self.settled[treasury] = self.settled[treasury].add(refundAmount);
    }

    /**
     * @notice Settles unclaimed rewards for account `account`
     * @param self The Program to operate on
     * @param product The Product to operate on
     * @param programInfo Static program information
     * @param account The account to settle for
     * @param currentOracleVersion The preloaded current oracle version
     */
    function settle(
        Program storage self,
        IProduct product,
        ProgramInfo memory programInfo,
        address account,
        IOracleProvider.OracleVersion memory currentOracleVersion
    ) internal {
        UFixed18 unsettledAmount = _unsettled(self, product, programInfo, account, currentOracleVersion);
        self.settled[account] = self.settled[account].add(unsettledAmount);
        self.available = self.available.sub(unsettledAmount);
    }

    /**
     * @notice Claims settled rewards for account `account`
     * @param self The Program to operate on
     * @param account The account to claim for
     */
    function claim(Program storage self, address account) internal returns (UFixed18 claimedAmount) {
        claimedAmount = self.settled[account];
        self.settled[account] = UFixed18Lib.ZERO;
    }

    /**
     * @notice Returns the unsettled amount of unclaimed rewards for account `account`
     * @dev Clears when a program is closed
     *      Assumes that position is unchanged since last settlement, must be settled prior to user position update
     * @param self The Program to operate on
     * @param product The Product to operate on
     * @param programInfo Static program information
     * @param account The account to claim for
     * @param currentOracleVersion Current oracle version
     * @return amount Amount of unsettled rewards for account
     */
    function _unsettled(
        Program storage self,
        IProduct product,
        ProgramInfo memory programInfo,
        address account,
        IOracleProvider.OracleVersion memory currentOracleVersion
    ) private view returns (UFixed18 amount) {
        // program stage overview
        //
        // V = latest user settle version, V' = current user settle version
        // S = versionStarted, E = versionEnded
        //
        // (1) V   V' S           E        program not yet started
        // (2)   V    S     V'    E        use versionStarted -> V' for userShareDelta
        // (3)        S  V     V' E        use V -> V' for userShareDelta
        // (4)        S     V     E   V'   use V -> versionComplete for userShareDelta
        // (5)        S           E V   V' program already completed
        // (6)   V    S           E   V'   use versionStarted -> versionComplete for userShareDelta
        //
        // NOTE: V == S and V' == E both default to the inner case

        (uint256 _versionStarted, uint256 _versionComplete) = (
            self.versionStarted == 0 ? currentOracleVersion.version : self.versionStarted, // start must be no earlier than current version
            self.versionComplete == 0 ? type(uint256).max : self.versionComplete           // we don't know when completion occurs
        );

        // accruing must start between self.versionStarted and self.versionComplete
        uint256 fromVersion = Math.min(_versionComplete, Math.max(_versionStarted, product.latestVersion(account)));
        // accruing must complete between self.versionStarted and self.versionComplete, we know self.versionStarted must be no earlier than current version
        uint256 toVersion = Math.min(_versionComplete, currentOracleVersion.version);

        Accumulator memory globalShareDelta = product.shareAtVersion(toVersion).sub(product.shareAtVersion(fromVersion));
        Accumulator memory computedUserShareDelta = product.position(account).mul(globalShareDelta);
        amount = UFixed18Lib.from(programInfo.amountPerShare().mul(computedUserShareDelta).sum());
    }
}
