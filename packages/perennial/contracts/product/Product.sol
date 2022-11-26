// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UReentrancyGuard.sol";
import "../controller/UControllerProvider.sol";
import "./UPayoffProvider.sol";
import "./UParamProvider.sol";
import "./types/Account.sol";
import "./types/OptimisticLedger.sol";

// TODO: position needs less settle on the second period for both global and account
// TODO: lots of params can be passed in from global settle to account settle

/**
 * @title Product
 * @notice Manages logic and state for a single product market.
 * @dev Cloned by the Controller contract to launch new product markets.
 */
contract Product is IProduct, UInitializable, UParamProvider, UPayoffProvider, UReentrancyGuard {
    /// @dev The name of the product
    string public name;

    /// @dev The symbol of the product
    string public symbol;

    /// @dev ERC20 stablecoin for collateral
    Token18 public token;

    /// @dev Per product collateral state
    OptimisticLedger private _collateral;

    /// @dev Protocol and product fees collected, but not yet claimed
    UFixed18 public fees;

    /// @dev The individual state for each account
    mapping(address => Account) private _accounts;

    /// @dev Mapping of the historical version data
    mapping(uint256 => Version) _versions;

    PrePosition private _pre;

    uint256 private _latestVersion;
    mapping(address => uint256) private _latestVersions;

    /// @dev Whether the account is currently locked for liquidation
    mapping(address => bool) public liquidation;

    struct CurrentContext {
        /* Global Parameters */
        IIncentivizer incentivizer;
        bytes12 __unallocated2__;

        UFixed18 maintenance;

        UFixed18 makerFee;

        UFixed18 takerFee;

        UFixed18 makerLimit;

        UFixed18 minCollateral;

        bool closed;
        bytes31 __unallocated3__;

        bool paused;
        bytes31 __unallocated4__;

        /* Current Global State */
        uint256 latestVersion;

        IOracleProvider.OracleVersion oracleVersion;

        Version version;

        /* Current Account State */
        Account account;
        bytes31 __unallocated0__;

        uint256 latestAccountVersion;
    }

    /**
     * @notice Initializes the contract state
     * @param productInfo_ Product initialization params
     */
    function initialize(ProductInfo calldata productInfo_) external initializer(1) {
        __UControllerProvider__initialize(IController(msg.sender));
        __UPayoffProvider__initialize(productInfo_.oracle, productInfo_.payoffDefinition);
        __UReentrancyGuard__initialize();
        __UParamProvider__initialize(
            productInfo_.maintenance,
            productInfo_.fundingFee,
            productInfo_.makerFee,
            productInfo_.takerFee,
            productInfo_.positionFee,
            productInfo_.makerLimit,
            productInfo_.utilizationCurve
        );

        name = productInfo_.name;
        symbol = productInfo_.symbol;
        token = productInfo_.token;
    }

    /**
     * @notice Surfaces global settlement externally
     */
    function settle(address account) external nonReentrant {
        CurrentContext memory context = _settle(account); //TODO: address 0?

        if (context.paused) revert PausedError();
    }

    /**
     * @notice Core global settlement flywheel
     * @dev
     *  a) last settle oracle version
     *  b) latest pre position oracle version
     *  c) current oracle version
     *
     *  Settles from a->b then from b->c if either interval is non-zero to account for a change
     *  in position quantity at (b).
     *
     *  Syncs each to instantaneously after the oracle update.
     */
    function _settle(address account) private returns (CurrentContext memory context) {
        // Load protocol parameters
        UFixed18 minFundingFee;
        (context.incentivizer, minFundingFee, context.minCollateral, context.paused) = controller().settlementParameters();

        // Load product parameters
        UFixed18 fundingFee;
        UFixed18 positionFee;
        (context.maintenance, fundingFee, context.makerFee, context.takerFee, positionFee, context.makerLimit, context.closed) = parameter();
        JumpRateUtilizationCurve memory _utilizationCurve = utilizationCurve();

        // Load product state
        context.oracleVersion = _sync();
        context.latestVersion = latestVersion();
        context.version = _versions[context.latestVersion];

        // Load account state
        context.latestAccountVersion = latestVersion(account);
        context.account = _accounts[account];

        // Sync incentivizer programs
        context.incentivizer.sync(context.oracleVersion); //TODO: why isn't this called twice?

        // Initialize memory
        UFixed18 feeAccumulator;
        Fixed18 valueAccumulator;
        IOracleProvider.OracleVersion memory fromOracleVersion;
        IOracleProvider.OracleVersion memory toOracleVersion;
        Version memory fromVersion;
        Version memory toVersion;

        // settle product a->b if necessary
        if (context.oracleVersion.version > context.latestVersion) {
            fromOracleVersion = atVersion(context.latestVersion);
            toOracleVersion = context.latestVersion + 1 == context.oracleVersion.version ?
                context.oracleVersion :
                atVersion(context.latestVersion + 1);

            (feeAccumulator) = context.version.accumulateAndSettle(
                feeAccumulator,
                pre(),
                Period(fromOracleVersion, toOracleVersion),
                context.makerFee,
                context.takerFee,
                positionFee,
                _utilizationCurve,
                minFundingFee,
                fundingFee,
                context.closed
            );
            _versions[toOracleVersion.version] = context.version;
            delete _pre;
        }

        // settle product b->c if necessary
        if (context.oracleVersion.version > toOracleVersion.version) { // skip is b == c
            fromOracleVersion = toOracleVersion;
            toOracleVersion = context.oracleVersion;
            (feeAccumulator) = context.version.accumulate(
                feeAccumulator,
                Period(fromOracleVersion, toOracleVersion),
                _utilizationCurve,
                minFundingFee,
                fundingFee,
                context.closed
            );
            _versions[context.oracleVersion.version] = context.version;
        }

        // settle account a->b if necessary
        if (context.oracleVersion.version > context.latestAccountVersion) {
            toOracleVersion = context.latestAccountVersion + 1 == context.oracleVersion.version ?
                context.oracleVersion : // if b == c, don't re-call provider for oracle version
                atVersion(context.latestAccountVersion + 1);
            fromVersion = _versions[context.latestAccountVersion];
            toVersion = _versions[context.latestAccountVersion + 1];

            context.incentivizer.syncAccount(account, toOracleVersion);

            valueAccumulator = context.account.accumulate(valueAccumulator, fromVersion, toVersion);

            context.account.settle();
        }

        // settle account b->c if necessary
        if (context.oracleVersion.version > toOracleVersion.version) {
            toOracleVersion = context.oracleVersion;
            fromVersion = toVersion;
            toVersion = context.version;

            context.incentivizer.syncAccount(account, toOracleVersion);

            valueAccumulator = context.account.accumulate(valueAccumulator, fromVersion, toVersion);
        }

        // settle collateral
        _settleFees(feeAccumulator);
        _settleCollateral(account, valueAccumulator);

        // save state
        _latestVersion = context.oracleVersion.version;
        _latestVersions[account] = context.oracleVersion.version;
        _accounts[account] = context.account;

        //TODO: redo events
        // emit events
        emit Settle(fromOracleVersion.version, context.oracleVersion.version);
        emit AccountSettle(account, fromOracleVersion.version, context.oracleVersion.version);
    }

    //TODO: support receiver; forwarder broken
    function update(Fixed18 positionAmount, Fixed18 collateralAmount)
    external
    nonReentrant
    {
        CurrentContext memory context = _settle(msg.sender);

        _before(context, msg.sender, positionAmount);
        _updatePosition(context, msg.sender, positionAmount);
        _updateCollateral(context, msg.sender, collateralAmount);
        _after(context, msg.sender);
    }

    function _before(CurrentContext memory context, address account, Fixed18 positionAmount) private {
        if (context.paused) revert PausedError();
        if (liquidation[account]) revert ProductInLiquidationError();
        if (context.closed && !_closingNext(context, positionAmount)) revert ProductClosedError();
    }

    function _after(CurrentContext memory context, address account) private {
        if (_liquidatable(context, account) || _liquidatableNext(context, account))
            revert ProductInsufficientCollateralError();
        if (_socializationNext(context).lt(UFixed18Lib.ONE)) revert ProductInsufficientLiquidityError();
        if (context.version.position().next(_pre).maker.gt(context.makerLimit)) revert ProductMakerOverLimitError();
        UFixed18 accountCollateral = _collateral.balances[account];
        if (!accountCollateral.isZero() && accountCollateral.lt(controller().minCollateral()))
            revert ProductCollateralUnderLimitError();
    }

    function _updatePosition(CurrentContext memory context, address account, Fixed18 amount) private {
        Fixed18 nextPosition = context.account.next();
        context.account.update(amount);

        _accounts[account] = context.account;
        _pre.update(nextPosition, amount);

        UFixed18 positionFee = amount.mul(context.oracleVersion.price).abs().mul(context.takerFee);
        if (!positionFee.isZero()) _settleCollateral(account, Fixed18Lib.from(-1, positionFee));

        emit PositionUpdated(account, _latestVersion, amount);
    }

    function _updateCollateral(CurrentContext memory context, address account, Fixed18 amount) private {
        _settleCollateral(account, amount, true);
        amount.sign() == 1 ? token.pull(account, amount.abs()) : token.push(account, amount.abs());

        emit CollateralUpdated(account, amount);
    }

    /**
     * @notice Liquidates `account`'s `product` collateral account
     * @dev Account must be under-collateralized, fee returned immediately to `msg.sender`
     * @param account Account to liquidate
     */
    function liquidate(address account)
    external
    nonReentrant
    {
        CurrentContext memory context = _settle(account);

        // Liquidate position
        if (!_liquidatable(context, account)) revert ProductCantLiquidate();

        Fixed18 closeAmount = _accounts[account].position().mul(Fixed18Lib.NEG_ONE);
        _before(context, account, closeAmount);
        _updatePosition(context, account, closeAmount);
        liquidation[account] = true;

        // Dispurse fee
        UFixed18 liquidationFee = controller().liquidationFee();
        UFixed18 accountMaintenance = context.account.maintenance(context.oracleVersion, context.maintenance);
        UFixed18 fee = UFixed18Lib.min(_collateral.balances[account], accountMaintenance.mul(liquidationFee));

        _settleCollateral(account, Fixed18Lib.from(-1, fee));
        token.push(msg.sender, fee);

        emit Liquidation(account, msg.sender, fee);
    }

    /**
     * @notice Returns the maintenance requirement for `account`
     * @param account Account to return for
     * @return The current maintenance requirement
     */
    function maintenance(address account) external view returns (UFixed18) {
        (UFixed18 _maintenance, , , , , , ) = parameter();
        return _accounts[account].maintenance(currentVersion(), _maintenance);
    }

    /**
     * @notice Returns the maintenance requirement for `account` after next settlement
     * @dev Assumes no price change and no funding, used to protect user from over-opening
     * @param account Account to return for
     * @return The next maintenance requirement
     */
    function maintenanceNext(address account) external view returns (UFixed18) {
        (UFixed18 _maintenance, , , , , , ) = parameter();
        return _accounts[account].maintenanceNext(currentVersion(), _maintenance);
    }

    function collateral(address account) external view returns (UFixed18) {
        return _collateral.balances[account];
    }

    /**
     * @notice Returns `account`'s current position
     * @param account Account to return for
     * @return Current position of the account
     */
    function position(address account) external view returns (Fixed18) {
        return _accounts[account].position();
    }

    /**
     * @notice Returns `account`'s current pending-settlement position
     * @param account Account to return for
     * @return Current pre-position of the account
     */
    function pre(address account) external view returns (Fixed18) {
        return _accounts[account].pre();
    }

    /**
     * @notice Returns the global latest settled oracle version
     * @return Latest settled oracle version of the product
     */
    function latestVersion() public view returns (uint256) {
        return _latestVersion;
    }

    function collateral() external view returns (UFixed18) {
        return token.balanceOf().sub(fees);
    }

    function shortfall() external view returns (UFixed18) {
        return _collateral.shortfall;
    }

    /**
     * @notice Returns the global position at oracleVersion `oracleVersion`
     * @dev Only valid for the version at which a global settlement occurred
     * @param oracleVersion Oracle version to return for
     * @return Global position at oracle version
     */
    function positionAtVersion(uint256 oracleVersion) public view returns (Position memory) {
        return _versions[oracleVersion].position();
    }

    /**
     * @notice Returns the current global pending-settlement position
     * @return Global pending-settlement position
     */
    function pre() public view returns (PrePosition memory) {
        return _pre;
    }

    /**
     * @notice Returns the global accumulator value at oracleVersion `oracleVersion`
     * @dev Only valid for the version at which a global settlement occurred
     * @param oracleVersion Oracle version to return for
     * @return Global accumulator value at oracle version
     */
    function valueAtVersion(uint256 oracleVersion) external view returns (Accumulator memory) {
        return _versions[oracleVersion].value();
    }

    /**
     * @notice Returns the global accumulator share at oracleVersion `oracleVersion`
     * @dev Only valid for the version at which a global settlement occurred
     * @param oracleVersion Oracle version to return for
     * @return Global accumulator share at oracle version
     */
    function shareAtVersion(uint256 oracleVersion) external view returns (Accumulator memory) {
        return _versions[oracleVersion].share();
    }

    /**
     * @notice Returns `account`'s latest settled oracle version
     * @param account Account to return for
     * @return Latest settled oracle version of the account
     */
    function latestVersion(address account) public view returns (uint256) {
        return _latestVersions[account];
    }

    /**
     * @notice Returns whether `account`'s `product` collateral account can be liquidated
     *         after the next oracle version settlement
     * @dev Takes into account the current pre-position on the account
     * @param account Account to return for
     * @return Whether the account can be liquidated
     */
    function _liquidatableNext(CurrentContext memory context, address account) private view returns (bool) {
        UFixed18 maintenanceAmount = context.account.maintenanceNext(context.oracleVersion, context.maintenance);
        return maintenanceAmount.gt(_collateral.balances[account]);
    }

    function _liquidatable(CurrentContext memory context, address account) private view returns (bool) {
        UFixed18 maintenanceAmount = context.account.maintenance(context.oracleVersion, context.maintenance);
        return maintenanceAmount.gt(_collateral.balances[account]);
    }

    function liquidatable(address account) public view returns (bool) {
        (UFixed18 _maintenance, , , , , , ) = parameter();
        UFixed18 maintenanceAmount = _accounts[account].maintenance(currentVersion(), _maintenance);
        return maintenanceAmount.gt(_collateral.balances[account]);
    }

    function _socializationNext(CurrentContext memory context) private view returns (UFixed18) {
        if (context.closed) return UFixed18Lib.ONE;
        return context.version.position().next(_pre).socializationFactor();
    }

    function _closingNext(CurrentContext memory context, Fixed18 amount) private view returns (bool) {
        Fixed18 nextAccountPosition = context.account.next();
        if (nextAccountPosition.sign() == 0) return true;
        if (context.account.position().sign() == amount.sign()) return false;
        if (nextAccountPosition.sign() != context.account.position().sign()) return false;
        return true;
    }

    /**
     * @notice Credits `amount` to `account`'s collateral account
     * @dev Callable only by the corresponding product as part of the settlement flywheel.
     *      Moves collateral within a product, any collateral leaving the product due to
     *      fees has already been accounted for in the settleProduct flywheel.
     *      Debits in excess of the account balance get recorded as shortfall, and can be
     *      resolved by the product owner as needed.
     * @param account Account to credit
     * @param amount Amount to credit the account (can be negative)
     */
    function _settleCollateral(address account, Fixed18 amount) private {
        _settleCollateral(account, amount, false);
    }

    function _settleCollateral(address account, Fixed18 amount, bool noShortfall) private {
        UFixed18 newShortfall = _collateral.settleAccount(account, amount);
        if (noShortfall && !newShortfall.isZero()) revert ProductShortfallError();
        emit CollateralSettled(account, amount, newShortfall);
    }

    /**
     * @notice Debits `amount` from product's total collateral account
     * @dev Callable only by the corresponding product as part of the settlement flywheel
     *      Removes collateral from the product as fees.
     * @param amount Amount to debit from the account
     */
    function _settleFees(UFixed18 amount) private {
        (address protocolTreasury, UFixed18 protocolFee) =
            controller().collateralParameters(IProduct(this));

        UFixed18 protocolFeeAmount = amount.mul(protocolFee);
        UFixed18 productFeeAmount = amount.sub(protocolFeeAmount);

        token.push(protocolTreasury, protocolFeeAmount);
        fees = fees.add(productFeeAmount);

        emit FeeSettled(protocolFeeAmount, productFeeAmount);
    }

    function resolveShortfall(UFixed18 amount) external nonReentrant notPaused onlyProductOwner {
        token.pull(msg.sender, amount);
        _collateral.resolve(amount);

        emit ShortfallResolved(amount);
    }
}
