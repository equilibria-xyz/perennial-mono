//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@equilibria/perennial/contracts/interfaces/ICollateral.sol";
import "@equilibria/root/number/types/UFixed18.sol";

interface IBalancedVault {
    struct PendingAmount {
        UFixed18 amount;
        uint256 version;
    }

    struct Version {
        UFixed18 longPosition;
        UFixed18 shortPosition;
        UFixed18 totalShares;
        UFixed18 totalCollateral;
    }

    // TODO: BalancedVault interface

    event PositionUpdated(IProduct product, UFixed18 targetPosition);
    event CollateralUpdated(IProduct product, UFixed18 targetCollateral);

    error BalancedVaultDepositLimitExceeded();
    error BalancedVaultRedemptionLimitExceeded();

    // function initialize(Token18 asset_) external;
    function sync() external;
    function unhealthy() external view returns (bool);
    function collateral() external view returns (ICollateral);
    function long() external view returns (IProduct);
    function short() external view returns (IProduct);
    function targetLeverage() external view returns (UFixed18);
    function maxCollateral() external view returns (UFixed18);
    function unclaimed(address owner) external view returns (UFixed18);
    function totalUnclaimed() external view returns (UFixed18);
    function claim(address owner) external;

    // TODO: ERC4626 interface

    event Deposit(address indexed sender, address indexed owner, uint256 assets, UFixed18 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, UFixed18 assets, UFixed18 shares);

    function asset() external view returns (Token18);
    function totalAssets() external view returns (UFixed18);
//    function convertToShares(uint256 assets) external view returns (uint256 shares);
//    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function maxDeposit(address receiver) external view returns (UFixed18);
//    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function deposit(UFixed18 assets, address receiver) external;
//    function maxMint(address receiver) external view returns (uint256 maxShares);
//    function previewMint(uint256 shares) external view returns (uint256 assets);
//    function mint(uint256 shares, address receiver) external returns (uint256 assets);
//    function maxWithdraw(address owner) external view returns (uint256 maxAssets);
//    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
//    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function maxRedeem(address owner) external view returns (UFixed18);
//    function previewRedeem(uint256 shares) external view returns (uint256 assets);
    function redeem(UFixed18 shares, address receiver, address owner) external;

    // TODO: ERC20 interface

    event Transfer(address indexed from, address indexed to, UFixed18 value);
    event Approval(address indexed owner, address indexed spender, UFixed18 value);

    function totalSupply() external view returns (UFixed18);
    function balanceOf(address account) external view returns (UFixed18);
    function transfer(address to, UFixed18 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (UFixed18);
    function approve(address spender, UFixed18 amount) external returns (bool);
    function transferFrom(address from, address to, UFixed18 amount) external returns (bool);
}
