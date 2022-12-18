// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV2V3Interface.sol";
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
    error InvalidVersionRequested(uint256 version);

    /// @dev Chainlink feed aggregator address
    ChainlinkAggregator public immutable aggregator;

    /// @dev Decimal offset used to normalize chainlink price to 18 decimals
    int256 private immutable _decimalOffset;

    /// @dev First valid phase for this Oracle
    uint256 private _firstPhaseId;

    /// @dev Mapping of the starting data for each underlying phase
    Phase[] private _phases;

    struct Phase {
        uint128 startingVersion;
        uint128 startingRoundId;
    }

    /**
     * @notice Initializes the contract state
     * @param aggregator_ Chainlink price feed registry
     */
    constructor(ChainlinkAggregator aggregator_) {
        aggregator = aggregator_;

        // phaseId is 1-indexed, skip index 0
        _phases.push(Phase(uint128(0), uint128(0)));
        // phaseId is 1-indexed, first phase starts as version 0
        _phases.push(Phase(uint128(0), uint128(_aggregatorRoundIdToProxyRoundId(1, 1))));

        _decimalOffset = SafeCast.toInt256(10 ** aggregator.decimals());

        _firstPhaseId = aggregator_.phase();
        // Load the phases array with previous phase values
        while (_firstPhaseId > _latestPhaseId()) {
            _phases.push(Phase(_phases[_phases.length - 1].startingVersion, uint128(0)));
        }
    }

    /**
     * @notice Checks for a new price and updates the internal phase annotation state accordingly
     * @return The current oracle version after sync
     */
    function sync() external returns (OracleVersion memory) {
        // Fetch latest round
        ChainlinkRound memory round = aggregator.getLatestRound();

        // Update phase annotation when new phase detected
        while (round.phaseId() > _latestPhaseId()) {
            _phases.push(
                Phase(
                    uint128(aggregator.getRoundCount(_latestPhaseId(), round.timestamp)) +
                        _phases[_phases.length - 1].startingVersion,
                    uint128(_aggregatorRoundIdToProxyRoundId(_latestPhaseId() + 1, 1))
                )
            );
        }

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
        while (uint256(phase.startingVersion) > version) {
            phaseId--;
            phase = _phases[phaseId];
            if (phaseId < _firstPhaseId) revert InvalidVersionRequested(version);
        }
    }

    /**
     * @notice Returns the latest phase ID that this contract has seen via `sync()`
     * @return Latest seen phase ID
     */
    function _latestPhaseId() private view returns (uint16) {
        return uint16(_phases.length - 1);
    }

    function _aggregatorRoundIdToProxyRoundId(uint16 phaseId, uint80 aggregatorRoundId) private pure returns (uint256) {
        return (uint256(phaseId) << 64) + aggregatorRoundId;
    }
}
