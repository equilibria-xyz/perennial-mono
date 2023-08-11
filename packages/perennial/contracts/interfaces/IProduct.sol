// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";
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

        /// @dev product position fee share
        UFixed18 positionFee;

        /// @dev product maker limit
        UFixed18 makerLimit;

        /// @dev utulization curve definition
        JumpRateUtilizationCurve utilizationCurve;
    }

    event Settle(uint256 preVersion, uint256 toVersion);
    event AccountSettle(address indexed account, uint256 preVersion, uint256 toVersion);
    event MakeOpened(address indexed account, uint256 version, UFixed18 amount);
    event TakeOpened(address indexed account, uint256 version, UFixed18 amount);
    event MakeClosed(address indexed account, uint256 version, UFixed18 amount);
    event TakeClosed(address indexed account, uint256 version, UFixed18 amount);
    event ClosedUpdated(bool indexed newClosed, uint256 version);
    event PositionFeeCharged(address indexed account, uint256 version, UFixed18 fee);
    // Redeclare these events from VersionedAccumulator due to library events not being included in the generated ABI
    // This is expected to be fixed in Solidity v0.9.x (https://github.com/ethereum/solidity/issues/9765#issuecomment-689396725)
    event FundingAccumulated(uint256 latestVersion, uint256 toVersion, Accumulator value, UFixed18 fee);
    event PositionAccumulated(uint256 latestVersion, uint256 toVersion, Accumulator value);
    event PositionFeeAccumulated(uint256 latestVersion, uint256 toVersion, Accumulator value, UFixed18 fee);

    error ProductInsufficientLiquidityError(UFixed18 socializationFactor);
    error ProductDoubleSidedError();
    error ProductOverClosedError();
    error ProductInsufficientCollateralError();
    error ProductInLiquidationError();
    error ProductMakerOverLimitError();
    error ProductOracleBootstrappingError();
    error ProductClosedError();

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function initialize(ProductInfo calldata productInfo_) external;
    function settle() external;
    function settleAccount(address account) external;
    function openTake(UFixed18 amount) external;
    function openTakeFor(address account, UFixed18 amount) external;
    function closeTake(UFixed18 amount) external;
    function closeTakeFor(address account, UFixed18 amount) external;
    function openMake(UFixed18 amount) external;
    function openMakeFor(address account, UFixed18 amount) external;
    function closeMake(UFixed18 amount) external;
    function closeMakeFor(address account, UFixed18 amount) external;
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
    function rate(Position memory position) external view returns (Fixed18);
    function closed() external view returns (bool);
    function updateClosed(bool newClosed) external;
    function updateOracle(IOracleProvider newOracle) external;
}
