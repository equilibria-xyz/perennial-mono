// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UOwnable.sol";
import "@equilibria/root/control/unstructured/UReentrancyGuard.sol";
import "../interfaces/IProduct.sol";
import "../interfaces/IController.sol";
import "./UPayoffProvider.sol";
import "hardhat/console.sol";


// TODO: position needs less settle on the second period for both global and account
// TODO: lots of params can be passed in from global settle to account settle

/**
 * @title Product
 * @notice Manages logic and state for a single product market.
 * @dev Cloned by the Controller contract to launch new product markets.
 */
contract Product is IProduct, UInitializable, UOwnable, UPayoffProvider, UReentrancyGuard {
    struct CurrentContext {
        /* Global Parameters */
        ProtocolParameter protocolParameter;

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

    /// @dev The protocol controller
    IController public controller;

    /// @dev The name of the product
    string public name;

    /// @dev The symbol of the product
    string public symbol;

    /// @dev ERC20 stablecoin for collateral
    Token18 public token;

    /// @dev ERC20 stablecoin for reward
    Token18 public reward;

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

    /// @dev Treasury of the product, collects fees
    address public treasury;

    ParameterStorage private constant _parameter = ParameterStorage.wrap(keccak256("equilibria.perennial.UParamProvider.parameter"));
    function parameter() public view returns (Parameter memory) { return _parameter.read(); }

    /**
     * @notice Initializes the contract state
     */
    function initialize(
        IProduct.ProductDefinition calldata definition_,
        Parameter calldata parameter_
    ) external initializer(1) {
        __UOwnable__initialize();
        __UPayoffProvider__initialize(definition_.oracle, definition_.payoffDefinition);
        __UReentrancyGuard__initialize();

        controller = IController(msg.sender);
        name = definition_.name;
        symbol = definition_.symbol;
        token = definition_.token;
        reward = definition_.reward;
        updateParameter(parameter_);
    }

    //TODO: address 0?
    function settle(address account) external nonReentrant {
        CurrentContext memory context = _loadContext(account);
        _settle(context);
        _saveContext(context, account);
    }

    //TODO support depositTo and withdrawTo
    function update(Fixed18 positionAmount, Fixed18 collateralAmount) external nonReentrant {
        CurrentContext memory context = _loadContext(msg.sender);
        _settle(context);
        _update(context, msg.sender, positionAmount, collateralAmount, false);
        _saveContext(context, msg.sender);
    }

    function liquidate(address account)
    external
    nonReentrant
    {
        CurrentContext memory context = _loadContext(account);
        _settle(context);
        _liquidate(context, account);
        _saveContext(context, account);
    }

    function updateTreasury(address newTreasury) external onlyOwner {
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function updateParameter(Parameter memory newParameter) public onlyOwner {
        _parameter.store(newParameter);
        emit ParameterUpdated(newParameter);
    }

    function claimFee() external {
        Fee memory newFee = _fee;

        if (msg.sender == treasury) {
            UFixed18 feeAmount = newFee.product();
            newFee._product = 0;
            token.push(msg.sender, feeAmount);
            emit FeeClaimed(msg.sender, feeAmount);
        }

        if (msg.sender == controller.treasury()) {
            UFixed18 feeAmount = newFee.protocol();
            newFee._protocol = 0;
            token.push(msg.sender, feeAmount);
            emit FeeClaimed(msg.sender, feeAmount);
        }

        _fee = newFee;
    }

    //TODO: claim reward

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

    function _liquidate(CurrentContext memory context, address account) private {
        // before
        UFixed18 maintenance = context.account.maintenance(context.currentOracleVersion, context.parameter.maintenance);
        if (context.account.collateral().gte(Fixed18Lib.from(maintenance))) revert ProductCantLiquidate();

        // close all positions
        _update(context, account, context.account.position().mul(Fixed18Lib.NEG_ONE), Fixed18Lib.ZERO, true);

        // handle liquidation fee
        UFixed18 liquidationFee = controller.liquidationFee(); // TODO: external call
        UFixed18 liquidationReward = UFixed18Lib.min(
            context.account.collateral().max(Fixed18Lib.ZERO).abs(),
            maintenance.mul(liquidationFee)
        );
        context.account.update(
            Fixed18Lib.ZERO, //TODO: all the position stuff is not needed here so might be a gas efficiency check here
            Fixed18Lib.from(-1, liquidationReward),
            context.currentOracleVersion,
            context.parameter
        );
        context.liquidation = true;

        // remit liquidation reward
        token.push(msg.sender, liquidationReward);

        emit Liquidation(account, msg.sender, liquidationReward);
    }

    function _update(
        CurrentContext memory context,
        address account, //TODO: use for onbehalf of?
        Fixed18 positionAmount,
        Fixed18 collateralAmount,
        bool force
    ) private {
        _startGas(context, "_update before-update-after: %s");

        // before
        if (context.liquidation) revert ProductInLiquidationError();
        if (context.parameter.closed && !_closingNext(context, positionAmount)) revert ProductClosedError();

        // update
        (Fixed18 makerAmount, Fixed18 takerAmount) = context.account.update(
            positionAmount,
            collateralAmount,
            context.currentOracleVersion,
            context.parameter
        );
        context.pre.update(
            makerAmount,
            takerAmount,
            context.currentOracleVersion,
            context.parameter
        );

        // after
        if (!force) _checkPosition(context);
        if (!force) _checkCollateral(context);

        _endGas(context);

        _startGas(context, "_update fund-events: %s");

        // fund
        if (collateralAmount.sign() == 1) token.pull(account, collateralAmount.abs());
        if (collateralAmount.sign() == -1) token.push(account, collateralAmount.abs());

        // events
        emit Updated(account, context.currentOracleVersion.version, positionAmount, collateralAmount);

        _endGas(context);
    }

    function _loadContext(address account) private returns (CurrentContext memory context) {
        _startGas(context, "_loadContext: %s");

        // Load protocol parameters
        context.protocolParameter = controller.parameter();

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
        context.liquidation = liquidation[account]; //TODO: packing into account will save gas on liquidation

        // after
        if (context.protocolParameter.paused) revert ProductPausedError();

        _endGas(context);
    }

    function _saveContext(CurrentContext memory context, address account) private {
        _startGas(context, "_saveContext: %s");

        latestVersion = context.latestVersion;
        latestVersions[account] = context.latestAccountVersion;
        _accounts[account] = context.account;
        liquidation[account] = context.liquidation; //TODO: can pack this in account, only saves gas on liq.
        _pre = context.pre;
        _fee = context.fee;

        _endGas(context);
    }

    function _settle(CurrentContext memory context) private { //TODO: should be pure
        _startGas(context, "_settle: %s");

        // Initialize memory
        Period memory period;
        Version memory fromVersion;
        Version memory toVersion;

        // settle product a->b if necessary
        period.fromVersion = context.latestVersion == context.currentOracleVersion.version ? // TODO: make a lazy loader here
            context.currentOracleVersion :
            atVersion(context.latestVersion);
        period.toVersion = context.latestVersion + 1 == context.currentOracleVersion.version ?
            context.currentOracleVersion :
            atVersion(context.latestVersion + 1);
        _settlePeriod(context, period);

        // settle product b->c if necessary
        period.fromVersion = period.toVersion;
        period.toVersion = context.currentOracleVersion;
        _settlePeriod(context, period);

        // settle account a->b if necessary
        period.toVersion = context.latestAccountVersion + 1 == context.currentOracleVersion.version ?
            context.currentOracleVersion :
            atVersion(context.latestAccountVersion + 1);
        fromVersion = _versions[context.latestAccountVersion];
        toVersion = _versions[context.latestAccountVersion + 1];
        _settlePeriodAccount(context, period, fromVersion, toVersion);

        // settle account b->c if necessary
        period.toVersion = context.currentOracleVersion;
        fromVersion = toVersion;
        toVersion = context.version;
        _settlePeriodAccount(context, period, fromVersion, toVersion);

        _endGas(context);
    }

    function _settlePeriod(CurrentContext memory context, Period memory period) private {
        if (context.currentOracleVersion.version > context.latestVersion) {
            context.version.accumulate(
                context.pre,
                context.fee,
                period,
                context.protocolParameter,
                context.parameter
            );
            context.latestVersion = period.toVersion.version;
            _versions[period.toVersion.version] = context.version;
        }
    }

    function _settlePeriodAccount(
        CurrentContext memory context,
        Period memory period,
        Version memory fromVersion,
        Version memory toVersion
    ) private pure {
        if (context.currentOracleVersion.version > context.latestAccountVersion) {
            context.account.accumulate(fromVersion, toVersion);
            context.latestAccountVersion = period.toVersion.version;
        }
    }

    function _closingNext(CurrentContext memory context, Fixed18 amount) private pure returns (bool) {
        Fixed18 nextAccountPosition = context.account.next();
        if (nextAccountPosition.sign() == 0) return true;
        if (context.account.position().sign() == amount.sign()) return false;
        if (nextAccountPosition.sign() != context.account.position().sign()) return false;
        return true;
    }

    function _checkPosition(CurrentContext memory context) private pure {
        Position memory nextPosition = context.version.position().next(context.pre);

        if (!context.parameter.closed && nextPosition.socializationFactor().lt(UFixed18Lib.ONE))
            revert ProductInsufficientLiquidityError();

        if (nextPosition.maker.gt(context.parameter.makerLimit))
            revert ProductMakerOverLimitError();
    }

    function _checkCollateral(CurrentContext memory context) private pure {
        if (context.account.collateral().sign() == -1) revert ProductInDebtError();

        UFixed18 boundedCollateral = UFixed18Lib.from(context.account.collateral());

        if (!context.account.collateral().isZero() && boundedCollateral.lt(context.protocolParameter.minCollateral))
            revert ProductCollateralUnderLimitError();

        (UFixed18 maintenanceAmount, UFixed18 maintenanceNextAmount) = (
            context.account.maintenance(context.currentOracleVersion, context.parameter.maintenance),
            context.account.maintenanceNext(context.currentOracleVersion, context.parameter.maintenance)
        );
        if (maintenanceAmount.max(maintenanceNextAmount).gt(boundedCollateral))
            revert ProductInsufficientCollateralError();
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
