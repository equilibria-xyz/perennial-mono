// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@chainlink/contracts/src/v0.8/interfaces/FeedRegistryInterface.sol";
import "./ChainlinkRound.sol";

/// @dev ChainlinkRegistry type
type ChainlinkRegistry is address;
using ChainlinkRegistryLib for ChainlinkRegistry global;

/**
 * @title ChainlinkRegistryLib
 * @notice Library that manages interfacing with the Chainlink Feed Registry.
 */
library ChainlinkRegistryLib {
    /**
     * @notice Returns the decimal amount for a specific feed
     * @param self Chainlink Feed Registry to operate on
     * @param base Base currency token address
     * @param quote Quote currency token address
     * @return Decimal amount
     */
    function decimals(ChainlinkRegistry self, address base, address quote) internal view returns (uint8) {
        return FeedRegistryInterface(ChainlinkRegistry.unwrap(self)).decimals(base, quote);
    }

    /**
     * @notice Returns the latest round data for a specific feed
     * @param self Chainlink Feed Registry to operate on
     * @param base Base currency token address
     * @param quote Quote currency token address
     * @return Latest round data
     */
    function getLatestRound(ChainlinkRegistry self, address base, address quote) internal view returns (ChainlinkRound memory) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) =
            FeedRegistryInterface(ChainlinkRegistry.unwrap(self)).latestRoundData(base, quote);
        return ChainlinkRound({roundId: roundId, timestamp: updatedAt, answer: answer});
    }

    /**
     * @notice Returns a specific round's data for a specific feed
     * @param self Chainlink Feed Registry to operate on
     * @param base Base currency token address
     * @param quote Quote currency token address
     * @param roundId The specific round to fetch data for
     * @return Specific round's data
     */
    function getRound(ChainlinkRegistry self, address base, address quote, uint256 roundId) internal view returns (ChainlinkRound memory) {
        (, int256 answer, , uint256 updatedAt, ) =
            FeedRegistryInterface(ChainlinkRegistry.unwrap(self)).getRoundData(base, quote, uint80(roundId));
        return ChainlinkRound({roundId: roundId, timestamp: updatedAt, answer: answer});
    }


    /**
     * @notice Returns the first round ID for a specific phase ID
     * @param self Chainlink Feed Registry to operate on
     * @param base Base currency token address
     * @param quote Quote currency token address
     * @param phaseId The specific phase to fetch data for
     * @return startingRoundId The starting round ID for the phase
     */
    function getStartingRoundId(ChainlinkRegistry self, address base, address quote, uint16 phaseId)
    internal view returns (uint80 startingRoundId) {
        (startingRoundId, ) =
            FeedRegistryInterface(ChainlinkRegistry.unwrap(self)).getPhaseRange(base, quote, phaseId);
    }

    /**
     * @notice Returns the quantity of rounds for a specific phase ID
     * @param self Chainlink Feed Registry to operate on
     * @param base Base currency token address
     * @param quote Quote currency token address
     * @param phaseId The specific phase to fetch data for
     * @return The quantity of rounds for the phase
     */
    function getRoundCount(ChainlinkRegistry self, address base, address quote, uint256 phaseId)
    internal view returns (uint256) {
        (uint80 startingRoundId, uint80 endingRoundId) =
            FeedRegistryInterface(ChainlinkRegistry.unwrap(self)).getPhaseRange(base, quote, uint16(phaseId));

        // If the phase has a starting and ending roundId of 0, then there are no rounds.
        // Convert phase rounds to aggregator rounds to check ID
        if (uint64(startingRoundId) == 0 && uint64(endingRoundId) == 0) return 0;
        return uint256(endingRoundId - startingRoundId + 1);
    }
}
