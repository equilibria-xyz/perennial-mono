// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV2V3Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorProxyInterface.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
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
     * @notice Returns the round count and next phase starting round for the lastSyncedRound phase
     * @param self Chainlink Feed Aggregator to operate on
     * @param startingRoundId starting roundId for the aggregator proxy
     * @param lastSyncedRoundId last synced round ID for the proxy
     * @param latestRound latest round from the proxy
     * @return roundCount The number of rounds in the phase
     * @return nextPhaseId The phaseID for the next phase
     * @return nextPhaseStartingRoundId The starting round ID for the next phase
     */
    function getPhaseSwitchoverData(
        ChainlinkAggregator self,
        uint256 startingRoundId,
        uint256 lastSyncedRoundId,
        ChainlinkRound memory latestRound
    ) internal view returns (uint256 roundCount, uint16 nextPhaseId, uint256 nextPhaseStartingRoundId) {
        AggregatorProxyInterface proxy = AggregatorProxyInterface(ChainlinkAggregator.unwrap(self));

        // Try to get the immediate next round in the same phase. If this errors, we know that the phase has ended
        try proxy.getRoundData(uint80(lastSyncedRoundId + 1)) returns (uint80 nextRoundId,int256,uint256,uint256 nextUpdatedAt,uint80) {
            // If the next round in this phase is before the latest round, then we can safely mark that
            // as the end of the phase, and the latestRound as the start of the new phase
            // Else the next round in this phase is _after_ the latest round, then we
            // fallthrough to search for the next starting round ID using the walkback logic
            if (nextRoundId == 0 || nextUpdatedAt == 0) { // Invalid round
                // pass
            } else if (nextUpdatedAt < latestRound.timestamp) {
                return ((nextRoundId - startingRoundId) + 1, latestRound.phaseId(), latestRound.roundId);
            }
        } catch  {
            // pass
        }

        // lastSyncedRound is the last round in it's phase before latestRound, so we need to find where the next phase starts
        // The next phase should start at the round that is closest to but after lastSyncedRound.timestamp
        ChainlinkRound memory lastSyncedRound = getRound(self, lastSyncedRoundId);
        uint16 phaseToSearch = lastSyncedRound.phaseId();
        while (nextPhaseStartingRoundId == 0) {
            phaseToSearch++;
            nextPhaseStartingRoundId = getStartingRoundId(self, phaseToSearch, lastSyncedRound.timestamp);
        }

        return ((lastSyncedRoundId - startingRoundId) + 1, phaseToSearch, nextPhaseStartingRoundId);
    }

    /**
     * @notice Returns the round ID closest to but greater than targetTimestamp for the specified phase ID
     * @param self Chainlink Feed Aggregator to operate on
     * @param phaseId The specific phase to fetch data for
     * @param targetTimestamp timestamp to search for
     * @dev Assumes the phase ends at the aggregators latestRound or earlier
     * @return The number of rounds in the phase
     */
    function getStartingRoundId(ChainlinkAggregator self, uint16 phaseId, uint256 targetTimestamp)
    internal view returns (uint256) {
        AggregatorProxyInterface proxy = AggregatorProxyInterface(ChainlinkAggregator.unwrap(self));

        (,,,uint256 startTimestamp,) = proxy.getRoundData(uint80(_aggregatorRoundIdToProxyRoundId(phaseId, 1)));
        if (startTimestamp == 0) return 0; // Empty phase

        return _search(proxy, phaseId, targetTimestamp, startTimestamp, 1);
    }

    /**
     * Searches the given chainlink proxy for a round which has a timestamp which is as close to but greater than
     * the `targetTimestamp`
     * @param proxy Chainlink Proxy to search within
     * @param phaseId Phase to search for round
     * @param targetTimestamp Minimum timestamp value for found round
     * @param minTimestamp Starting timestamp value
     * @param minRoundId Starting round ID
     */
    function _search(AggregatorProxyInterface proxy, uint16 phaseId, uint256 targetTimestamp, uint256 minTimestamp, uint256 minRoundId) private view returns (uint256) {
        uint256 maxRoundId = minRoundId + 1000; // Start 1000 rounds away when searching for maximum
        uint256 maxTimestamp = _tryGetProxyRoundData(proxy, phaseId, uint80(maxRoundId));

        // Find the round bounds of the phase to perform the binary search
        while (maxTimestamp <= targetTimestamp) {
            minRoundId = maxRoundId;
            minTimestamp = maxTimestamp;
            maxRoundId = maxRoundId * 2; // Find bounds of phase by multiplying the max round by 2
            maxTimestamp = _tryGetProxyRoundData(proxy, phaseId, uint80(maxRoundId));
        }

        // Binary Search starts here. The algorithm calculates the middle round ID and finds it's timestamp
        // If the midtimestamp is greater than target, set max to mid and continue
        // If the midtimestamp is less than or equal to target, set min to mid and continue
        // Exit when min + 1 is equal to or greater than max (no rounds between them)
        while (minRoundId + 1 < maxRoundId) {
            uint256 midRound = Math.average(minRoundId, maxRoundId);
            uint256 midTimestamp = _tryGetProxyRoundData(proxy, phaseId, uint80(midRound));
            if (midTimestamp > targetTimestamp) {
                maxTimestamp = midTimestamp;
                maxRoundId = midRound;
            } else {
                minTimestamp = midTimestamp;
                minRoundId = midRound;
            }
        }

        // If the found timestamp is not greater than target timestamp or no max was found, then the desired round does
        // not exist in this phase
        if (maxTimestamp <= targetTimestamp || maxTimestamp == type(uint256).max) return 0;

        return _aggregatorRoundIdToProxyRoundId(phaseId, uint80(maxRoundId));
    }

    function _tryGetProxyRoundData(AggregatorProxyInterface proxy, uint16 phaseId, uint80 tryRound) private view returns (uint256) {
        try proxy.getRoundData(uint80(_aggregatorRoundIdToProxyRoundId(phaseId, tryRound))) returns (uint80,int256,uint256,uint256 timestamp,uint80) {
            if (timestamp > 0) return timestamp;
        } catch  {
            // pass
        }
        return type(uint256).max;
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
