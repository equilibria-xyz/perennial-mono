// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

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
    BoolStorage private constant _closed = BoolStorage.wrap(keccak256("equilibria.perennial.Product.closed"));

    function closed() public view returns (bool) {
        return _closed.read();
    }

    /// @dev The name of the product
    string public name;

    /// @dev The symbol of the product
    string public symbol;

    /// @dev The individual position state for each account
    mapping(address => AccountPosition) private _positions;

    /// @dev The global position state for the product
    VersionedPosition private _position;

    /// @dev The individual accumulator state for each account
    mapping(address => AccountAccumulator) private _accumulators;

    /// @dev The global accumulator state for the product
    VersionedAccumulator private _accumulator;

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
        IController _controller = controller();

        // Get current oracle version
        currentOracleVersion = _sync();

        // Get latest oracle version
        uint256 _latestVersion = latestVersion();
        if (_latestVersion == currentOracleVersion.version) return currentOracleVersion; // short circuit entirely if a == c
        IOracleProvider.OracleVersion memory latestOracleVersion = atVersion(_latestVersion);

        // Get settle oracle version
        uint256 _settleVersion = _position.pre.settleVersion(currentOracleVersion.version);
        IOracleProvider.OracleVersion memory settleOracleVersion = _settleVersion == currentOracleVersion.version
            ? currentOracleVersion // if b == c, don't re-call provider for oracle version
            : atVersion(_settleVersion);

        // Initiate
        _controller.incentivizer().sync(currentOracleVersion);
        UFixed18 boundedFundingFee = _boundedFundingFee();

        // value a->b
        UFixed18 accumulatedFee = _accumulator.accumulate(
            boundedFundingFee, _position, latestOracleVersion, settleOracleVersion);

        // position a->b
        _position.settle(_latestVersion, settleOracleVersion);

        // Apply any pending fee updates if present
        _settleFeeUpdates();

        // short-circuit from a->c if b == c
        if (settleOracleVersion.version != currentOracleVersion.version) {
            // value b->c
            accumulatedFee = accumulatedFee.add(
                _accumulator.accumulate(boundedFundingFee, _position, settleOracleVersion, currentOracleVersion)
            );

            // position b->c (every accumulator version needs a position stamp)
            _position.settle(settleOracleVersion.version, currentOracleVersion);
        }

        // settle collateral
        _controller.collateral().settleProduct(accumulatedFee);

        emit Settle(settleOracleVersion.version, currentOracleVersion.version);
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
        IOracleProvider.OracleVersion memory settleOracleVersion = _settleVersion == currentOracleVersion.version
            ? currentOracleVersion // if b == c, don't re-call provider for oracle version
            : atVersion(_settleVersion);

        // sync incentivizer before accumulator
        _controller.incentivizer().syncAccount(account, settleOracleVersion);

        // value a->b
        Fixed18 accumulated = _accumulators[account].syncTo(
            _accumulator, _positions[account], settleOracleVersion.version).sum();

        // position a->b
        _positions[account].settle(settleOracleVersion);

        // short-circuit from a->c if b == c
        if (settleOracleVersion.version != currentOracleVersion.version) {
            // sync incentivizer before accumulator
            _controller.incentivizer().syncAccount(account, currentOracleVersion);

            // value b->c
            accumulated = accumulated.add(
                _accumulators[account].syncTo(_accumulator, _positions[account], currentOracleVersion.version).sum()
            );
        }

        // settle collateral
        _controller.collateral().settleAccount(account, accumulated);

        emit AccountSettle(account, settleOracleVersion.version, currentOracleVersion.version);
    }

    /**
     * @notice Opens a taker position for `msg.sender`
     * @param amount Amount of the position to open
     */
    function openTake(UFixed18 amount) external {
        openTakeFor(msg.sender, amount);
    }

    /**
     * @notice Opens a taker position for `account`. Deducts position fee based on notional value at `latestVersion`
     * @param account Account to open the position for
     * @param amount Amount of the position to open
     */
    function openTakeFor(address account, UFixed18 amount)
        public
        nonReentrant
        notPaused
        notClosed
        onlyAccountOrMultiInvoker(account)
        settleForAccount(account)
        maxUtilizationInvariant
        positionInvariant(account)
        liquidationInvariant(account)
        maintenanceInvariant(account)
    {
        IOracleProvider.OracleVersion memory latestOracleVersion = atVersion(latestVersion());

        _positions[account].pre.openTake(latestOracleVersion.version, amount);
        _position.pre.openTake(latestOracleVersion.version, amount);

        UFixed18 positionFee = amount.mul(latestOracleVersion.price.abs()).mul(takerFee());
        if (!positionFee.isZero()) {
            controller().collateral().settleAccount(account, Fixed18Lib.from(-1, positionFee));
            emit PositionFeeCharged(account, latestOracleVersion.version, positionFee);
        }

        emit PositionFeeCharged(account, latestOracleVersion.version, positionFee);
        emit TakeOpened(account, latestOracleVersion.version, amount);
    }

    /**
     * @notice Closes a taker position for `msg.sender`
     * @param amount Amount of the position to close
     */
    function closeTake(UFixed18 amount) external {
        closeTakeFor(msg.sender, amount);
    }

    /**
     * @notice Closes a taker position for `account`. Deducts position fee based on notional value at `latestVersion`
     * @param account Account to close the position for
     * @param amount Amount of the position to close
     */
    function closeTakeFor(address account, UFixed18 amount)
        public
        nonReentrant
        notPaused
        onlyAccountOrMultiInvoker(account)
        settleForAccount(account)
        closeInvariant(account)
        liquidationInvariant(account)
    {
        _closeTake(account, amount);
    }

    function _closeTake(address account, UFixed18 amount) private {
        IOracleProvider.OracleVersion memory latestOracleVersion = atVersion(latestVersion());

        _positions[account].pre.closeTake(latestOracleVersion.version, amount);
        _position.pre.closeTake(latestOracleVersion.version, amount);

        UFixed18 positionFee = amount.mul(latestOracleVersion.price.abs()).mul(takerFee());
        if (!positionFee.isZero()) {
            controller().collateral().settleAccount(account, Fixed18Lib.from(-1, positionFee));
            emit PositionFeeCharged(account, latestOracleVersion.version, positionFee);
        }

        emit PositionFeeCharged(account, latestOracleVersion.version, positionFee);
        emit TakeClosed(account, latestOracleVersion.version, amount);
    }

    /**
     * @notice Opens a maker position for `msg.sender`
     * @param amount Amount of the position to open
     */
    function openMake(UFixed18 amount) external {
        openMakeFor(msg.sender, amount);
    }

    /**
     * @notice Opens a maker position for `account`. Deducts position fee based on notional value at `latestVersion`
     * @param account Account to open position for
     * @param amount Amount of the position to open
     */
    function openMakeFor(address account, UFixed18 amount)
        public
        nonReentrant
        notPaused
        notClosed
        onlyAccountOrMultiInvoker(account)
        settleForAccount(account)
        nonZeroVersionInvariant
        makerInvariant
        positionInvariant(account)
        liquidationInvariant(account)
        maintenanceInvariant(account)
    {
        IOracleProvider.OracleVersion memory latestOracleVersion = atVersion(latestVersion());

        _positions[account].pre.openMake(latestOracleVersion.version, amount);
        _position.pre.openMake(latestOracleVersion.version, amount);

        UFixed18 positionFee = amount.mul(latestOracleVersion.price.abs()).mul(makerFee());
        if (!positionFee.isZero()) {
            controller().collateral().settleAccount(account, Fixed18Lib.from(-1, positionFee));
            emit PositionFeeCharged(account, latestOracleVersion.version, positionFee);
        }

        emit PositionFeeCharged(account, latestOracleVersion.version, positionFee);
        emit MakeOpened(account, latestOracleVersion.version, amount);
    }

    /**
     * @notice Closes a maker position for `msg.sender`
     * @param amount Amount of the position to close
     */
    function closeMake(UFixed18 amount) external {
        closeMakeFor(msg.sender, amount);
    }

    /**
     * @notice Closes a maker position for `account`. Deducts position fee based on notional value at `latestVersion`
     * @param account Account to close the position for
     * @param amount Amount of the position to close
     */
    function closeMakeFor(address account, UFixed18 amount)
        public
        nonReentrant
        notPaused
        onlyAccountOrMultiInvoker(account)
        settleForAccount(account)
        takerInvariant
        closeInvariant(account)
        liquidationInvariant(account)
    {
        _closeMake(account, amount);
    }

    function _closeMake(address account, UFixed18 amount) private {
        IOracleProvider.OracleVersion memory latestOracleVersion = atVersion(latestVersion());

        _positions[account].pre.closeMake(latestOracleVersion.version, amount);
        _position.pre.closeMake(latestOracleVersion.version, amount);

        UFixed18 positionFee = amount.mul(latestOracleVersion.price.abs()).mul(makerFee());
        if (!positionFee.isZero()) {
            controller().collateral().settleAccount(account, Fixed18Lib.from(-1, positionFee));
            emit PositionFeeCharged(account, latestOracleVersion.version, positionFee);
        }

        emit PositionFeeCharged(account, latestOracleVersion.version, positionFee);
        emit MakeClosed(account, latestOracleVersion.version, amount);
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
    function latestVersion() public view returns (uint256) {
        return _accumulator.latestVersion;
    }

    /**
     * @notice Returns the global position at oracleVersion `oracleVersion`
     * @dev Only valid for the version at which a global settlement occurred
     * @param oracleVersion Oracle version to return for
     * @return Global position at oracle version
     */
    function positionAtVersion(uint256 oracleVersion) public view returns (Position memory) {
        return _position.positionAtVersion(oracleVersion);
    }

    /**
     * @notice Returns the current global pending-settlement position
     * @return Global pending-settlement position
     */
    function pre() external view returns (PrePosition memory) {
        return _position.pre;
    }

    /**
     * @notice Returns the global accumulator value at oracleVersion `oracleVersion`
     * @dev Only valid for the version at which a global settlement occurred
     * @param oracleVersion Oracle version to return for
     * @return Global accumulator value at oracle version
     */
    function valueAtVersion(uint256 oracleVersion) external view returns (Accumulator memory) {
        return _accumulator.valueAtVersion(oracleVersion);
    }

    /**
     * @notice Returns the global accumulator share at oracleVersion `oracleVersion`
     * @dev Only valid for the version at which a global settlement occurred
     * @param oracleVersion Oracle version to return for
     * @return Global accumulator share at oracle version
     */
    function shareAtVersion(uint256 oracleVersion) external view returns (Accumulator memory) {
        return _accumulator.shareAtVersion(oracleVersion);
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
     * @notice Returns The per-second rate based on the provided `position`
     * @dev Handles 0-maker/taker edge cases
     * @param position_ Position to base utilization on
     * @return The per-second rate
     */
    function rate(Position calldata position_) public view returns (Fixed18) {
        UFixed18 utilization = position_.taker.unsafeDiv(position_.maker);
        Fixed18 annualizedRate = utilizationCurve().compute(utilization);
        return annualizedRate.div(Fixed18Lib.from(365 days));
    }

    /**
     * @notice Returns the minimum funding fee parameter with a capped range for safety
     * @dev Caps controller.minFundingFee() <= fundingFee() <= 1
     * @return Safe minimum funding fee parameter
     */
    function _boundedFundingFee() private view returns (UFixed18) {
        return fundingFee().max(controller().minFundingFee());
    }

    /**
     * @notice Updates product closed state
     * @dev only callable by product owner. Settles the product before flipping the flag
     * @param newClosed new closed value
     */
    function updateClosed(bool newClosed) external nonReentrant notPaused onlyProductOwner {
        IOracleProvider.OracleVersion memory oracleVersion = _settle();
        _closed.store(newClosed);
        emit ClosedUpdated(newClosed, oracleVersion.version);
    }

    /**
     * @notice Updates underlying product oracle
     * @dev only callable by product owner
     * @param newOracle new oracle address
     */
    function updateOracle(IOracleProvider newOracle) external onlyProductOwner {
        _updateOracle(address(newOracle), latestVersion());
    }

    /// @dev Limit total maker for guarded rollouts
    modifier makerInvariant() {
        _;

        Position memory next = positionAtVersion(latestVersion()).next(_position.pre);

        if (next.maker.gt(makerLimit())) revert ProductMakerOverLimitError();
    }

    /// @dev Limit maker short exposure to the range 0.0-1.0x of their position. Does not apply when in closeOnly state
    modifier takerInvariant() {
        _;

        if (closed()) return;

        Position memory next = positionAtVersion(latestVersion()).next(_position.pre);
        UFixed18 socializationFactor = next.socializationFactor();

        if (socializationFactor.lt(UFixed18Lib.ONE)) revert ProductInsufficientLiquidityError(socializationFactor);
    }

    /// @dev Limit utilization to (1 - utilizationBuffer)
    modifier maxUtilizationInvariant() {
        _;

        if (closed()) return;

        Position memory next = positionAtVersion(latestVersion()).next(_position.pre);
        UFixed18 utilization = next.taker.unsafeDiv(next.maker);
        if (utilization.gt(UFixed18Lib.ONE.sub(utilizationBuffer())))
            revert ProductInsufficientLiquidityError(utilization);
    }

    /// @dev Ensure that the user has only taken a maker or taker position, but not both
    modifier positionInvariant(address account) {
        _;

        if (_positions[account].isDoubleSided()) revert ProductDoubleSidedError();
    }

    /// @dev Ensure that the user hasn't closed more than is open
    modifier closeInvariant(address account) {
        _;

        if (_positions[account].isOverClosed()) revert ProductOverClosedError();
    }

    /// @dev Ensure that the user will have sufficient margin for maintenance after next settlement
    modifier maintenanceInvariant(address account) {
        _;

        if (controller().collateral().liquidatableNext(account, IProduct(this)))
            revert ProductInsufficientCollateralError();
    }

    /// @dev Ensure that the user is not currently being liquidated
    modifier liquidationInvariant(address account) {
        if (_positions[account].liquidation) revert ProductInLiquidationError();

        _;
    }

    /// @dev Helper to fully settle an account's state
    modifier settleForAccount(address account) {
        IOracleProvider.OracleVersion memory _currentVersion = _settle();
        _settleAccount(account, _currentVersion);

        _;
    }

    /// @dev Ensure we have bootstraped the oracle before creating positions
    modifier nonZeroVersionInvariant() {
        if (latestVersion() == 0) revert ProductOracleBootstrappingError();

        _;
    }

    /// @dev Ensure the product is not closed
    modifier notClosed() {
        if (closed()) revert ProductClosedError();

        _;
    }
}
