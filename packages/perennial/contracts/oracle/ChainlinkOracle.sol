// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@chainlink/contracts/src/v0.8/interfaces/FeedRegistryInterface.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interfaces/IOracleProvider.sol";

/**
 * @title ChainlinkOracle
 * @notice Chainlink implementation of the IOracle interface.
 * @dev One instance per Chainlink price feed should be deployed. Multiple products may use the same
 *      ChainlinkOracle instance if their payoff functions are based on the same underlying oracle.
 *      This implementation only support non-negative prices.
 */
contract ChainlinkOracle is IOracleProvider {
    struct ChainlinkRound {
        uint256 roundId;
        uint256 timestamp;
        int256 answer;
    }

    /// @dev Phase ID offset location in the round ID
    uint256 constant private PHASE_OFFSET = 64;

    /// @dev Chainlink registry feed address
    FeedRegistryInterface public immutable registry;

    /// @dev Base token address for the Chainlink oracle
    address public immutable base;

    /// @dev Quote token address for the Chainlink oracle
    address public immutable quote;

    /// @dev Decimal offset used to normalize chainlink price to 6 decimals
    int256 private immutable _decimalOffset;

    /// @dev Mapping of the first oracle version for each underlying phase ID
    Phase[] private _phases;

    struct Phase {
        uint128 startingVersion;
        uint128 startingRoundId;
    }

    /**
     * @notice Initializes the contract state
     * @param registry_ Chainlink price feed registry
     * @param base_ base currency for feed
     * @param quote_ quote currency for feed
     */
    constructor(FeedRegistryInterface registry_, address base_, address quote_) {
        registry = registry_;
        base = base_;
        quote = quote_;

        _phases.push(Phase(uint128(0), uint128(0))); // phaseId is 1-indexed, skip index 0
        _phases.push(Phase(uint128(0), uint128(_getStartingRoundId(1)))); // phaseId is 1-indexed, first phase starts as version 0

        _decimalOffset = SafeCast.toInt256(10 ** registry_.decimals(base_, quote_));
    }

    /**
     * @notice Checks for a new price and updates the internal phase annotation state accordingly
     * @return The current oracle version after sync
     */
    function sync() external returns (OracleVersion memory) {
        // Fetch latest round
        ChainlinkRound memory round = _getLatestRound();

        // Update phase annotation when new phase detected
        while (_phaseId(round) > _latestPhaseId()) {
            _phases.push(
                Phase(
                    uint128(_getRoundCount(_latestPhaseId())) + _phases[_phases.length - 1].startingRoundId,
                    uint128(_getStartingRoundId(_latestPhaseId()))
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
        return _buildOracleVersion(_getLatestRound());
    }

    /**
     * @notice Returns the current oracle version
     * @param version The version of which to lookup
     * @return oracleVersion Oracle version at version `version`
     */
    function atVersion(uint256 version) public view returns (OracleVersion memory oracleVersion) {
        return _buildOracleVersion(_getRound(_versionToRoundId(version)), version);
    }

    /**
     * @notice Builds an oracle version object from a Chainlink round object
     * @dev Computes the version for the round
     * @param round Chainlink round to build from
     * @return Built oracle version
     */
    function _buildOracleVersion(ChainlinkRound memory round) private view returns (OracleVersion memory) {
        Phase memory phase = _phases[_phaseId(round)];
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
        private
        view
        returns (OracleVersion memory)
    {
        Fixed6 price = Fixed6Lib.ratio(round.answer, _decimalOffset);
        return OracleVersion(version, round.timestamp, price);
    }

    /**
     * @notice Computes the chainlink round ID from a version
     * @notice version Version to compute from
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
        }
    }

    /**
     * @notice Returns the latest phase ID that this contract has seen via `sync()`
     * @return Latest seen phase ID
     */
    function _latestPhaseId() private view returns (uint256) {
        return _phases.length - 1;
    }

    /**
     * @notice Returns the latest round data for a specific feed
     * @return Latest round data
     */
    function _getLatestRound() private view returns (ChainlinkRound memory) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) = registry.latestRoundData(base, quote);
        return ChainlinkRound(uint256(roundId), updatedAt, answer);
    }

    /**
     * @notice Returns a specific round's data for a specific feed
     * @param roundId The specific round to fetch data for
     * @return Specific round's data
     */
    function _getRound(uint256 roundId) private view returns (ChainlinkRound memory) {
        (, int256 answer, , uint256 updatedAt, ) = registry.getRoundData(base, quote, uint80(roundId));
        return ChainlinkRound(roundId, updatedAt, answer);
    }

    /**
     * @notice Returns the first round ID for a specific phase ID
     * @param phaseId The specific phase to fetch data for
     * @return startingRoundId The starting round ID for the phase
     */
    function _getStartingRoundId(uint256 phaseId) private view returns (uint256) {
        (uint80 startingRoundId, ) = registry.getPhaseRange(base, quote, uint16(phaseId));
        return uint256(startingRoundId);
    }

    /**
     * @notice Returns the quantity of rounds for a specific phase ID
     * @param phaseId The specific phase to fetch data for
     * @return The quantity of rounds for the phase
     */
    function _getRoundCount(uint256 phaseId) private view returns (uint256) {
        (uint80 startingRoundId, uint80 endingRoundId) = registry.getPhaseRange(base, quote, uint16(phaseId));
        return uint256(endingRoundId) - uint256(startingRoundId) + 1;
    }

    /**
     * @notice Computes the chainlink phase ID from a round
     * @param round Round to compute from
     * @return Chainlink phase ID
     */
    function _phaseId(ChainlinkRound memory round) private pure returns (uint256) {
        return round.roundId >> PHASE_OFFSET;
    }
}
