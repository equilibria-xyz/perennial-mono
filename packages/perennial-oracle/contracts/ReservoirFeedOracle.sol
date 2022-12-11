// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@equilibria/perennial/contracts/interfaces/IOracleProvider.sol";
/**
 * @title ReservoirFeedOracle
 * @notice Reservoir implementation of the IOracle interface, using Reservoir's AggregatorV3Interface adaptors
 * @dev This is a naive implementation which pushes all validation to the underlying. No staleness checks are possible
        This oracle should not be used for regular Chainlink Data Feeds
 */
contract ReservoirFeedOracle is IOracleProvider {
    error InvalidOracleVersion();

    /// @dev Chainlink price feed to read from
    AggregatorV3Interface public immutable feed;

    /// @dev Decimal offset used to normalize chainlink price to 18 decimals
    int256 private immutable _decimalOffset;

    /// @dev Which underlying round to consider version 0: version = roundId - _versionOffset
    uint80 private immutable _versionOffset;

    /**
     * @notice Initializes the contract state
     * @param feed_ Reservoir price feed
     * @param versionOffset_ Version offset from source round ID
     */
    constructor(AggregatorV3Interface feed_, uint80 versionOffset_) {
        feed = feed_;
        _versionOffset = versionOffset_;
        _decimalOffset = SafeCast.toInt256(10 ** feed_.decimals());
    }

    /**
     * @notice Checks for a new price. Does not perform staleness validation as the underlying oracle does not
                support this.
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
     * @notice Returns the oracle version specified
     * @dev Converts the passed in version to a roundID by adding _versionOffset
     * @param version The version of which to lookup
     * @return oracleVersion Oracle version at version `version`
     */
    function atVersion(uint256 version) public view returns (OracleVersion memory oracleVersion) {
        // To convert from version to roundId, we add the versionOffset
        uint256 feedRoundID = version + _versionOffset;
        if (feedRoundID > type(uint80).max) revert InvalidOracleVersion();
        (uint80 roundId, int256 feedPrice, , uint256 timestamp,) = feed.getRoundData(uint80(feedRoundID));

        return _buildOracleVersion(roundId, feedPrice, timestamp);
    }

    /**
     * @notice Builds an oracle version object from a Chainlink round object
     * @dev Converts the passed in roundID to a version by subtracting _versionOffset
     * @param roundId ReservoirRoundId round to build from
     * @param feedPrice price returns by the oracle
     * @param timestamp round timestamps
     * @return Built oracle version
     */
    function _buildOracleVersion(uint80 roundId, int256 feedPrice, uint256 timestamp)
    private view returns (OracleVersion memory) {
        Fixed18 price = Fixed18Lib.ratio(feedPrice, _decimalOffset);

        // To convert from roundId to version, we subtract the versionOffset
        return OracleVersion({ version: roundId - _versionOffset, timestamp: timestamp, price: price });
    }
}
