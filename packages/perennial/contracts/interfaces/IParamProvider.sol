// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";

interface IParamProvider {
    event MaintenanceUpdated(UFixed18 newMaintenance);
    event FundingFeeUpdated(UFixed18 newFundingFee);
    event MakerFeeUpdated(UFixed18 newMakerFee);
    event TakerFeeUpdated(UFixed18 newTakerFee);
    event PositionFeeUpdated(UFixed18 newPositionFee);
    event MakerLimitUpdated(UFixed18 newMakerLimit);
    event ClosedUpdated(bool newClosed);
    event JumpRateUtilizationCurveUpdated(
        Fixed18 minRate,
        Fixed18 maxRate,
        Fixed18 targetRate,
        UFixed18 targetUtilization
    );
    
    function parameter() external view returns (UFixed18, UFixed18, UFixed18, UFixed18, UFixed18, UFixed18, bool);
    function updateParameter(
        UFixed18 newMaintenance,
        UFixed18 newFundingFee,
        UFixed18 newMakerFee,
        UFixed18 newTakerFee,
        UFixed18 newPositionFee,
        UFixed18 newMakerLimit,
        bool newClosed
    ) external;
    function utilizationCurve() external view returns (JumpRateUtilizationCurve memory);
    function updateUtilizationCurve(JumpRateUtilizationCurve memory newUtilizationCurve) external;
}
