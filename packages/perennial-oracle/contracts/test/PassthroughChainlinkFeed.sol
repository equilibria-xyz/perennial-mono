// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@chainlink/contracts/src/v0.8/interfaces/FeedRegistryInterface.sol";

contract PassthroughChainlinkFeed {
    FeedRegistryInterface private _underlying;

    constructor(FeedRegistryInterface underlying_) {
        _underlying = underlying_;
    }

    function decimals(address base, address quote) external view returns (uint8) {
        return _underlying.decimals(base, quote);
    }

    function getRoundData(address base, address quote, uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        return _underlying.getRoundData(base, quote, roundId);
    }

    function getPhaseRange(address base, address quote, uint16 phaseId) external view returns (uint80, uint80) {
        return _underlying.getPhaseRange(base, quote, phaseId);
    }

    function latestRoundData(address base, address quote) external view returns (uint80, int256, uint256, uint256, uint80) {
        return _underlying.latestRoundData(base, quote);
    }
}
