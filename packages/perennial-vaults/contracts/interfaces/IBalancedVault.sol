//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@equilibria/perennial/contracts/interfaces/ICollateral.sol";
import "@equilibria/root/number/types/UFixed18.sol";

interface IBalancedVault {

    // TODO: BalancedVault interface

    event PositionUpdated(IProduct product, UFixed18 targetPosition);
    event CollateralUpdated(IProduct product, UFixed18 targetCollateral);

    error BalancedVaultDepositLimitExceeded();
    error BalancedVaultRedemptionLimitExceeded();

    // function initialize(Token18 asset_) external;
    function sync() external;
    function healthy() external view returns (bool);
    function collateral() external view returns (ICollateral);
    function long() external view returns (IProduct);
    function short() external view returns (IProduct);
    function targetLeverage() external view returns (UFixed18);
    function maxCollateral() external view returns (UFixed18);
    function unclaimed(address owner) external view returns (UFixed18);
    function totalUnclaimed() external view returns (UFixed18);
    function claim() external;

    // TODO: ERC4626 interface

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    function asset() external view returns (address assetTokenAddress);
    function totalAssets() external view returns (uint256 totalManagedAssets);
//    function convertToShares(uint256 assets) external view returns (uint256 shares);
//    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function maxDeposit(address receiver) external view returns (uint256 maxAssets);
//    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
//    function maxMint(address receiver) external view returns (uint256 maxShares);
//    function previewMint(uint256 shares) external view returns (uint256 assets);
//    function mint(uint256 shares, address receiver) external returns (uint256 assets);
//    function maxWithdraw(address owner) external view returns (uint256 maxAssets);
//    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
//    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function maxRedeem(address owner) external view returns (uint256 maxShares);
//    function previewRedeem(uint256 shares) external view returns (uint256 assets);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    // TODO: ERC20 interface

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
//    function transfer(address to, uint256 amount) external returns (bool);
//    function allowance(address owner, address spender) external view returns (uint256);
//    function approve(address spender, uint256 amount) external returns (bool);
//    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
