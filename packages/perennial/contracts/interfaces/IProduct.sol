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
import "../product/types/Fee.sol";

interface IProduct is IPayoffProvider, IParamProvider {
    struct ProductDefinition {
        string name;
        string symbol;
        Token18 token;
        Token18 reward;
        IOracleProvider oracle;
        PayoffDefinition payoffDefinition;
    }

    event Settle(uint256 preVersion, uint256 toVersion);
    event AccountSettle(address indexed account, uint256 preVersion, uint256 toVersion);
    event PositionUpdated(address indexed account, uint256 version, Fixed18 amount);
    event CollateralUpdated(address indexed account, Fixed18 amount);
    event Liquidation(address indexed account, address liquidator, UFixed18 fee);
    event FeeSettled(UFixed18 protocolFeeAmount, UFixed18 productFeeAmount);
    event CollateralSettled(address indexed account, Fixed18 amount, UFixed18 newShortfall);

    error ProductInsufficientLiquidityError();
    error ProductInsufficientCollateralError();
    error ProductInLiquidationError();
    error ProductInDebtError();
    error ProductMakerOverLimitError();
    error ProductOracleBootstrappingError();
    error ProductNotOwnerError();
    error ProductInvalidOracle();
    error ProductClosedError();
    error ProductCollateralUnderLimitError();
    error ProductCantLiquidate();

    function initialize(ProductDefinition calldata definition_, Parameter calldata parameter_) external;
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function token() external view returns (Token18);
    function liquidation(address account) external view returns (bool);
    function latestVersion() external view returns (uint256);
    function latestVersions(address account) external view returns (uint256);
    function accounts(address account) external view returns (Account memory);
    function versions(uint256 oracleVersion) external view returns (Version memory);
    function pre() external view returns (PrePosition memory);
    function fee() external view returns (Fee memory);
    function settle(address account) external;
    function update(Fixed18 positionAmount, Fixed18 collateralAmount) external;
    function liquidate(address account) external;
}
