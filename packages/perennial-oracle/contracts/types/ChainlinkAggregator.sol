// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV2V3Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorProxyInterface.sol";
import "./ChainlinkRound.sol";

/// @dev ChainlinkAggregator type
type ChainlinkAggregator is address;
using ChainlinkAggregatorLib for ChainlinkAggregator global;

/**
 * @title ChainlinkAggregatorLib
 * @notice Library that manages interfacing with the Chainlink Feed Aggregator Proxy.
 */
library ChainlinkAggregatorLib {
    /**
     * @notice Returns the decimal amount for a specific feed
     * @param self Chainlink Feed Aggregator to operate on
     * @return Decimal amount
     */
    function decimals(ChainlinkAggregator self) internal view returns (uint8) {
        return AggregatorProxyInterface(ChainlinkAggregator.unwrap(self)).decimals();
    }

    /**
     * @notice Returns the latest round data for a specific feed
     * @param self Chainlink Feed Aggregator to operate on
     * @return Latest round data
     */
    function getLatestRound(ChainlinkAggregator self) internal view returns (ChainlinkRound memory) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) =
            AggregatorProxyInterface(ChainlinkAggregator.unwrap(self)).latestRoundData();
        return ChainlinkRound({roundId: roundId, timestamp: updatedAt, answer: answer});
    }

    /**
     * @notice Returns a specific round's data for a specific feed
     * @param self Chainlink Feed Aggregator to operate on
     * @param roundId The specific round to fetch data for
     * @return Specific round's data
     */
    function getRound(ChainlinkAggregator self, uint256 roundId) internal view returns (ChainlinkRound memory) {
        (, int256 answer, , uint256 updatedAt, ) =
            AggregatorProxyInterface(ChainlinkAggregator.unwrap(self)).getRoundData(uint80(roundId));
        return ChainlinkRound({roundId: roundId, timestamp: updatedAt, answer: answer});
    }


    /**
     * @notice Returns the round count for the specified phase ID
     * @param self Chainlink Feed Aggregator to operate on
     * @param phaseId The specific phase to fetch data for
     * @param startingRoundId starting roundId for the aggregator proxy
     * @param maxTimestamp maximum timestamp allowed for the last round of the phase
     * @dev Assumes the phase ends at the aggregators latestRound or earlier
     * @return The number of rounds in the phase
     */
    function getRoundCount(ChainlinkAggregator self, uint16 phaseId, uint256 startingRoundId, uint256 maxTimestamp)
    internal view returns (uint256) {
        AggregatorProxyInterface proxy = AggregatorProxyInterface(ChainlinkAggregator.unwrap(self));
        AggregatorV2V3Interface agg = AggregatorV2V3Interface(proxy.phaseAggregators(phaseId));

        (uint80 aggRoundId,,,uint256 updatedAt,) = agg.latestRoundData();

        // If the latest round for the aggregator is after maxTimestamp, walk back until we find the
        // correct round
        while (updatedAt > maxTimestamp) {
            aggRoundId--;
            (,,,updatedAt,) = agg.getRoundData(aggRoundId);
        }

        // Convert the aggregator round to a proxy round
        uint256 latestRoundId = _aggregatorRoundIdToProxyRoundId(phaseId, aggRoundId);
        return uint256(latestRoundId - startingRoundId + 1);
    }

    /**
     * @notice Convert an aggregator round ID into a proxy round ID for the given phase
     * @dev Follows the logic specified in https://docs.chain.link/data-feeds/price-feeds/historical-data#roundid-in-proxy
     * @param phaseId phase ID for the given aggregator round
     * @param aggregatorRoundId round id for the aggregator round
     * @return Proxy roundId
     */
    function _aggregatorRoundIdToProxyRoundId(uint16 phaseId, uint80 aggregatorRoundId) private pure returns (uint256) {
        return (uint256(phaseId) << 64) + aggregatorRoundId;
    }
}
