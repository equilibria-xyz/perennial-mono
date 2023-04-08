//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial/contracts/interfaces/IController.sol";
import "@equilibria/perennial/contracts/interfaces/ICollateral.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import "./IBalancedVaultDefinition.sol";

interface IBalancedVault is IBalancedVaultDefinition {

    event Approval(address indexed account, address indexed spender, bool approved);
    event Mint(address indexed account, UFixed18 amount);
    event Burn(address indexed account, UFixed18 amount);
    event Deposit(address indexed sender, address indexed account, uint256 indexed market, uint256 version, UFixed18 assets);
    event Redemption(address indexed sender, address indexed account, uint256 indexed market, uint256 version, UFixed18 proportion);
    event Claim(address indexed sender, address indexed account, UFixed18 assets);
    event PositionUpdated(IProduct product, UFixed18 targetPosition);
    event CollateralUpdated(IProduct product, UFixed18 targetCollateral);

    error BalancedVaultUnauthorized();
    error BalancedVaultDepositLimitExceeded();
    error BalancedVaultRedemptionLimitExceeded();
    error BalancedVaultRedemptionInvalidProportion();
    error InvalidMarket(uint256); //TODO: ?
    error BalancedVaultNotApproved();

    function name() external view returns (string memory);
    function initialize(string memory name_) external;
    function sync() external;
    function unclaimed(address account) external view returns (UFixed18);
    function totalUnclaimed() external view returns (UFixed18);
    function claim(address account) external;
    function isApproved(address account, address spender) external view returns (bool);
    function setApproval(address spender, bool approved) external;

    /* Partial ERC4626 Interface */

    function totalAssets() external view returns (UFixed18);
    function convertToAssets(UFixed18 proportion, address account) external view returns (UFixed18);
    function maxDeposit(address account) external view returns (UFixed18);
    function deposit(UFixed18 assets, address account) external;
    function maxRedeem(address account) external view returns (UFixed18);
    function redeem(UFixed18 proportion, address account) external;
}
