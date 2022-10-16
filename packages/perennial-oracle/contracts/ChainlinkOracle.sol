// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@chainlink/contracts/src/v0.8/interfaces/FeedRegistryInterface.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./interfaces/IOracleProvider.sol";
import "./types/ChainlinkRegistry.sol";

/**
 * @title ChainlinkOracle
 * @notice Chainlink implementation of the IOracle interface.
 * @dev One instance per Chainlink price feed should be deployed. Multiple products may use the same
 *      ChainlinkOracle instance if their payoff functions are based on the same underlying oracle.
 *      This implementation only support non-negative prices.
 */
contract ChainlinkOracle is IOracleProvider {
    /// @dev Chainlink registry feed address
    ChainlinkRegistry public immutable registry;

    /// @dev Base token address for the Chainlink oracle
    address public immutable base;

    /// @dev Quote token address for the Chainlink oracle
    address public immutable quote;

    /// @dev Decimal offset used to normalize chainlink price to 18 decimals
    int256 private immutable _decimalOffset;

    /// @dev Mapping of the first oracle version for each underlying phase ID
    uint256[] private _startingVersionForPhaseId;

    /**
     * @notice Initializes the contract state
     * @param registry_ Chainlink price feed registry
     * @param base_ base currency for feed
     * @param quote_ quote currency for feed
     */
    constructor(ChainlinkRegistry registry_, address base_, address quote_) {
        registry = registry_;
        base = base_;
        quote = quote_;

        _startingVersionForPhaseId.push(0); // phaseId is 1-indexed, skip index 0
        _startingVersionForPhaseId.push(0); // phaseId is 1-indexed, first phase starts as version 0
        _decimalOffset = SafeCast.toInt256(10 ** registry_.decimals(base, quote));
    }

    /**
     * @notice Checks for a new price and updates the internal phase annotation state accordingly
     * @return The current oracle version after sync
     */
    function sync() external returns (OracleVersion memory) {
        // Fetch latest round
        ChainlinkRound memory round = registry.getLatestRound(base, quote);

        // Update phase annotation when new phase detected
        while (round.phaseId() > _latestPhaseId()) {
            uint256 roundCount = registry.getRoundCount(base, quote, _latestPhaseId());
            _startingVersionForPhaseId.push(roundCount);
        }

        // Return packaged oracle version
        return _buildOracleVersion(round);
    }

    /**
     * @notice Returns the current oracle version
     * @return oracleVersion Current oracle version
     */
    function currentVersion() public view returns (OracleVersion memory oracleVersion) {
        return _buildOracleVersion(registry.getLatestRound(base, quote));
    }

    /**
     * @notice Returns the current oracle version
     * @param version The version of which to lookup
     * @return oracleVersion Oracle version at version `version`
     */
    function atVersion(uint256 version) public view returns (OracleVersion memory oracleVersion) {
        return _buildOracleVersion(registry.getRound(base, quote, _versionToRoundId(version)), version);
    }

    /**
     * @notice Builds an oracle version object from a Chainlink round object
     * @dev Computes the version for the round
     * @param round Chainlink round to build from
     * @return Built oracle version
     */
    function _buildOracleVersion(ChainlinkRound memory round) private view returns (OracleVersion memory) {
        uint256 version = _startingVersionForPhaseId[round.phaseId()] +
            uint256(round.roundId - registry.getStartingRoundId(base, quote, round.phaseId()));
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
     * @notice version Version to compute from
     * @return Chainlink round ID
     */
    function _versionToRoundId(uint256 version) private view returns (uint80) {
        uint16 phaseId = _versionToPhaseId(version);
        return registry.getStartingRoundId(base, quote, phaseId) +
            uint80(version - _startingVersionForPhaseId[phaseId]);
    }

    /**
     * @notice Computes the chainlink phase ID from a version
     * @param version Version to compute from
     * @return phaseId Chainlink phase ID
     */
    function _versionToPhaseId(uint256 version) private view returns (uint16 phaseId) {
        phaseId = _latestPhaseId();
        while (_startingVersionForPhaseId[phaseId] > version) {
            phaseId--;
        }
    }

    /**
     * @notice Returns the latest phase ID that this contract has seen via `sync()`
     * @return Latest seen phase ID
     */
    function _latestPhaseId() private view returns (uint16) {
        return uint16(_startingVersionForPhaseId.length - 1);
    }
}
