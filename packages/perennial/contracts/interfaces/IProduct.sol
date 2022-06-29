// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "./types/Position.sol";
import "./types/PrePosition.sol";
import "./types/Accumulator.sol";
import "./IProductProvider.sol";

interface IProduct {
    /// @dev Product Creation parameters
    struct ProductInitParams {
        /// @dev name of the product
        string name;

        /// @dev symbol of the product
        string symbol;

        /// @dev product provider address
        IProductProvider productProvider;
    }

    event Settle(uint256 preVersion, uint256 toVersion);
    event AccountSettle(address indexed account, uint256 preVersion, uint256 toVersion);
    event MakeOpened(address indexed account, uint256 version, UFixed18 amount);
    event TakeOpened(address indexed account, uint256 version, UFixed18 amount);
    event MakeClosed(address indexed account, uint256 version, UFixed18 amount);
    event TakeClosed(address indexed account, uint256 version, UFixed18 amount);

    error ProductInsufficientLiquidityError(UFixed18 socializationFactor);
    error ProductDoubleSidedError();
    error ProductOverClosedError();
    error ProductInsufficientCollateralError();
    error ProductInLiquidationError();
    error ProductMakerOverLimitError();
    error ProductOracleBootstrappingError();
    error ProductNotOwnerError();

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function productProvider() external view returns (IProductProvider);
    function initialize(ProductInitParams calldata initParams_) external;
    function settle() external;
    function settleAccount(address account) external;
    function openTake(UFixed18 amount) external;
    function closeTake(UFixed18 amount) external;
    function openMake(UFixed18 amount) external;
    function closeMake(UFixed18 amount) external;
    function closeAll(address account) external;
    function maintenance(address account) external view returns (UFixed18);
    function maintenanceNext(address account) external view returns (UFixed18);
    function isClosed(address account) external view returns (bool);
    function isLiquidating(address account) external view returns (bool);
    function position(address account) external view returns (Position memory);
    function pre(address account) external view returns (PrePosition memory);
    function latestVersion() external view returns (uint256);
    function positionAtVersion(uint256 oracleVersion) external view returns (Position memory);
    function pre() external view returns (PrePosition memory);
    function valueAtVersion(uint256 oracleVersion) external view returns (Accumulator memory);
    function shareAtVersion(uint256 oracleVersion) external view returns (Accumulator memory);
    function latestVersion(address account) external view returns (uint256);
}
