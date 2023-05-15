// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract PassthroughDataFeed {
    AggregatorV3Interface private _underlying;

    struct LatestRoundData {
        uint80 roundId;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    LatestRoundData private _roundOverride;

    constructor(AggregatorV3Interface underlying_) {
        _underlying = underlying_;
    }

    function decimals() external view returns (uint8) {
        return _underlying.decimals();
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        return _underlying.getRoundData(roundId);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (_roundOverride.roundId != 0) return (
            _roundOverride.roundId,
            _roundOverride.answer,
            _roundOverride.startedAt,
            _roundOverride.updatedAt,
            _roundOverride.answeredInRound
        );
        return _underlying.latestRoundData();
    }

    function _setLatestRoundData(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external  {
        _roundOverride = LatestRoundData(
            roundId,
            answer,
            startedAt,
            updatedAt,
            answeredInRound
        );
    }
}
