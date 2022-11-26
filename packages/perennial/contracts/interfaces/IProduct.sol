// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "./IPayoffProvider.sol";
import "./IParamProvider.sol";
import "./types/PayoffDefinition.sol";
import "./types/Position.sol";
import "./types/PrePosition.sol";
import "./types/Accumulator.sol";

interface IProduct is IPayoffProvider, IParamProvider {
    /// @dev Product Creation parameters
    struct ProductInfo {
        /// @dev name of the product
        string name;

        /// @dev symbol of the product
        string symbol;

        /// @dev stablecoin collateral token
        Token18 token;

        /// @dev product payoff definition
        PayoffDefinition payoffDefinition;

        /// @dev oracle address
        IOracleProvider oracle;

        /// @dev product maintenance ratio
        UFixed18 maintenance;

        /// @dev product funding fee
        UFixed18 fundingFee;

        /// @dev product maker fee
        UFixed18 makerFee;

        /// @dev product taker fee
        UFixed18 takerFee;

        /// @dev product position fee
        UFixed18 positionFee;

        /// @dev product maker limit
        UFixed18 makerLimit;

        /// @dev utulization curve definition
        JumpRateUtilizationCurve utilizationCurve;
    }

    event Settle(uint256 preVersion, uint256 toVersion);
    event AccountSettle(address indexed account, uint256 preVersion, uint256 toVersion);
    event PositionUpdated(address indexed account, uint256 version, Fixed18 amount);
    event CollateralUpdated(address indexed account, Fixed18 amount);
    event Liquidation(address indexed account, address liquidator, UFixed18 fee);
    event FeeSettled(UFixed18 protocolFeeAmount, UFixed18 productFeeAmount);
    event CollateralSettled(address indexed account, Fixed18 amount, UFixed18 newShortfall);
    event ShortfallResolved(UFixed18 amount);

    error ProductInsufficientLiquidityError();
    error ProductInsufficientCollateralError();
    error ProductInLiquidationError();
    error ProductMakerOverLimitError();
    error ProductOracleBootstrappingError();
    error ProductNotOwnerError();
    error ProductInvalidOracle();
    error ProductClosedError();
    error ProductCollateralUnderLimitError();
    error ProductCantLiquidate();
    error ProductShortfallError();

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function token() external view returns (Token18);
    function fees() external view returns (UFixed18);
    function initialize(ProductInfo calldata productInfo_) external;
    function settle() external;
    function settleAccount(address account) external;
    function update(Fixed18 positionAmount, Fixed18 collateralAmount) external;
    function liquidate(address account) external;
    function resolveShortfall(UFixed18 amount) external;
    function maintenance(address account) external view returns (UFixed18);
    function maintenanceNext(address account) external view returns (UFixed18);
    function liquidation(address account) external view returns (bool);
    function collateral(address account) external view returns (UFixed18);
    function position(address account) external view returns (Fixed18);
    function pre(address account) external view returns (Fixed18);
    function liquidatable(address account) external view returns (bool);
    function latestVersion() external view returns (uint256);
    function collateral() external view returns (UFixed18);
    function shortfall() external view returns (UFixed18);
    function positionAtVersion(uint256 oracleVersion) external view returns (Position memory);
    function pre() external view returns (PrePosition memory);
    function valueAtVersion(uint256 oracleVersion) external view returns (Accumulator memory);
    function shareAtVersion(uint256 oracleVersion) external view returns (Accumulator memory);
    function latestVersion(address account) external view returns (uint256);
}
