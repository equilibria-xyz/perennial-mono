// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../types/root/UFixed6.sol";
import "@equilibria/root/token/types/Token18.sol";
import "./IOracleProvider.sol";
import "../types/Position.sol";
import "../types/Accumulator.sol";
import "../types/Version.sol";
import "../types/Account.sol";
import "../types/Fee.sol";
import "../types/OracleVersion.sol";

interface IMarket {
    struct MarketDefinition {
        string name;
        string symbol;
        Token18 token;
        Token18 reward;
    }

    event Settle(uint256 preVersion, uint256 toVersion);
    event AccountSettle(address indexed account, uint256 preVersion, uint256 toVersion);
    event Updated(address indexed account, uint256 version, Fixed6 positionAmount, Fixed6 collateralAmount);
    event Liquidation(address indexed account, address liquidator, UFixed6 fee);
    event FeeSettled(UFixed6 protocolFeeAmount, UFixed6 marketFeeAmount);
    event CollateralSettled(address indexed account, Fixed6 amount, UFixed6 newShortfall);
    event TreasuryUpdated(address newTreasury);
    event FeeClaimed(address indexed treasury, UFixed6 feeAmount);
    event ParameterUpdated(MarketParameter newParameter);

    error MarketInsufficientLiquidityError();
    error MarketInsufficientCollateralError();
    error MarketInLiquidationError();
    error MarketInDebtError();
    error MarketMakerOverLimitError();
    error MarketOracleBootstrappingError();
    error MarketInvalidOracle();
    error MarketPausedError();
    error MarketClosedError();
    error MarketCollateralUnderLimitError();
    error MarketCantLiquidate();
    error MarketNotTreasuryError();
    error PayoffProviderInvalidOracle();
    error PayoffProviderInvalidPayoffDefinitionError();

    function initialize(MarketDefinition calldata definition_, MarketParameter calldata parameter_) external;
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function token() external view returns (Token18);
    function reward() external view returns (Token18);
    function treasury() external view returns (address);
    function latestVersion() external view returns (uint256);
    function latestVersions(address account) external view returns (uint256);
    function accounts(address account) external view returns (Account memory);
    function versions(uint256 oracleVersion) external view returns (Version memory);
    function position() external view returns (Position memory);
    function fee() external view returns (Fee memory);
    function settle(address account) external;
    function update(Fixed6 positionAmount, Fixed6 collateralAmount) external;
    function liquidate(address account) external;
    function updateTreasury(address newTreasury) external;
    function parameter() external view returns (MarketParameter memory);
    function updateParameter(MarketParameter memory newParameter) external;
}
