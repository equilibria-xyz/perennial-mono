// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.14;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../interfaces/IOracleProvider.sol";

/**
 * @title ReservoirFeedOracle
 * @notice Reservoir implementation of the IOracle interface, using Reservoir's AggregatorV3Interface adaptors
 * @dev This is a naive implementation which pushes all validation to the underlying. No staleness checks are possible
        This oracle should not be used for regular Chainlink Data Feeds
 */
contract ReservoirFeedOracle is IOracleProvider, UOwnable {
    /// @dev Chainlink price feed to read from
    AggregatorV3Interface public immutable feed;

    /// @dev Decimal offset used to normalize chainlink price to 18 decimals
    int256 private immutable _decimalOffset;

    /**
     * @notice Initializes the contract state
     * @param feed_ Chainlink price feed
     */
    constructor(AggregatorV3Interface feed_) {
        feed = feed_;
        _decimalOffset = SafeCast.toInt256(10 ** feed_.decimals());

        __UOwnable__initialize();
    }

    /**
     * @notice Checks for a new price. Performs no staleness validation as the underlying oracle does not support this.
     * @return The current oracle version after sync
     */
    function sync() external view returns (OracleVersion memory) {
        (uint80 roundId, int256 feedPrice, , uint256 timestamp,) = feed.latestRoundData();

        return _buildOracleVersion(roundId, feedPrice, timestamp);
    }

    /**
     * @notice Returns the current oracle version
     * @return oracleVersion Current oracle version
     */
    function currentVersion() public view returns (OracleVersion memory oracleVersion) {
        (uint80 roundId, int256 feedPrice, , uint256 timestamp,) = feed.latestRoundData();

        return _buildOracleVersion(roundId, feedPrice, timestamp);
    }

    /**
     * @notice Returns the current oracle version
     * @param version The version of which to lookup
     * @return oracleVersion Oracle version at version `version`
     */
    function atVersion(uint256 version) public view returns (OracleVersion memory oracleVersion) {
        require(version <= type(uint80).max, "Invalid Oracle Version");
        uint80 feedVersion = uint80(version) - 1;
        (uint80 roundId, int256 feedPrice, , uint256 timestamp,) = feed.getRoundData(feedVersion);

        return _buildOracleVersion(roundId, feedPrice, timestamp);
    }

    /**
     * @notice Builds an oracle version object from a Chainlink round object
     * @param roundId ReservoirRoundId round to build from
     * @param feedPrice price returns by the oracle
     * @param timestamp round timestamps
     * @return Built oracle version
     */
    function _buildOracleVersion(uint80 roundId, int256 feedPrice, uint256 timestamp)
    private view returns (OracleVersion memory) {
        Fixed18 price = Fixed18Lib.ratio(feedPrice, _decimalOffset);

        // The underlying feed uses 0-indexed rounds, add 1 here to offset that
        return OracleVersion({ version: roundId + 1, timestamp: timestamp, price: price });
    }
}
