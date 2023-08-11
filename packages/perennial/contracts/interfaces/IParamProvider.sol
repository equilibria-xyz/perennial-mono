// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "./types/PendingFeeUpdates.sol";

interface IParamProvider {
    event MaintenanceUpdated(UFixed18 newMaintenance, uint256 version);
    event FundingFeeUpdated(UFixed18 newFundingFee, uint256 version);
    event MakerFeeUpdated(UFixed18 newMakerFee, uint256 version);
    event PendingMakerFeeUpdated(UFixed18 newMakerFee);
    event TakerFeeUpdated(UFixed18 newTakerFee, uint256 version);
    event PendingTakerFeeUpdated(UFixed18 newTakerFee);
    event PositionFeeUpdated(UFixed18 newPositionFee, uint256 version);
    event PendingPositionFeeUpdated(UFixed18 newPositionFee);
    event MakerLimitUpdated(UFixed18 newMakerLimit, uint256 version);
    event UtilizationBufferUpdated(UFixed18 newUtilizationBuffer, uint256 version);
    event JumpRateUtilizationCurveUpdated(
        JumpRateUtilizationCurve,
        uint256 version
    );

    error ParamProviderInvalidParamValue();

    function maintenance() external view returns (UFixed18);
    function updateMaintenance(UFixed18 newMaintenance) external;
    function fundingFee() external view returns (UFixed18);
    function updateFundingFee(UFixed18 newFundingFee) external;
    function makerFee() external view returns (UFixed18);
    function updateMakerFee(UFixed18 newMakerFee) external;
    function takerFee() external view returns (UFixed18);
    function updateTakerFee(UFixed18 newTakerFee) external;
    function positionFee() external view returns (UFixed18);
    function updatePositionFee(UFixed18 newPositionFee) external;
    function makerLimit() external view returns (UFixed18);
    function updateMakerLimit(UFixed18 newMakerLimit) external;
    function utilizationBuffer() external view returns (UFixed18);
    function updateUtilizationBuffer(UFixed18 newUtilizationBuffer) external;
    function utilizationCurve() external view returns (JumpRateUtilizationCurve memory);
    function updateUtilizationCurve(JumpRateUtilizationCurve memory newUtilizationCurve) external;
    function pendingFeeUpdates() external view returns (PendingFeeUpdates memory);
}
