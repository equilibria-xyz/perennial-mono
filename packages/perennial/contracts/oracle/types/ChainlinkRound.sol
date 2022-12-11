// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

/// @dev ChainlinkRound type
struct ChainlinkRound {
    uint256 timestamp;
    int256 answer;
    uint256 roundId;
}
using ChainlinkRoundLib for ChainlinkRound global;

/**
 * @title ChainlinkRoundLib
 * @notice Library that manages Chainlink round parsing.
 */
library ChainlinkRoundLib {
    /// @dev Phase ID offset location in the round ID
    uint256 constant private PHASE_OFFSET = 64;

    /**
     * @notice Computes the chainlink phase ID from a round
     * @param self Round to compute from
     * @return Chainlink phase ID
     */
    function phaseId(ChainlinkRound memory self) internal pure returns (uint256) {
        return self.roundId >> PHASE_OFFSET;
    }
}
