// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UReentrancyGuard.sol";
import "../controller/UControllerProvider.sol";
import "./UPayoffProvider.sol";
import "./UParamProvider.sol";
import "./types/Account.sol";

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

    /// @dev Protocol and product fees collected, but not yet claimed
    UFixed18 public productFees;

    /// @dev Protocol and protocol fees collected, but not yet claimed
    UFixed18 public protocolFees;

    /// @dev The individual state for each account
    mapping(address => Account) private _accounts;

    /// @dev Mapping of the historical version data
    mapping(uint256 => Version) _versions;

    PrePosition private _pre;

    uint256 private _latestVersion;
    mapping(address => uint256) private _latestVersions;

    /// @dev Total ledger collateral shortfall
    UFixed18 public shortfall;

    /// @dev Whether the account is currently locked for liquidation
    mapping(address => bool) public liquidation;

    struct CurrentContext {
        /* Global Parameters */
        IIncentivizer incentivizer;
        bytes12 __unallocated2__;

        UFixed18 minFundingFee;

        UFixed18 minCollateral;

        address protocolTreasury;

        UFixed18 protocolFee;

        bool paused;
        bytes31 __unallocated4__;

        /* Product Parameters */

        UFixed18 maintenance;

        UFixed18 fundingFee;

        UFixed18 makerFee;

        UFixed18 takerFee;

        UFixed18 positionFee;

        UFixed18 makerLimit;

        JumpRateUtilizationCurve utilizationCurve;

        bool closed;
        bytes31 __unallocated3__;

        /* Current Global State */
        uint256 latestVersion;

        IOracleProvider.OracleVersion currentOracleVersion;

        Version version;

        PrePosition pre;

        UFixed18 productFees;

        UFixed18 protocolFees;

        UFixed18 shortfall;

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
        //TODO: address 0?

        // Load state into memory
        CurrentContext memory context = _loadContext(account);

        if (context.paused) revert PausedError();

        // Transform state in memory
        _settleInMem(context, account);

        _saveContext(context, account);

        if (context.paused) revert PausedError();
    }

    function _loadContext(address account) private returns (CurrentContext memory context) {
        // Load protocol parameters
        (context.incentivizer, context.minFundingFee, context.minCollateral, context.paused, context.protocolTreasury, context.protocolFee) = controller().settlementParameters();

        // Load product parameters
        (context.maintenance, context.fundingFee, context.makerFee, context.takerFee, context.positionFee, context.makerLimit, context.closed) = parameter();
        context.utilizationCurve = utilizationCurve();

        // Load product state
        context.currentOracleVersion = _sync();
        context.latestVersion = latestVersion();
        context.version = _versions[context.latestVersion];
        context.pre = pre();
        context.productFees = productFees;
        context.protocolFees = protocolFees;
        context.shortfall = shortfall;

        // Load account state
        context.latestAccountVersion = latestVersion(account);
        context.account = _accounts[account];
    }

    function _saveContext(CurrentContext memory context, address account) private {
        _latestVersion = context.currentOracleVersion.version; //TODO: depdup these with the stand-alone ones?
        _latestVersions[account] = context.currentOracleVersion.version;
        _accounts[account] = context.account;
        _pre = context.pre;
        shortfall = context.shortfall;
        productFees = context.productFees;
        protocolFees = context.protocolFees;
    }

    function _settleInMem(CurrentContext memory context, address account) private {
        // Initialize memory
        UFixed18 feeAccumulator;
        UFixed18 shortfallAccumulator;
        IOracleProvider.OracleVersion memory fromOracleVersion;
        IOracleProvider.OracleVersion memory toOracleVersion;
        Version memory fromVersion;
        Version memory toVersion;

        // Sync incentivizer programs
        context.incentivizer.sync(context.currentOracleVersion); //TODO: why isn't this called twice?

        // settle product a->b if necessary
        if (context.currentOracleVersion.version > context.latestVersion) {
            fromOracleVersion = atVersion(context.latestVersion);
            toOracleVersion = context.latestVersion + 1 == context.currentOracleVersion.version ?
            context.currentOracleVersion :
            atVersion(context.latestVersion + 1);

            (feeAccumulator) = context.version.accumulateAndSettle(
                feeAccumulator,
                context.pre,
                Period(fromOracleVersion, toOracleVersion), //TODO: remove period
                context.makerFee,
                context.takerFee,
                context.positionFee,
                context.utilizationCurve,
                context.minFundingFee,
                context.fundingFee,
                context.closed
            );
            _versions[toOracleVersion.version] = context.version;
        }

        // settle product b->c if necessary
        if (context.currentOracleVersion.version > toOracleVersion.version) { // skip is b == c
            fromOracleVersion = toOracleVersion;
            toOracleVersion = context.currentOracleVersion;
            (feeAccumulator) = context.version.accumulate(
                feeAccumulator,
                Period(fromOracleVersion, toOracleVersion),
                context.utilizationCurve,
                context.minFundingFee,
                context.fundingFee,
                context.closed
            );
            _versions[context.currentOracleVersion.version] = context.version;
        }

        // settle account a->b if necessary
        if (context.currentOracleVersion.version > context.latestAccountVersion) {
            toOracleVersion = context.latestAccountVersion + 1 == context.currentOracleVersion.version ?
            context.currentOracleVersion : // if b == c, don't re-call provider for oracle version
            atVersion(context.latestAccountVersion + 1);
            fromVersion = _versions[context.latestAccountVersion];
            toVersion = _versions[context.latestAccountVersion + 1];

            context.incentivizer.syncAccount(account, toOracleVersion);

            shortfallAccumulator = context.account.accumulate(shortfallAccumulator, fromVersion, toVersion);

            context.account.settle();
        }

        // settle account b->c if necessary
        if (context.currentOracleVersion.version > toOracleVersion.version) {
            toOracleVersion = context.currentOracleVersion;
            fromVersion = toVersion;
            toVersion = context.version;

            context.incentivizer.syncAccount(account, toOracleVersion);

            shortfallAccumulator = context.account.accumulate(shortfallAccumulator, fromVersion, toVersion);
        }

        // save accumulator data
        UFixed18 protocolFeeAmount = feeAccumulator.mul(context.protocolFee);
        UFixed18 productFeeAmount = feeAccumulator.sub(protocolFeeAmount);
        context.protocolFees = context.protocolFees.add(productFeeAmount);
        context.productFees = context.productFees.add(productFeeAmount);
        context.shortfall = context.shortfall.add(shortfallAccumulator);
    }

    //TODO support depositTo and withdrawTo
    function update(Fixed18 positionAmount, Fixed18 collateralAmount) external nonReentrant {
        _update(msg.sender, positionAmount, collateralAmount, false);
    }

    function _update(address account, Fixed18 positionAmount, Fixed18 collateralAmount, bool force) private returns (CurrentContext memory context) {
        // TODO: remove
        UFixed18 shortfallAccumulator;

        // Load state into memory
        context = _loadContext(account);

        // Transform state in memory
        _settleInMem(context, account);

        // before
        if (context.paused) revert PausedError();
        if (liquidation[account]) revert ProductInLiquidationError(); //TODO: state read here
        if (context.closed && !_closingNext(context, positionAmount)) revert ProductClosedError();

        // position
        Fixed18 nextPosition = context.account.next();
        UFixed18 positionFee = positionAmount.mul(context.currentOracleVersion.price).abs().mul(context.takerFee);

        context.account.update(positionAmount);
        context.pre.update(nextPosition, positionAmount);
        shortfallAccumulator = context.account.settleCollateral(shortfallAccumulator, Fixed18Lib.from(-1, positionFee));
        shortfallAccumulator = context.account.settleCollateral(shortfallAccumulator, collateralAmount); //TODO: these should combine with update

        _saveContext(context, account);

        if (collateralAmount.sign() == 1) token.pull(account, collateralAmount.abs());
        if (collateralAmount.sign() == -1) token.push(account, collateralAmount.abs());

        // after
        if (!shortfallAccumulator.isZero()) revert ProductShortfallError();
        if (_liquidatable(context) || _liquidatableNext(context)) revert ProductInsufficientCollateralError();
        if (!force && _socializationNext(context).lt(UFixed18Lib.ONE)) revert ProductInsufficientLiquidityError();
        if (context.version.position().next(context.pre).maker.gt(context.makerLimit)) revert ProductMakerOverLimitError();
        if (!context.account.collateral.isZero() && context.account.collateral.lt(context.minCollateral)) revert ProductCollateralUnderLimitError();

        // events
        emit PositionUpdated(account, context.currentOracleVersion.version, positionAmount);
        emit CollateralUpdated(account, collateralAmount);
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
        // close open position
        Fixed18 closeAmount = _accounts[account].position().mul(Fixed18Lib.NEG_ONE);
        CurrentContext memory context = _update(account, closeAmount, Fixed18Lib.ZERO, true);

        // save state
        if (!_liquidatable(context)) revert ProductCantLiquidate();
        liquidation[account] = true;

        // Dispurse fee
        // TODO: cleanup
        UFixed18 liquidationFee = controller().liquidationFee();
        UFixed18 accountMaintenance = context.account.maintenance(context.currentOracleVersion, context.maintenance);
        UFixed18 fee = UFixed18Lib.min(context.account.collateral, accountMaintenance.mul(liquidationFee));
        context.account.settleCollateral(UFixed18Lib.ZERO, Fixed18Lib.from(-1, fee)); // no shortfall
        _accounts[account] = context.account;
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
        return _accounts[account].collateral;
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
        return token.balanceOf().sub(productFees).sub(protocolFees);
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
     * @return Whether the account can be liquidated
     */
    function _liquidatableNext(CurrentContext memory context) private pure returns (bool) {
        UFixed18 maintenanceAmount = context.account.maintenanceNext(context.currentOracleVersion, context.maintenance);
        return maintenanceAmount.gt(context.account.collateral);
    }

    function _liquidatable(CurrentContext memory context) private pure returns (bool) {
        UFixed18 maintenanceAmount = context.account.maintenance(context.currentOracleVersion, context.maintenance);
        return maintenanceAmount.gt(context.account.collateral);
    }

    function liquidatable(address account) public view returns (bool) {
        (UFixed18 _maintenance, , , , , , ) = parameter();
        Account memory _account = _accounts[account];
        UFixed18 maintenanceAmount = _account.maintenance(currentVersion(), _maintenance);
        return maintenanceAmount.gt(_account.collateral);
    }

    function _socializationNext(CurrentContext memory context) private pure returns (UFixed18) {
        if (context.closed) return UFixed18Lib.ONE;
        return context.version.position().next(context.pre).socializationFactor();
    }

    function _closingNext(CurrentContext memory context, Fixed18 amount) private pure returns (bool) {
        Fixed18 nextAccountPosition = context.account.next();
        if (nextAccountPosition.sign() == 0) return true;
        if (context.account.position().sign() == amount.sign()) return false;
        if (nextAccountPosition.sign() != context.account.position().sign()) return false;
        return true;
    }

    function resolveShortfall(UFixed18 amount) external nonReentrant notPaused onlyProductOwner {
        token.pull(msg.sender, amount);
        shortfall = shortfall.sub(amount);

        emit ShortfallResolved(amount);
    }
}
