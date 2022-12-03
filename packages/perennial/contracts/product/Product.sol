// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UReentrancyGuard.sol";
import "../controller/UControllerProvider.sol";
import "./UPayoffProvider.sol";
import "./UParamProvider.sol";
import "hardhat/console.sol";


// TODO: position needs less settle on the second period for both global and account
// TODO: lots of params can be passed in from global settle to account settle

/**
 * @title Product
 * @notice Manages logic and state for a single product market.
 * @dev Cloned by the Controller contract to launch new product markets.
 */
contract Product is IProduct, UInitializable, UParamProvider, UPayoffProvider, UReentrancyGuard {
    struct CurrentContext {
        /* Global Parameters */
        IIncentivizer incentivizer;

        UFixed18 minFundingFee;

        UFixed18 minCollateral;

        address protocolTreasury;

        UFixed18 protocolFee;

        bool paused;

        /* Product Parameters */

        Parameter parameter;

        /* Current Global State */
        uint256 latestVersion;

        IOracleProvider.OracleVersion currentOracleVersion;

        Version version;

        PrePosition pre;

        Fee fee;

        /* Current Account State */
        uint256 latestAccountVersion;

        Account account;

        bool liquidation;

        /* Debugging */
        uint256 gasCounter;

        string gasCounterMessage;
    }

    /// @dev The name of the product
    string public name;

    /// @dev The symbol of the product
    string public symbol;

    /// @dev ERC20 stablecoin for collateral
    Token18 public token;

    /// @dev Protocol and product fees collected, but not yet claimed
    Fee private _fee;

    /// @dev The individual state for each account
    mapping(address => Account) private _accounts;

    /// @dev Mapping of the historical version data
    mapping(uint256 => Version) _versions;

    PrePosition private _pre; //TODO: still outside?

    uint256 public latestVersion;
    mapping(address => uint256) public latestVersions;

    /// @dev Whether the account is currently locked for liquidation
    mapping(address => bool) public liquidation;

    /**
     * @notice Initializes the contract state
     */
    function initialize(
        IProduct.ProductDefinition calldata definition_,
        Parameter calldata parameter_
    ) external initializer(1) {
        __UControllerProvider__initialize(IController(msg.sender));
        __UPayoffProvider__initialize(definition_.oracle, definition_.payoffDefinition);
        __UReentrancyGuard__initialize();
        __UParamProvider__initialize(parameter_);

        name = definition_.name;
        symbol = definition_.symbol;
        token = definition_.token;
    }

    //TODO: address 0?
    function settle(address account) external nonReentrant {
        CurrentContext memory context = _loadContext(account);
        _settle(context, account);
        _saveContext(context, account);
    }

    //TODO support depositTo and withdrawTo
    function update(Fixed18 positionAmount, Fixed18 collateralAmount) external nonReentrant {
        CurrentContext memory context = _loadContext(msg.sender);
        _settle(context, msg.sender);
        _update(context, msg.sender, positionAmount, collateralAmount, false);
        _saveContext(context, msg.sender);
    }

    function liquidate(address account)
    external
    nonReentrant
    {
        CurrentContext memory context = _loadContext(account);
        _settle(context, account);
        _liquidate(context, account);
        _saveContext(context, account);
    }

    //TODO: claim fee

    function accounts(address account) external view returns (Account memory) {
        return _accounts[account];
    }

    function versions(uint256 oracleVersion) external view returns (Version memory) {
        return _versions[oracleVersion];
    }

    function pre() external view returns (PrePosition memory) {
        return _pre;
    }

    function fee() external view returns (Fee memory) {
        return _fee;
    }

    function _liquidate(
        CurrentContext memory context,
        address account
    ) private {
        // before
        if (!_liquidatable(context)) revert ProductCantLiquidate();

        // close all positions
        _update(context, account, context.account.position().mul(Fixed18Lib.NEG_ONE), Fixed18Lib.ZERO, true);

        // handle liquidation fee
        UFixed18 liquidationFee = controller().liquidationFee(); // TODO: external call
        UFixed18 liquidationReward = UFixed18Lib.min(
            context.account.collateral().max(Fixed18Lib.ZERO).abs(),
            context.account.maintenance(context.currentOracleVersion, context.parameter.maintenance).mul(liquidationFee)
        );
        context.account.update(
            Fixed18Lib.ZERO, //TODO: all the position stuff is not needed here so might be a gas efficiency check here
            Fixed18Lib.from(-1, liquidationReward),
            context.currentOracleVersion,
            context.parameter.makerFee,
            context.parameter.takerFee
        );
        context.liquidation = true;

        // remit liquidation reward
        token.push(msg.sender, liquidationReward);

        emit Liquidation(account, msg.sender, liquidationReward);
    }

    function _update(
        CurrentContext memory context,
        address account,
        Fixed18 positionAmount,
        Fixed18 collateralAmount,
        bool force
    ) private {
        _startGas(context, "_update before-update-after: %s");

        // before
        if (context.paused) revert PausedError();
        if (context.liquidation) revert ProductInLiquidationError();
        if (context.parameter.closed && !_closingNext(context, positionAmount)) revert ProductClosedError();

        // update
        (Fixed18 makerAmount, Fixed18 takerAmount) = context.account.update(
            positionAmount,
            collateralAmount,
            context.currentOracleVersion,
            context.parameter.makerFee,
            context.parameter.takerFee
        );
        context.pre.update(
            makerAmount,
            takerAmount,
            context.currentOracleVersion,
            context.parameter.makerFee,
            context.parameter.takerFee
        );

        // after
        if (context.account.collateral().sign() == -1 && collateralAmount.sign() == -1) revert ProductInDebtError();
        if (_liquidatable(context) || _liquidatableNext(context)) revert ProductInsufficientCollateralError();
        if (!force && _socializationNext(context).lt(UFixed18Lib.ONE)) revert ProductInsufficientLiquidityError();
        if (context.version.position().next(context.pre).maker.gt(context.parameter.makerLimit)) revert ProductMakerOverLimitError();
        if (!context.account.collateral().isZero() && context.account.collateral().lt(Fixed18Lib.from(context.minCollateral))) revert ProductCollateralUnderLimitError();

        _endGas(context);

        _startGas(context, "_update fund-events: %s");

        // fund
        if (collateralAmount.sign() == 1) token.pull(account, collateralAmount.abs());
        if (collateralAmount.sign() == -1) token.push(account, collateralAmount.abs());

        // events
        //TODO: cleanup
        emit PositionUpdated(account, context.currentOracleVersion.version, positionAmount);
        emit CollateralUpdated(account, collateralAmount);

        _endGas(context);
    }

    function _loadContext(address account) private returns (CurrentContext memory context) {
        _startGas(context, "_loadContext: %s");

        // Load protocol parameters
        (context.incentivizer, context.minFundingFee, context.minCollateral, context.paused, context.protocolTreasury, context.protocolFee) = controller().settlementParameters();

        // Load product parameters
        context.parameter = parameter();

        // Load product state
        context.currentOracleVersion = _sync();
        context.latestVersion = latestVersion;
        context.version = _versions[context.latestVersion];
        context.pre = _pre;
        context.fee = _fee;

        // Load account state
        context.latestAccountVersion = latestVersions[account];
        context.account = _accounts[account];
        context.liquidation = liquidation[account];

        // after
        if (context.paused) revert PausedError();

        _endGas(context);
    }

    function _saveContext(CurrentContext memory context, address account) private {
        _startGas(context, "_saveContext: %s");

        latestVersion = context.latestVersion;
        latestVersions[account] = context.latestAccountVersion;
        _accounts[account] = context.account;
        liquidation[account] = context.liquidation;
        _pre = context.pre;
        _fee = context.fee;

        _endGas(context);
    }

    function _settle(CurrentContext memory context, address account) private { //TODO: should be pure
        _startGas(context, "_settle: %s");

        // Initialize memory
        UFixed18 feeAccumulator; //TODO: whys this still here?
        Period memory period;
        Version memory fromVersion;
        Version memory toVersion;

        // Sync incentivizer programs
        context.incentivizer.sync(context.currentOracleVersion); //TODO: why isn't this called twice?

        // settle product a->b if necessary
        period.fromVersion = context.latestVersion == context.currentOracleVersion.version ? // TODO: make a lazy loader here
            context.currentOracleVersion :
            atVersion(context.latestVersion);
        period.toVersion = context.latestVersion + 1 == context.currentOracleVersion.version ?
            context.currentOracleVersion :
            atVersion(context.latestVersion + 1);
        _settlePeriod(feeAccumulator, context, period);

        // settle product b->c if necessary
        period.fromVersion = period.toVersion;
        period.toVersion = context.currentOracleVersion;
        _settlePeriod(feeAccumulator, context, period);

        // settle account a->b if necessary
        period.toVersion = context.latestAccountVersion + 1 == context.currentOracleVersion.version ?
            context.currentOracleVersion : // if b == c, don't re-call provider for oracle version
            atVersion(context.latestAccountVersion + 1);
        fromVersion = _versions[context.latestAccountVersion]; //TODO: can we lazy load version too?
        toVersion = _versions[context.latestAccountVersion + 1];
        _settlePeriodAccount(context, period, fromVersion, toVersion, account);

        // settle account b->c if necessary
        period.toVersion = context.currentOracleVersion;
        fromVersion = toVersion;
        toVersion = context.version;
        _settlePeriodAccount(context, period, fromVersion, toVersion, account);

        _endGas(context);
    }

    function _settlePeriod(UFixed18 feeAccumulator, CurrentContext memory context, Period memory period) private {
        if (context.currentOracleVersion.version > context.latestVersion) {
            UFixed18 feeAmount = context.version.accumulate(
                feeAccumulator,
                context.pre,
                period,
                context.parameter.positionFee,
                context.parameter.utilizationCurve,
                context.minFundingFee,
                context.parameter.fundingFee,
                context.parameter.closed
            );
            context.fee.update(feeAmount, context.protocolFee);
            context.latestVersion = period.toVersion.version;
            _versions[period.toVersion.version] = context.version;
        }
    }

    function _settlePeriodAccount(
        CurrentContext memory context,
        Period memory period,
        Version memory fromVersion,
        Version memory toVersion,
        address account
    ) private {
        if (context.currentOracleVersion.version > context.latestAccountVersion) {
            context.incentivizer.syncAccount(account, period.toVersion);

            context.account.accumulate(fromVersion, toVersion);
            context.latestAccountVersion = period.toVersion.version;
        }
    }

    /**
     * @notice Returns whether `account`'s `product` collateral account can be liquidated
     *         after the next oracle version settlement
     * @dev Takes into account the current pre-position on the account
     * @return Whether the account can be liquidated
     */
    function _liquidatableNext(CurrentContext memory context) private pure returns (bool) {
        UFixed18 maintenanceAmount = context.account.maintenanceNext(context.currentOracleVersion, context.parameter.maintenance);
        return Fixed18Lib.from(maintenanceAmount).gt(context.account.collateral());
    }

    function _liquidatable(CurrentContext memory context) private pure returns (bool) {
        UFixed18 maintenanceAmount = context.account.maintenance(context.currentOracleVersion, context.parameter.maintenance);
        return Fixed18Lib.from(maintenanceAmount).gt(context.account.collateral());
    }

    function _socializationNext(CurrentContext memory context) private pure returns (UFixed18) {
        if (context.parameter.closed) return UFixed18Lib.ONE;
        return context.version.position().next(context.pre).socializationFactor();
    }

    function _closingNext(CurrentContext memory context, Fixed18 amount) private pure returns (bool) {
        Fixed18 nextAccountPosition = context.account.next();
        if (nextAccountPosition.sign() == 0) return true;
        if (context.account.position().sign() == amount.sign()) return false;
        if (nextAccountPosition.sign() != context.account.position().sign()) return false;
        return true;
    }

    // Debug
    function _startGas(CurrentContext memory context, string memory message) private view {
        context.gasCounterMessage = message;
        context.gasCounter = gasleft();
    }

    function _endGas(CurrentContext memory context) private view {
        uint256 endGas = gasleft();
        console.log(context.gasCounterMessage,  context.gasCounter - endGas);
    }
}
