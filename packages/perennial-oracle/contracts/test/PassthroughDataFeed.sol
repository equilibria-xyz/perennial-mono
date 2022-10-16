// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract PassthroughDataFeed {
    AggregatorV3Interface private _underlying;

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
        return _underlying.latestRoundData();
    }
}
