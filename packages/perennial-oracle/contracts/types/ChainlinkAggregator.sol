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
 * @notice Library that manages interfacing with the Chainlink Feed Registry.
 */
library ChainlinkAggregatorLib {
    /**
     * @notice Returns the decimal amount for a specific feed
     * @param self Chainlink Feed Registry to operate on
     * @return Decimal amount
     */
    function decimals(ChainlinkAggregator self) internal view returns (uint8) {
        return AggregatorProxyInterface(ChainlinkAggregator.unwrap(self)).decimals();
    }

    function phase(ChainlinkAggregator self) internal view returns (uint16) {
        return AggregatorProxyInterface(ChainlinkAggregator.unwrap(self)).phaseId();
    }

    /**
     * @notice Returns the latest round data for a specific feed
     * @param self Chainlink Feed Registry to operate on
     * @return Latest round data
     */
    function getLatestRound(ChainlinkAggregator self) internal view returns (ChainlinkRound memory) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) =
            AggregatorProxyInterface(ChainlinkAggregator.unwrap(self)).latestRoundData();
        return ChainlinkRound({roundId: roundId, timestamp: updatedAt, answer: answer});
    }

    /**
     * @notice Returns a specific round's data for a specific feed
     * @param self Chainlink Feed Registry to operate on
     * @param roundId The specific round to fetch data for
     * @return Specific round's data
     */
    function getRound(ChainlinkAggregator self, uint256 roundId) internal view returns (ChainlinkRound memory) {
        (, int256 answer, , uint256 updatedAt, ) =
            AggregatorProxyInterface(ChainlinkAggregator.unwrap(self)).getRoundData(uint80(roundId));
        return ChainlinkRound({roundId: roundId, timestamp: updatedAt, answer: answer});
    }


    /**
     * @notice Returns the first round ID for a specific phase ID
     * @param self Chainlink Feed Registry to operate on
     * @param phaseId The specific phase to fetch data for
     * @return roundCount The number of rounds in the phase
     */
    function getRoundCount(ChainlinkAggregator self, uint16 phaseId)
    internal view returns (uint256) {
        AggregatorProxyInterface proxy = AggregatorProxyInterface(ChainlinkAggregator.unwrap(self));
        AggregatorV2V3Interface agg = AggregatorV2V3Interface(proxy.phaseAggregators(phaseId));

        (uint80 aggRoundId,,,,) = agg.latestRoundData();
        return aggRoundId + 1;
    }
}
