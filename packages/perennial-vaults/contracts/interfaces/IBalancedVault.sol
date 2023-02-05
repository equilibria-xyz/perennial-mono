//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC4626Upgradeable.sol";
import "@equilibria/perennial/contracts/interfaces/IController.sol";
import "@equilibria/root/number/types/UFixed18.sol";

interface IBalancedVault {
    event PositionUpdated(UFixed18 targetPosition);
    event CollateralUpdated(IProduct product, UFixed18 targetCollateral);

    error BalancedVaultDepositMoreThanMax();
    error BalancedVaultPrepareWithdrawMoreThanBalance();
    error BalancedVaultWithdrawMoreThanPending();
    error BalancedVaultWithdrawPending();

    // function initialize(IERC20Upgradeable dsu_) external;
    // function sync() external;
    // function healthy() external view returns (bool);
    // function controller() external view returns (IController);
    // function collateral() external view returns (ICollateral);
    // function long() external view returns (IProduct);
    // function short() external view returns (IProduct);
    // function targetLeverage() external view returns (UFixed18);
    // function maxLeverage() external view returns (UFixed18);
    // function fixedFloat() external view returns (UFixed18);
    // function maxCollateral() external view returns (UFixed18);
}
