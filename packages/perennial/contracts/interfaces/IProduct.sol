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
import "../product/types/Version.sol"; //TODO: these have to be in interface
import "../product/types/Account.sol";

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

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function token() external view returns (Token18);
    function productFees() external view returns (UFixed18);
    function protocolFees() external view returns (UFixed18);
    function initialize(ProductInfo calldata productInfo_) external;
    function settle(address account) external;
    function update(Fixed18 positionAmount, Fixed18 collateralAmount) external;
    function liquidate(address account) external;
    function resolveShortfall(UFixed18 amount) external;
    function liquidation(address account) external view returns (bool);
    function latestVersion() external view returns (uint256);
    function shortfall() external view returns (UFixed18);
    function accounts(address account) external view returns (Account memory);
    function versions(uint256 oracleVersion) external view returns (Version memory);
    function pre() external view returns (PrePosition memory);
    function latestVersions(address account) external view returns (uint256);
}
