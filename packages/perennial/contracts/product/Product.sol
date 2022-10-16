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

    /// @dev The individual state for each account
    mapping(address => Account) private _accounts;

    /// @dev Mapping of the historical version data
    mapping(uint256 => Version) _versions;

    PrePosition private _pre;
    mapping(address => PrePosition) private _pres;

    uint256 private _latestVersion;
    mapping(address => uint256) private _latestVersions;

    struct CurrentContext {
        Account account;
        bytes31 __unallocated0__;
        ICollateral collateral;
        bytes12 __unallocated1__;
        IIncentivizer incentivizer;
        bytes12 __unallocated2__;
        IOracleProvider.OracleVersion oracleVersion;
        Version version;
        UFixed18 maintenance;
        UFixed18 fundingFee;
        UFixed18 makerFee;
        UFixed18 takerFee;
        UFixed18 positionFee;
        bool closed;
        bytes31 __unallocated3__;
        bool paused;
        bytes31 __unallocated4__;
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
    }

    /**
     * @notice Surfaces global settlement externally
     */
    function settle() external nonReentrant {
        CurrentContext memory context = _settle();

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
    function _settle() private returns (CurrentContext memory context) {
        UFixed18 minFundingFee;
        (context.collateral, context.incentivizer, minFundingFee, context.paused) =
            (controller().collateral(), controller().incentivizer(), controller().minFundingFee(), controller().paused());

        // Determine periods to settle
        context.oracleVersion = _sync();
        context.version = _versions[_latestVersion];
        if (context.oracleVersion.version == _latestVersion) return context; // zero periods if a == c

        // Sync incentivizer programs
        context.incentivizer.sync(context.oracleVersion);

        // Load version data into memory
        IOracleProvider.OracleVersion memory latestOracleVersion = atVersion(_latestVersion);
        IOracleProvider.OracleVersion memory settleOracleVersion =
            _latestVersion + 1 == context.oracleVersion.version ?
                context.oracleVersion :
                atVersion(_latestVersion + 1);

        // Load parameters
        UFixed18 fundingFee;
        UFixed18 positionFee;
        (
            context.maintenance,
            fundingFee,
            context.makerFee,
            context.takerFee,
            positionFee,
            context.closed
        ) = parameter();
        UFixed18 feeAccumulator;
        VersionLib.ProductParams memory params = VersionLib.ProductParams(utilizationCurve(), minFundingFee, fundingFee, context.closed); // TODO: remove?

        // a->b (and settle)
        (context.version, feeAccumulator) = context.version.accumulateAndSettle(
            feeAccumulator,
            pre(),
            Period(latestOracleVersion, settleOracleVersion),
            context.makerFee,
            context.takerFee,
            positionFee,
            params
        );
        _versions[settleOracleVersion.version] = context.version;

        // b->c
        if (settleOracleVersion.version != context.oracleVersion.version) { // skip is b == c
            (context.version, feeAccumulator) = context.version.accumulate(
                feeAccumulator,
                Period(settleOracleVersion, context.oracleVersion),
                params
            );
            _versions[context.oracleVersion.version] = context.version;
        }

        // Settle collateral
        context.collateral.settleProduct(feeAccumulator);

        // Save state
        _latestVersion = context.oracleVersion.version;
        delete _pre;

        emit Settle(settleOracleVersion.version, context.oracleVersion.version);
    }

    /**
    * @notice Surfaces account settlement externally
     * @param account Account to settle
     */
    function settleAccount(address account) external nonReentrant {
        CurrentContext memory context = _settle();
        _settleAccount(account, context);

        if (context.paused) revert PausedError();
    }

    /**
     * @notice Core account settlement flywheel
     * @notice Core account settlement flywheel
     * @param account Account to settle
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
    function _settleAccount(address account, CurrentContext memory context) private {
        // Get latest oracle version
        uint256 latestVersion_ = latestVersion(account);
        if (latestVersion_ == context.oracleVersion.version) return; // short circuit entirely if a == c

        // Get settle oracle version
        uint256 _settleVersion = latestVersion_ + 1;
        IOracleProvider.OracleVersion memory settleOracleVersion =
            _settleVersion == context.oracleVersion.version ?
                context.oracleVersion : // if b == c, don't re-call provider for oracle version
                atVersion(_settleVersion);
        Version memory settleVersion = _versions[_settleVersion];

        // initialize
        Fixed18 valueAccumulator;
        context.account = _accounts[account];

        // sync incentivizer before accumulator
        context.incentivizer.syncAccount(account, settleOracleVersion);

        // account a->b
        (context.account, valueAccumulator) =
            context.account.accumulateAndSettle(valueAccumulator, _pres[account], _versions[latestVersion_], settleVersion);

        // short-circuit from a->c if b == c
        if (settleOracleVersion.version != context.oracleVersion.version) {
            // sync incentivizer before accumulator
            context.incentivizer.syncAccount(account, context.oracleVersion);

            // account b->c
            (valueAccumulator) = context.account.accumulate(valueAccumulator, settleVersion, context.version);
        }

        // settle collateral
        context.collateral.settleAccount(account, valueAccumulator);

        // save state
        _latestVersions[account] = context.oracleVersion.version;
        _accounts[account] = context.account;
        delete _pres[account];

        emit AccountSettle(account, settleOracleVersion.version, context.oracleVersion.version);
    }

    /**
     * @notice Opens a taker position for `msg.sender`
     * @param amount Amount of the position to open
     */
    function openTake(UFixed18 amount)
    external
    nonReentrant
    positionInvariant
    {
        CurrentContext memory context = _settle();
        _settleAccount(msg.sender, context);

        if (context.paused) revert PausedError();
        if (context.closed) revert ProductClosedError();
        if (context.account.liquidation) revert ProductInLiquidationError();

        _pres[msg.sender].openTake(amount);
        _pre.openTake(amount);

        UFixed18 positionFee = amount.mul(context.oracleVersion.price.abs()).mul(context.takerFee);
        if (!positionFee.isZero()) context.collateral.settleAccount(msg.sender, Fixed18Lib.from(-1, positionFee));

        if (_liquidatableNext(context, msg.sender)) revert ProductInsufficientCollateralError();
        if (_socializationNext(context).lt(UFixed18Lib.ONE)) revert ProductInsufficientLiquidityError();

        emit TakeOpened(msg.sender, _latestVersion, amount);
    }

    /**
     * @notice Closes a taker position for `msg.sender`
     * @param amount Amount of the position to close
     */
    function closeTake(UFixed18 amount)
    external
    nonReentrant
    closeInvariant
    {
        CurrentContext memory context = _settle();
        _settleAccount(msg.sender, context);

        if (context.paused) revert PausedError();
        if (context.account.liquidation) revert ProductInLiquidationError();

        _closeTake(context, msg.sender, amount);
    }

    function _closeTake(CurrentContext memory context, address account, UFixed18 amount) private {
        _pres[account].closeTake(amount);
        _pre.closeTake(amount);

        UFixed18 positionFee = amount.mul(context.oracleVersion.price.abs()).mul(context.takerFee);
        if (!positionFee.isZero()) context.collateral.settleAccount(account, Fixed18Lib.from(-1, positionFee));

        emit TakeClosed(account, _latestVersion, amount);
    }

    /**
     * @notice Opens a maker position for `msg.sender`
     * @param amount Amount of the position to open
     */
    function openMake(UFixed18 amount)
    external
    nonReentrant
    makerInvariant
    positionInvariant
    {
        CurrentContext memory context = _settle();
        _settleAccount(msg.sender, context);

        if (context.paused) revert PausedError();
        if (context.closed) revert ProductClosedError();
        if (context.account.liquidation) revert ProductInLiquidationError();

        _pres[msg.sender].openMake(amount);
        _pre.openMake(amount);

        UFixed18 positionFee = amount.mul(context.oracleVersion.price.abs()).mul(context.makerFee);
        if (!positionFee.isZero()) context.collateral.settleAccount(msg.sender, Fixed18Lib.from(-1, positionFee));

        if (_liquidatableNext(context, msg.sender)) revert ProductInsufficientCollateralError();

        emit MakeOpened(msg.sender, _latestVersion, amount);
    }

    /**
     * @notice Closes a maker position for `msg.sender`
     * @param amount Amount of the position to close
     */
    function closeMake(UFixed18 amount)
    external
    nonReentrant
    closeInvariant
    {
        CurrentContext memory context = _settle();
        _settleAccount(msg.sender, context);

        if (context.paused) revert PausedError();
        if (context.account.liquidation) revert ProductInLiquidationError();

        _closeMake(context, msg.sender, amount);

        if (_socializationNext(context).lt(UFixed18Lib.ONE)) revert ProductInsufficientLiquidityError();
    }

    function _closeMake(CurrentContext memory context, address account, UFixed18 amount) private {
        _pres[account].closeMake(amount);
        _pre.closeMake(amount);

        UFixed18 positionFee = amount.mul(context.oracleVersion.price.abs()).mul(context.makerFee);
        if (!positionFee.isZero()) context.collateral.settleAccount(account, Fixed18Lib.from(-1, positionFee));

        emit MakeClosed(account, _latestVersion, amount);
    }

    /**
     * @notice Closes all open and pending positions, locking for liquidation
     * @dev Only callable by the Collateral contract as part of the liquidation flow
     * @param account Account to close out
     */
    function closeAll(address account) external onlyCollateral {
        CurrentContext memory context = _settle();
        _settleAccount(account, context);

        if (context.closed) revert ProductClosedError();

        Account storage account_ = _accounts[account];
        Position memory position_ = account_.position.next(_pres[account]);

        // Close all positions
        _closeMake(context, account, position_.maker);
        _closeTake(context, account, position_.taker);

        // Mark liquidation to lock position
        account_.liquidation = true;
    }

    /**
     * @notice Returns the maintenance requirement for `account`
     * @param account Account to return for
     * @return The current maintenance requirement
     */
    function maintenance(address account) public view returns (UFixed18) {
        (UFixed18 _maintenance, , , , , ) = parameter();
        return _accounts[account].maintenance(currentVersion(), _maintenance);
    }

    /**
     * @notice Returns the maintenance requirement for `account` after next settlement
     * @dev Assumes no price change and no funding, used to protect user from over-opening
     * @param account Account to return for
     * @return The next maintenance requirement
     */
    function maintenanceNext(address account) public view returns (UFixed18) {
        (UFixed18 _maintenance, , , , , ) = parameter();
        return _accounts[account].maintenanceNext(_pres[account], currentVersion(), _maintenance);
    }

    /**
     * @notice Returns whether `account` is currently locked for an in-progress liquidation
     * @param account Account to return for
     * @return Whether the account is in liquidation
     */
    function isLiquidating(address account) external view returns (bool) {
        return _accounts[account].liquidation;
    }

    /**
     * @notice Returns `account`'s current position
     * @param account Account to return for
     * @return Current position of the account
     */
    function position(address account) external view returns (Position memory) {
        return _accounts[account].position;
    }

    /**
     * @notice Returns `account`'s current pending-settlement position
     * @param account Account to return for
     * @return Current pre-position of the account
     */
    function pre(address account) external view returns (PrePosition memory) {
        return _pres[account];
    }

    /**
     * @notice Returns the global latest settled oracle version
     * @return Latest settled oracle version of the product
     */
    function latestVersion() public view returns (uint256) {
        return _latestVersion;
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
        UFixed18 maintenanceAmount = context.account.maintenanceNext(_pres[account], context.oracleVersion, context.maintenance);
        return maintenanceAmount.gt(context.collateral.collateral(account, IProduct(this)));
    }

    function _socializationNext(CurrentContext memory context) private view returns (UFixed18) {
        if (context.closed) return UFixed18Lib.ONE;
        return context.version.position().next(_pre).socializationFactor();
    }

    /// @dev Limit total maker for guarded rollouts
    modifier makerInvariant {
        _;

        Position memory next = positionAtVersion(_latestVersion).next(_pre);

        if (next.maker.gt(makerLimit())) revert ProductMakerOverLimitError();
    }

    /// @dev Ensure that the user has only taken a maker or taker position, but not both
    modifier positionInvariant {
        _;

        if (_accounts[msg.sender].isDoubleSided(_pres[msg.sender])) revert ProductDoubleSidedError();
    }

    /// @dev Ensure that the user hasn't closed more than is open
    modifier closeInvariant {
        _;

        if (_accounts[msg.sender].isOverClosed(_pres[msg.sender])) revert ProductOverClosedError();
    }
}
