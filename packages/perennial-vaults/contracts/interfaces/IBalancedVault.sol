//SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial/contracts/interfaces/IController.sol";
import "@equilibria/perennial/contracts/interfaces/ICollateral.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import "./IBalancedVaultDefinition.sol";

interface IBalancedVault is IBalancedVaultDefinition {

    /* BalancedVault Interface */

    /// @dev Accounting state for a long/short pair.
    struct MarketAccounting {
        /// @dev Mapping of shares of the vault per user
        mapping(address => UFixed18) balanceOf;

        /// @dev Total number of shares across all users
        UFixed18 totalSupply;

        /// @dev Mapping of unclaimed underlying of the vault per user
        mapping(address => UFixed18) unclaimed;

        /// @dev Total unclaimed underlying of the vault across all users
        UFixed18 totalUnclaimed;

        /// @dev Deposits that have not been settled, or have been settled but not yet processed by this contract
        UFixed18 deposit;

        /// @dev Redemptions that have not been settled, or have been settled but not yet processed by this contract
        UFixed18 redemption;

        /// @dev The latest version that a pending deposit or redemption has been placed
        uint256 latestVersion;

        /// @dev Mapping of pending (not yet converted to shares) per user
        mapping(address => UFixed18) deposits;

        /// @dev Mapping of pending (not yet withdrawn) per user
        mapping(address => UFixed18) redemptions;

        /// @dev Mapping of the latest version that a pending deposit or redemption has been placed per user
        mapping(address => uint256) latestVersions;

        /// @dev Mapping of versions of the vault state at a given oracle version
        mapping(uint256 => Version) versions;

        /// @dev For extending the struct without breaking storage
        uint256[20] __gap;
    }

    struct Version {
        UFixed18 longPosition;
        UFixed18 shortPosition;
        UFixed18 totalShares;
        UFixed18 longAssets;
        UFixed18 shortAssets;
        UFixed18 totalAssets;
    }

    struct VersionContext {
        uint256 market;
        uint256 version;
        UFixed18 latestCollateral;
        UFixed18 latestShares;
    }

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
    function initialize(string memory name_, string memory symbol_) external;
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
