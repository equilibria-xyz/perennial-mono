// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UReentrancyGuard.sol";
import "../controller/UControllerProvider.sol";
import "./UPayoffProvider.sol";
import "./UParamProvider.sol";
import "./types/position/AccountPosition.sol";
import "./types/accumulator/AccountAccumulator.sol";

/**
 * @title Product
 * @notice Manages logic and state for a single product market.
 * @dev Cloned by the Controller contract to launch new product markets.
 */
contract Product is IProduct, UInitializable, UParamProvider, UPayoffProvider, UReentrancyGuard {
    /// @dev Whether or not the product is closed
    BoolStorage private constant _closed =
        BoolStorage.wrap(keccak256("equilibria.perennial.Product.closed"));
    function closed() public view returns (bool) { return _closed.read(); }

    /// @dev The name of the product
    string public name;

    /// @dev The symbol of the product
    string public symbol;

    /// @dev The individual position state for each account
    mapping(address => AccountPosition) private _positions;

    /// @dev The individual accumulator state for each account
    mapping(address => AccountAccumulator) private _accumulators;

    /// @dev Mapping of the historical version data
    mapping(uint256 => Version) _versions;

    PrePosition private _pre;

    uint256 private _latestVersion;

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
            productInfo_.makerLimit,
            productInfo_.utilizationCurve
        );

        name = productInfo_.name;
        symbol = productInfo_.symbol;
    }

    /**
     * @notice Surfaces global settlement externally
     */
    function settle() external nonReentrant notPaused {
        _settle();
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
    function _settle() private returns (IOracleProvider.OracleVersion memory currentOracleVersion) {
        // Determine periods to settle
        currentOracleVersion = _sync();
        Period[] memory periods = _periodsToSettle(currentOracleVersion);
        if (periods.length == 0) return currentOracleVersion;

        // Sync incentivizer programs
        IController _controller = controller();
        _controller.incentivizer().sync(currentOracleVersion);

        // Settle periods
        AccumulatorParams memory params = AccumulatorParams(
            utilizationCurve(),
            fundingFee(),
            makerFee(),
            takerFee(),
            closed()
        );
        UFixed18 accumulatedFee;
        Version memory currentVersion = _versions[periods[0].fromVersion.version];
        for (uint256 i; i < periods.length; i++) {
            (Version memory version, UFixed18 fee, bool settled) = currentVersion.accumulate(pre(), periods[i], params);

            currentVersion = version;
            _versions[periods[i].toVersion.version] = version;

            accumulatedFee = accumulatedFee.add(fee);
            if (settled) delete _pre;
        }
        _latestVersion = currentOracleVersion.version;

        // Settle collateral
        _controller.collateral().settleProduct(accumulatedFee);

        emit Settle(
            periods.length > 0 ? periods[0].toVersion.version : currentOracleVersion.version,
            periods.length > 1 ? periods[1].toVersion.version : periods.length > 0 ? periods[0].toVersion.version : currentOracleVersion.version
        );
    }

    function _periodsToSettle(IOracleProvider.OracleVersion memory currentOracleVersion)
    private view returns (Period[] memory periods) {
        // Get latest oracle version
        if (_latestVersion == currentOracleVersion.version) return periods; // zero periods if a == c
        IOracleProvider.OracleVersion memory latestOracleVersion = atVersion(_latestVersion);

        // Get settle oracle version
        uint256 _settleVersion = _pre.settleVersion(currentOracleVersion.version);
        if (_settleVersion == currentOracleVersion.version) { // one period if b == c
            periods = new Period[](1);
            periods[0] = Period(latestOracleVersion, currentOracleVersion);
        } else { // default to two periods: a->b, b->c
            IOracleProvider.OracleVersion memory settleOracleVersion = atVersion(_settleVersion);

            periods = new Period[](2);
            periods[0] = Period(latestOracleVersion, settleOracleVersion);
            periods[1] = Period(settleOracleVersion, currentOracleVersion);
        }
    }

    /**
    * @notice Surfaces account settlement externally
     * @param account Account to settle
     */
    function settleAccount(address account) external nonReentrant notPaused {
        IOracleProvider.OracleVersion memory currentOracleVersion = _settle();
        _settleAccount(account, currentOracleVersion);
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
    function _settleAccount(address account, IOracleProvider.OracleVersion memory currentOracleVersion) private {
        IController _controller = controller();

        // Get latest oracle version
        if (latestVersion(account) == currentOracleVersion.version) return; // short circuit entirely if a == c

        // Get settle oracle version
        uint256 _settleVersion = _positions[account].pre.settleVersion(currentOracleVersion.version);
        IOracleProvider.OracleVersion memory settleOracleVersion = _settleVersion == currentOracleVersion.version ?
            currentOracleVersion : // if b == c, don't re-call provider for oracle version
            atVersion(_settleVersion);

        // initialize
        UFixed18 makerFee_ = makerFee();
        UFixed18 takerFee_ = takerFee();
        Fixed18 accumulated;

        // sync incentivizer before accumulator
        _controller.incentivizer().syncAccount(account, settleOracleVersion);

        // value a->b
        accumulated = accumulated.add(
            _accumulators[account].syncTo(_versions, _positions[account], settleOracleVersion.version).sum());

        // position a->b
        accumulated = accumulated.sub(Fixed18Lib.from(_positions[account].settle(settleOracleVersion, makerFee_, takerFee_)));

        // short-circuit from a->c if b == c
        if (settleOracleVersion.version != currentOracleVersion.version) {
            // sync incentivizer before accumulator
            _controller.incentivizer().syncAccount(account, currentOracleVersion);

            // value b->c
            accumulated = accumulated.add(
                _accumulators[account].syncTo(_versions, _positions[account], currentOracleVersion.version).sum());
        }

        // settle collateral
        _controller.collateral().settleAccount(account, accumulated);

        emit AccountSettle(account, settleOracleVersion.version, currentOracleVersion.version);
    }

    /**
     * @notice Opens a taker position for `msg.sender`
     * @param amount Amount of the position to open
     */
    function openTake(UFixed18 amount)
    external
    nonReentrant
    notPaused
    notClosed
    settleForAccount(msg.sender)
    takerInvariant
    positionInvariant
    liquidationInvariant
    maintenanceInvariant
    {
        _positions[msg.sender].pre.openTake(_latestVersion, amount);
        _pre.openTake(_latestVersion, amount);

        emit TakeOpened(msg.sender, _latestVersion, amount);
    }

    /**
     * @notice Closes a taker position for `msg.sender`
     * @param amount Amount of the position to close
     */
    function closeTake(UFixed18 amount)
    external
    nonReentrant
    notPaused
    settleForAccount(msg.sender)
    closeInvariant
    liquidationInvariant
    {
        _closeTake(msg.sender, amount);
    }

    function _closeTake(address account, UFixed18 amount) private {
        _positions[account].pre.closeTake(_latestVersion, amount);
        _pre.closeTake(_latestVersion, amount);

        emit TakeClosed(account, _latestVersion, amount);
    }

    /**
     * @notice Opens a maker position for `msg.sender`
     * @param amount Amount of the position to open
     */
    function openMake(UFixed18 amount)
    external
    nonReentrant
    notPaused
    notClosed
    settleForAccount(msg.sender)
    nonZeroVersionInvariant
    makerInvariant
    positionInvariant
    liquidationInvariant
    maintenanceInvariant
    {
        _positions[msg.sender].pre.openMake(_latestVersion, amount);
        _pre.openMake(_latestVersion, amount);

        emit MakeOpened(msg.sender, _latestVersion, amount);
    }

    /**
     * @notice Closes a maker position for `msg.sender`
     * @param amount Amount of the position to close
     */
    function closeMake(UFixed18 amount)
    external
    nonReentrant
    notPaused
    settleForAccount(msg.sender)
    takerInvariant
    closeInvariant
    liquidationInvariant
    {
        _closeMake(msg.sender, amount);
    }

    function _closeMake(address account, UFixed18 amount) private {
        _positions[account].pre.closeMake(_latestVersion, amount);
        _pre.closeMake(_latestVersion, amount);

        emit MakeClosed(account, _latestVersion, amount);
    }

    /**
     * @notice Closes all open and pending positions, locking for liquidation
     * @dev Only callable by the Collateral contract as part of the liquidation flow
     * @param account Account to close out
     */
    function closeAll(address account) external onlyCollateral notClosed settleForAccount(account) {
        AccountPosition storage accountPosition = _positions[account];
        Position memory p = accountPosition.position.next(_positions[account].pre);

        // Close all positions
        _closeMake(account, p.maker);
        _closeTake(account, p.taker);

        // Mark liquidation to lock position
        accountPosition.liquidation = true;
    }

    /**
     * @notice Returns the maintenance requirement for `account`
     * @param account Account to return for
     * @return The current maintenance requirement
     */
    function maintenance(address account) external view returns (UFixed18) {
        return _positions[account].maintenance();
    }

    /**
     * @notice Returns the maintenance requirement for `account` after next settlement
     * @dev Assumes no price change and no funding, used to protect user from over-opening
     * @param account Account to return for
     * @return The next maintenance requirement
     */
    function maintenanceNext(address account) external view returns (UFixed18) {
        return _positions[account].maintenanceNext();
    }

    /**
     * @notice Returns whether `account` has a completely zero'd position
     * @param account Account to return for
     * @return The the account is closed
     */
    function isClosed(address account) external view returns (bool) {
        return _positions[account].isClosed();
    }

    /**
     * @notice Returns whether `account` is currently locked for an in-progress liquidation
     * @param account Account to return for
     * @return Whether the account is in liquidation
     */
    function isLiquidating(address account) external view returns (bool) {
        return _positions[account].liquidation;
    }

    /**
     * @notice Returns `account`'s current position
     * @param account Account to return for
     * @return Current position of the account
     */
    function position(address account) external view returns (Position memory) {
        return _positions[account].position;
    }

    /**
     * @notice Returns `account`'s current pending-settlement position
     * @param account Account to return for
     * @return Current pre-position of the account
     */
    function pre(address account) external view returns (PrePosition memory) {
        return _positions[account].pre;
    }

    /**
     * @notice Returns the global latest settled oracle version
     * @return Latest settled oracle version of the product
     */
    function latestVersion() external view returns (uint256) {
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
        return _accumulators[account].latestVersion;
    }

    /**
     * @notice Updates product closed state
     * @dev only callable by product owner. Settles the product before flipping the flag
     * @param newClosed new closed value
     */
    function updateClosed(bool newClosed) external onlyProductOwner {
        IOracleProvider.OracleVersion memory oracleVersion = _settle();
        _closed.store(newClosed);
        emit ClosedUpdated(newClosed, oracleVersion.version);
    }

    /// @dev Limit total maker for guarded rollouts
    modifier makerInvariant {
        _;

        Position memory next = positionAtVersion(_latestVersion).next(_pre);

        if (next.maker.gt(makerLimit())) revert ProductMakerOverLimitError();
    }

    /// @dev Limit maker short exposure to the range 0.0-1.0x of their position. Does not apply when in closeOnly state
    modifier takerInvariant {
        _;

        if (closed()) return;

        Position memory next = positionAtVersion(_latestVersion).next(_pre);
        UFixed18 socializationFactor = next.socializationFactor();

        if (socializationFactor.lt(UFixed18Lib.ONE)) revert ProductInsufficientLiquidityError(socializationFactor);
    }

    /// @dev Ensure that the user has only taken a maker or taker position, but not both
    modifier positionInvariant {
        _;

        if (_positions[msg.sender].isDoubleSided()) revert ProductDoubleSidedError();
    }

    /// @dev Ensure that the user hasn't closed more than is open
    modifier closeInvariant {
        _;

        if (_positions[msg.sender].isOverClosed()) revert ProductOverClosedError();
    }

    /// @dev Ensure that the user will have sufficient margin for maintenance after next settlement
    modifier maintenanceInvariant {
        _;

        if (controller().collateral().liquidatableNext(msg.sender, IProduct(this)))
            revert ProductInsufficientCollateralError();
    }

    /// @dev Ensure that the user is not currently being liquidated
    modifier liquidationInvariant {
        if (_positions[msg.sender].liquidation) revert ProductInLiquidationError();

        _;
    }

    /// @dev Helper to fully settle an account's state
    modifier settleForAccount(address account) {
        IOracleProvider.OracleVersion memory _currentVersion = _settle();
        _settleAccount(account, _currentVersion);

        _;
    }

    /// @dev Ensure we have bootstraped the oracle before creating positions
    modifier nonZeroVersionInvariant {
        if (_latestVersion == 0) revert ProductOracleBootstrappingError();

        _;
    }

    /// @dev Ensure the product is not closed
    modifier notClosed {
        if (closed()) revert ProductClosedError();

        _;
    }
}
