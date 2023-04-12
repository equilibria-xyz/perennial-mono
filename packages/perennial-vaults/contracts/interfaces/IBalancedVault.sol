//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial/contracts/interfaces/IController.sol";
import "@equilibria/perennial/contracts/interfaces/ICollateral.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import "./IBalancedVaultDefinition.sol";

interface IBalancedVault is IBalancedVaultDefinition {

    struct EpochContext {
        uint256 epoch;
        UFixed18 latestCollateral; //TODO: rename
        UFixed18 latestShares;
    }

    struct Epoch {
        UFixed18 totalShares;
        UFixed18 totalAssets;
    }

    event Approval(address indexed account, address indexed spender, UFixed18 amount);
    event Mint(address indexed account, UFixed18 amount);
    event Burn(address indexed account, UFixed18 amount);
    event Deposit(address indexed sender, address indexed account, uint256 version, UFixed18 assets);
    event Redemption(address indexed sender, address indexed account, uint256 version, UFixed18 shares);
    event Claim(address indexed sender, address indexed account, UFixed18 assets);

    error BalancedVaultDepositLimitExceeded();
    error BalancedVaultRedemptionLimitExceeded();

    function name() external view returns (string memory);
    function initialize(string memory name_) external;
    function sync() external;
    function unclaimed(address account) external view returns (UFixed18);
    function totalUnclaimed() external view returns (UFixed18);
    function claim(address account) external;

    /* Partial ERC4626 Interface */

    function totalAssets() external view returns (UFixed18);
    function convertToAssets(UFixed18 shares) external view returns (UFixed18);
    function convertToShares(UFixed18 assets) external view returns (UFixed18);
    function maxDeposit(address account) external view returns (UFixed18);
    function deposit(UFixed18 assets, address account) external;
    function maxRedeem(address account) external view returns (UFixed18);
    function redeem(UFixed18 proportion, address account) external;

    //TODO: put back some functions
}
