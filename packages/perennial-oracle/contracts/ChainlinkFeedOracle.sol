// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./interfaces/IOracleProvider.sol";
import "./types/ChainlinkAggregator.sol";

/**
 * @title ChainlinkFeedOracle
 * @notice Chainlink feed implementation of the IOracle interface.
 * @dev One instance per Chainlink price feed should be deployed. Multiple products may use the same
 *      ChainlinkOracle instance if their payoff functions are based on the same underlying oracle.
 */
contract ChainlinkFeedOracle is IOracleProvider {
    error InvalidPhaseInitialization();

    struct Phase {
        uint128 startingVersion;
        uint128 startingRoundId;
    }

    /// @dev Chainlink feed aggregator address
    ChainlinkAggregator public immutable aggregator;

    /// @dev Decimal offset used to normalize chainlink price to 18 decimals
    int256 private immutable _decimalOffset;

    /// @dev Last roundID seen when `sync` was called
    uint256 private _lastSyncedRoundId;

    /// @dev Mapping of the starting data for each underlying phase
    Phase[] private _phases;

    /**
     * @notice Initializes the contract state
     * @param aggregator_ Chainlink price feed aggregator
     * @param phases_ Array of phases to initialize the oracle with
     * @dev If `phases_` is empty, the oracle will be initialized with the latest round from the aggregator as the
     *      starting round
     */
    constructor(ChainlinkAggregator aggregator_, Phase[] memory phases_) {
        aggregator = aggregator_;

        _decimalOffset = SafeCast.toInt256(10 ** aggregator.decimals());

        if (phases_.length > 0) {
            // Phases should be initialized with at least 2 values
            if (phases_.length < 2) revert InvalidPhaseInitialization();

            // Phases[0] should always be empty, since phases are 1-indexed
            if (phases_[0].startingVersion != 0 || phases_[0].startingRoundId != 0) revert InvalidPhaseInitialization();

            // Phases[1] should start at version 0
            if (phases_[1].startingVersion != 0) revert InvalidPhaseInitialization();

            // Set the lastSyncedRoundId to the starting round of the latest phase
            ChainlinkRound memory latestRound = aggregator.getLatestRound();

            // The phases array should be initialized up to the latest phase
            if (phases_.length - 1 != latestRound.phaseId()) revert InvalidPhaseInitialization();

            // Load phases array with the provided phases
            for (uint i = 0; i < phases_.length; i++) {
                _phases.push(phases_[i]);
            }

            _lastSyncedRoundId = latestRound.roundId;
        } else {
            ChainlinkRound memory firstSeenRound = aggregator.getLatestRound();

            // Load the phases array with empty phase values. these phases will be invalid if requested
            while (firstSeenRound.phaseId() > _phases.length) {
                _phases.push(Phase(0, 0));
            }

            // first seen round starts as version 0 at current phase
            _phases.push(Phase(0, uint128(firstSeenRound.roundId)));
            _lastSyncedRoundId = firstSeenRound.roundId;
        }
    }

    /**
     * @notice Checks for a new price and updates the internal phase annotation state accordingly
     * @dev `sync` is expected to be called soon after a phase update occurs in the underlying proxy.
     *      Phase updates should be detected using off-chain mechanism and should trigger a `sync` call
     *      This is feasible in the short term due to how infrequent phase updates are, but phase update
     *      and roundCount detection should eventually be implemented at the contract level.
     *      Reverts if there is more than 1 phase to update in a single sync because we currently cannot
     *      determine the startingRoundId for the intermediary phase.
     * @return The current oracle version after sync
     */
    function sync() external returns (OracleVersion memory) {
        // Fetch latest round
        ChainlinkRound memory round = aggregator.getLatestRound();

        // Revert if the aggregator round id or timestamp is 0 which is an invalid round.
        if (round.aggregatorRoundId() == 0 || round.timestamp == 0) revert InvalidOracleRound();

        // Update phase annotation when new phase detected
        // `_lastSyncedRoundId` is the last round we have seen
        // `round.roundId` is the current round
        //
        // When encountering a new phase, we need to find _lastSyncedRoundId + 1 (N + 1)
        // `getPhaseSwitchoverData` will find the roundCount for the current phase, as well as the phaseId and roundId
        // for the next non-empty phase.
        // There are three cases:
        //  1. N + 1 is in the same phase as `_lastSyncedRoundId`
        //    - `nextPhase` == round.phaseId(), and `nextStartingRoundId` == round.roundId
        //  2. N + 1 is in some phase between _lastSyncedRoundId and the current phase
        //    - `nextPhase` < round.phaseId(), and starts at `nextStartingRoundId`
        //  3. N + 1 is in the current phase
        //   - the `nextPhase` == round.phaseId(), and `nextStartingRoundId` < round.roundId
        //
        // Depending on the returned phase, we need to push empty phases into the phase array
        // Empty phases are pushed between _lastSyncedRoundId.phase and (N + 1).phase
        // and between (N + 1).phase and round.phase
        if (round.phaseId() > _latestPhaseId()) {
            // Get the round count for the lastSyncedRound phase, and the next phase information
            (uint256 phaseRoundCount, uint16 nextPhase, uint256 nextStartingRoundId) =
                aggregator.getPhaseSwitchoverData(_phases[_latestPhaseId()].startingRoundId, _lastSyncedRoundId, round);

            // If the next phase is not immediately after the latestPhase, push empty phases
            // These phases will be invalid if queried
            while (nextPhase > _latestPhaseId() + 1) {
                _phases.push(Phase(_phases[_latestPhaseId()].startingVersion, 0));
            }

            // The starting version for the next phase is the phaseRoundCount plus startingVersion
            _phases.push(
                Phase(
                    uint128(phaseRoundCount) + _phases[_latestPhaseId()].startingVersion,
                    uint128(nextStartingRoundId)
                )
            );

            // If the intermediary phase is not `round`'s phase, fill in the intermediary phases
            if (nextPhase < round.phaseId()) {
                // After the intermediary phase is found, the phases up until round.phaseId can be skipped
                while (round.phaseId() > _latestPhaseId() + 1) {
                    _phases.push(Phase(_phases[_latestPhaseId()].startingVersion, 0));
                }

                // And finally push the current phase
                // We add 1 to the startingVersion for the previous phase because the intermediary phase is only
                // 1 round long
                _phases.push(
                    Phase(
                        1 + _phases[_latestPhaseId()].startingVersion,
                        uint128(round.roundId)
                    )
                );
            }
        }

        _lastSyncedRoundId = round.roundId;

        // Return packaged oracle version
        return _buildOracleVersion(round);
    }

    /**
     * @notice Returns the current oracle version
     * @return oracleVersion Current oracle version
     */
    function currentVersion() public view returns (OracleVersion memory oracleVersion) {
        return _buildOracleVersion(aggregator.getLatestRound());
    }

    /**
     * @notice Returns the current oracle version
     * @param version The version of which to lookup
     * @return oracleVersion Oracle version at version `version`
     */
    function atVersion(uint256 version) public view returns (OracleVersion memory oracleVersion) {
        return _buildOracleVersion(aggregator.getRound(_versionToRoundId(version)), version);
    }

    /**
     * @notice Builds an oracle version object from a Chainlink round object
     * @dev Computes the version for the round
     * @param round Chainlink round to build from
     * @return Built oracle version
     */
    function _buildOracleVersion(ChainlinkRound memory round) private view returns (OracleVersion memory) {
        Phase memory phase = _phases[round.phaseId()];
        uint256 version = uint256(phase.startingVersion) + round.roundId - uint256(phase.startingRoundId);
        return _buildOracleVersion(round, version);
    }

    /**
     * @notice Builds an oracle version object from a Chainlink round object
     * @param round Chainlink round to build from
     * @param version Determined version for the round
     * @return Built oracle version
     */
    function _buildOracleVersion(ChainlinkRound memory round, uint256 version)
    private view returns (OracleVersion memory) {
        Fixed18 price = Fixed18Lib.ratio(round.answer, _decimalOffset);
        return OracleVersion({ version: version, timestamp: round.timestamp, price: price });
    }

    /**
     * @notice Computes the chainlink round ID from a version
     * @param version Version to compute from
     * @return Chainlink round ID
     */
    function _versionToRoundId(uint256 version) private view returns (uint256) {
        Phase memory phase = _versionToPhase(version);
        return uint256(phase.startingRoundId) + version - uint256(phase.startingVersion);
    }

    /**
     * @notice Computes the chainlink phase ID from a version
     * @param version Version to compute from
     * @return phase Chainlink phase
     */
    function _versionToPhase(uint256 version) private view returns (Phase memory phase) {
        uint256 phaseId = _latestPhaseId();
        phase = _phases[phaseId];

        // Exit if the phase is non-empty (startingRoundId != 0) and starts at a version less than or equal to `version`
        while (phase.startingRoundId == 0 || uint256(phase.startingVersion) > version) {
            phaseId--;
            phase = _phases[phaseId];
        }
    }

    /**
     * @notice Returns the latest phase ID that this contract has seen via `sync()`
     * @return Latest seen phase ID
     */
    function _latestPhaseId() private view returns (uint16) {
        return uint16(_phases.length - 1);
    }
}
