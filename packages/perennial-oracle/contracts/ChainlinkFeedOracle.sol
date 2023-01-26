// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./interfaces/IOracleProvider.sol";
import "./types/ChainlinkAggregator.sol";

/**
 * @title ChainlinkOracle
 * @notice Chainlink implementation of the IOracle interface.
 * @dev One instance per Chainlink price feed should be deployed. Multiple products may use the same
 *      ChainlinkOracle instance if their payoff functions are based on the same underlying oracle.
 *      This implementation only support non-negative prices.
 */
contract ChainlinkFeedOracle is IOracleProvider {
    error UnableToSyncError();

    /// @dev Chainlink feed aggregator address
    ChainlinkAggregator public immutable aggregator;

    /// @dev Decimal offset used to normalize chainlink price to 18 decimals
    int256 private immutable _decimalOffset;

    /// @dev Mapping of the starting data for each underlying phase
    Phase[] private _phases;

    /// @dev Last roundID seen when `sync` was called
    uint256 private lastSyncedRoundId;

    struct Phase {
        uint128 startingVersion;
        uint128 startingRoundId;
    }

    /**
     * @notice Initializes the contract state
     * @param aggregator_ Chainlink price feed aggregator
     */
    constructor(ChainlinkAggregator aggregator_) {
        aggregator = aggregator_;

        _decimalOffset = SafeCast.toInt256(10 ** aggregator.decimals());

        ChainlinkRound memory firstSeenRound = aggregator.getLatestRound();

        // Load the phases array with empty phase values. these phases will be invalid if requested
        while (firstSeenRound.phaseId() > _phases.length) {
            _phases.push(Phase(uint128(0), uint128(0)));
        }

        // first seen round starts as version 0 at current phase
        _phases.push(Phase(uint128(0), uint128(firstSeenRound.roundId)));
        lastSyncedRoundId = firstSeenRound.roundId;
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

        // Revert if the round id is 0
        if (uint64(round.roundId) == 0) revert InvalidOracleRound();

        // Update phase annotation when new phase detected
        if (round.phaseId() > _latestPhaseId()) {
            // Get the round count for the latest phase
            (uint256 phaseRoundCount, uint256 nextStartingRoundId) = aggregator.getPhaseSwitchoverData(
                _phases[_latestPhaseId()].startingRoundId, lastSyncedRoundId, round);
            uint16 nextPhase = uint16(nextStartingRoundId >> 64);

            // If the next phase is not immediately after the latestPhase, push empty phases
            // These phases will be invalid if queried
            while (nextPhase - 1 > _latestPhaseId()) {
                _phases.push(Phase(_phases[_latestPhaseId()].startingVersion, uint128(0)));
            }

            // The starting version for the next phase is the phaseRoundCount plus startingVersion
            _phases.push(
                Phase(
                    uint128(phaseRoundCount) + _phases[_latestPhaseId()].startingVersion,
                    uint128(nextStartingRoundId)
                )
            );

            // If the intermediary phase is not the the current round's phase, fill in the intermediary phases
            if (nextPhase < round.phaseId()) {
                 // After the intermediary phase is found, the phases up until round.phaseId can be skipped
                while (round.phaseId() - 1 > _latestPhaseId()) {
                    _phases.push(Phase(_phases[_latestPhaseId()].startingVersion, uint128(0)));
                }

                // And finally push the current phase
                _phases.push(
                    Phase(
                        1 + _phases[_latestPhaseId()].startingVersion,
                        uint128(round.roundId)
                    )
                );
            }
        }

        lastSyncedRoundId = round.roundId;

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
