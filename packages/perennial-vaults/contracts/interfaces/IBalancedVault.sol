//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial/contracts/interfaces/IController.sol";
import "@equilibria/perennial/contracts/interfaces/ICollateral.sol";
import "@equilibria/root/number/types/UFixed18.sol";

interface IBalancedVault {

    /* BalancedVault Interface */

    struct Version {
        UFixed18 longPosition;
        UFixed18 shortPosition;
        UFixed18 totalShares;
        UFixed18 longAssets;
        UFixed18 shortAssets;
        UFixed18 totalAssets;
    }

    struct VersionContext {
        uint256 version;
        UFixed18 latestCollateral;
        UFixed18 latestShares;
    }

    event Deposit(address indexed sender, address indexed account, uint256 version, UFixed18 assets);
    event Redemption(address indexed sender, address indexed account, uint256 version, UFixed18 shares);
    event Claim(address indexed sender, address indexed account, UFixed18 assets);
    event PositionUpdated(IProduct product, UFixed18 targetPosition);
    event CollateralUpdated(IProduct product, UFixed18 targetCollateral);

    error BalancedVaultDepositLimitExceeded();
    error BalancedVaultRedemptionLimitExceeded();

    function initialize(string memory name_, string memory symbol_) external;
    function sync() external;
    function controller() external view returns (IController);
    function collateral() external view returns (ICollateral);
    function long() external view returns (IProduct);
    function short() external view returns (IProduct);
    function targetLeverage() external view returns (UFixed18);
    function maxCollateral() external view returns (UFixed18);
    function unclaimed(address account) external view returns (UFixed18);
    function totalUnclaimed() external view returns (UFixed18);
    function claim(address account) external;

    /* Partial ERC4626 Interface */

    function asset() external view returns (Token18);
    function totalAssets() external view returns (UFixed18);
    function convertToShares(UFixed18 assets) external view returns (UFixed18);
    function convertToAssets(UFixed18 shares) external view returns (UFixed18);
    function maxDeposit(address account) external view returns (UFixed18);
    function deposit(UFixed18 assets, address account) external;
    function maxRedeem(address account) external view returns (UFixed18);
    function redeem(UFixed18 shares, address account) external;

    /* Partial ERC20 Interface */

    event Transfer(address indexed from, address indexed to, UFixed18 value);
    event Approval(address indexed account, address indexed spender, UFixed18 value);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (UFixed18);
    function balanceOf(address account) external view returns (UFixed18);
    function transfer(address to, UFixed18 amount) external returns (bool);
    function allowance(address account, address spender) external view returns (UFixed18);
    function approve(address spender, UFixed18 amount) external returns (bool);
    function transferFrom(address from, address to, UFixed18 amount) external returns (bool);
}
