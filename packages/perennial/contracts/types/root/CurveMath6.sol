// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./UFixed6.sol";
import "./Fixed6.sol";

/**
 * @title CurveMath6
 * @notice Library for managing math operations for utilization curves.
 */
library CurveMath6 {
    error CurveMath6OutOfBoundsError();

    /**
     * @notice Computes a linear interpolation between two points
     * @param startX First point's x-coordinate
     * @param startY First point's y-coordinate
     * @param endX Second point's x-coordinate
     * @param endY Second point's y-coordinate
     * @param targetX x-coordinate to interpolate
     * @return y-coordinate for `targetX` along the line from (`startX`, `startY`) -> (`endX`, `endY`)
     */
    function linearInterpolation(
        UFixed6 startX,
        Fixed6 startY,
        UFixed6 endX,
        Fixed6 endY,
        UFixed6 targetX
    ) internal pure returns (Fixed6) {
        if (targetX.lt(startX) || targetX.gt(endX)) revert CurveMath6OutOfBoundsError();

        UFixed6 xRange = endX.sub(startX);
        Fixed6 yRange = endY.sub(startY);
        UFixed6 xRatio = targetX.sub(startX).div(xRange);
        return yRange.mul(Fixed6Lib.from(xRatio)).add(startY);
    }
}
