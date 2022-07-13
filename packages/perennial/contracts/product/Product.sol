// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UReentrancyGuard.sol";
import "../controller/UControllerProvider.sol";
import "./UPayoffProvider.sol";
import "./types/position/AccountPosition.sol";
import "./types/accumulator/AccountAccumulator.sol";

/**
 * @title Product
 * @notice Manages logic and state for a single product market.
 * @dev Cloned by the Controller contract to launch new product markets.
 */
contract Product is IProduct, UInitializable, UControllerProvider, UPayoffProvider, UReentrancyGuard {
    /// @dev The maintenance value
    UFixed18Storage private constant _maintenance = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.maintenance"));
    function maintenance() public view returns (UFixed18) { return _maintenance.read(); }

    /// @dev The funding fee value
    UFixed18Storage private constant _fundingFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.fundingFee"));
    function fundingFee() public view returns (UFixed18) { return _fundingFee.read(); }

    /// @dev The maker fee value
    UFixed18Storage private constant _makerFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.makerFee"));
    function makerFee() public view returns (UFixed18) { return _makerFee.read(); }

    /// @dev The taker fee value
    UFixed18Storage private constant _takerFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.takerFee"));
    function takerFee() public view returns (UFixed18) { return _takerFee.read(); }

    /// @dev The maker limit value
    UFixed18Storage private constant _makerLimit = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.makerLimit"));
    function makerLimit() public view returns (UFixed18) { return _makerLimit.read(); }

    /// @dev The close-only status
    BoolStorage private constant _closed = BoolStorage.wrap(keccak256("equilibria.perennial.Product.closed"));
    function closed() public view returns (bool) { return _closed.read(); }

    /// @dev The JumpRateUtilizationCurve params
    JumpRateUtilizationCurveStorage private constant _utilizationCurve =
        JumpRateUtilizationCurveStorage.wrap(keccak256("equilibria.perennial.Product.jumpRateUtilizationCurve"));
    function utilizationCurve() public view returns (JumpRateUtilizationCurve memory) { return _utilizationCurve.read(); }

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

        name = productInfo_.name;
        symbol = productInfo_.symbol;

        _updateMaintenance(productInfo_.maintenance);
        _updateFundingFee(productInfo_.fundingFee);
        _updateMakerFee(productInfo_.makerFee);
        _updateTakerFee(productInfo_.takerFee);
        _updateMakerLimit(productInfo_.makerLimit);
        _updateUtilizationCurve(productInfo_.utilizationCurve);
    }

    /**
     * @notice Surfaces global settlement externally
     */
    function settle() external nonReentrant notPausedProduct(IProduct(this)) {
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
        IOracleProvider.OracleVersion memory settleOracleVersion = _settleVersion == currentOracleVersion.version ?
            currentOracleVersion : // if b == c, don't re-call provider for oracle version
            atVersion(_settleVersion);

        // Initiate
        _controller.incentivizer().sync(currentOracleVersion);
        UFixed18 boundedFundingFee = _boundedFundingFee();
        UFixed18 accumulatedFee;

        // value a->b
        accumulatedFee = accumulatedFee.add(
            _accumulator.accumulate(boundedFundingFee, _position, latestOracleVersion, settleOracleVersion)
        );

        // position a->b
        accumulatedFee = accumulatedFee.add(_position.settle(_latestVersion, settleOracleVersion));

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
    function settleAccount(address account) external nonReentrant notPausedProduct(IProduct(this)) {
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
        IOracleProvider.OracleVersion memory settleOracleVersion = _settleVersion == currentOracleVersion.version ?
            currentOracleVersion : // if b == c, don't re-call provider for oracle version
            atVersion(_settleVersion);

        // initialize
        Fixed18 accumulated;

        // sync incentivizer before accumulator
        _controller.incentivizer().syncAccount(account, settleOracleVersion);

        // value a->b
        accumulated = accumulated.add(
            _accumulators[account].syncTo(_accumulator, _positions[account], settleOracleVersion.version).sum());

        // position a->b
        accumulated = accumulated.sub(Fixed18Lib.from(_positions[account].settle(settleOracleVersion)));

        // short-circuit from a->c if b == c
        if (settleOracleVersion.version != currentOracleVersion.version) {
            // sync incentivizer before accumulator
            _controller.incentivizer().syncAccount(account, currentOracleVersion);

            // value b->c
            accumulated = accumulated.add(
                _accumulators[account].syncTo(_accumulator, _positions[account], currentOracleVersion.version).sum());
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
    notPausedProduct(IProduct(this))
    settleForAccount(msg.sender)
    takerInvariant
    positionInvariant
    liquidationInvariant
    maintenanceInvariant
    {
        uint256 _latestVersion = latestVersion();

        _positions[msg.sender].pre.openTake(_latestVersion, amount);
        _position.pre.openTake(_latestVersion, amount);

        emit TakeOpened(msg.sender, _latestVersion, amount);
    }

    /**
     * @notice Closes a taker position for `msg.sender`
     * @param amount Amount of the position to close
     */
    function closeTake(UFixed18 amount)
    external
    nonReentrant
    notPausedProduct(IProduct(this))
    settleForAccount(msg.sender)
    closeInvariant
    liquidationInvariant
    {
        _closeTake(msg.sender, amount);
    }

    function _closeTake(address account, UFixed18 amount) private {
        uint256 _latestVersion = latestVersion();

        _positions[account].pre.closeTake(_latestVersion, amount);
        _position.pre.closeTake(_latestVersion, amount);

        emit TakeClosed(account, _latestVersion, amount);
    }

    /**
     * @notice Opens a maker position for `msg.sender`
     * @param amount Amount of the position to open
     */
    function openMake(UFixed18 amount)
    external
    nonReentrant
    notPausedProduct(IProduct(this))
    settleForAccount(msg.sender)
    nonZeroVersionInvariant
    makerInvariant
    positionInvariant
    liquidationInvariant
    maintenanceInvariant
    {
        uint256 _latestVersion = latestVersion();

        _positions[msg.sender].pre.openMake(_latestVersion, amount);
        _position.pre.openMake(_latestVersion, amount);

        emit MakeOpened(msg.sender, _latestVersion, amount);
    }

    /**
     * @notice Closes a maker position for `msg.sender`
     * @param amount Amount of the position to close
     */
    function closeMake(UFixed18 amount)
    external
    nonReentrant
    notPausedProduct(IProduct(this))
    settleForAccount(msg.sender)
    takerInvariant
    closeInvariant
    liquidationInvariant
    {
        _closeMake(msg.sender, amount);
    }

    function _closeMake(address account, UFixed18 amount) private {
        uint256 _latestVersion = latestVersion();

        _positions[account].pre.closeMake(_latestVersion, amount);
        _position.pre.closeMake(_latestVersion, amount);

        emit MakeClosed(account, _latestVersion, amount);
    }

    /**
     * @notice Closes all open and pending positions, locking for liquidation
     * @dev Only callable by the Collateral contract as part of the liquidation flow
     * @param account Account to close out
     */
    function closeAll(address account) external onlyCollateral settleForAccount(account) {
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
     * @notice Updates the maintenance to `newMaintenance`
     * @dev only callable by product owner
     * @param newMaintenance new maintenance value
     */
    function updateMaintenance(UFixed18 newMaintenance) external onlyProductOwner(IProduct(this)) {
        _updateMaintenance(newMaintenance);
    }

    /**
     * @notice Updates the maintenance to `newMaintenance`
     * @param newMaintenance new maintenance value
     */
    function _updateMaintenance(UFixed18 newMaintenance) private {
        _maintenance.store(newMaintenance);
        emit MaintenanceUpdated(newMaintenance);
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
     * @notice Updates the funding fee to `newFundingFee`
     * @dev only callable by product owner
     * @param newFundingFee new funding fee value
     */
    function updateFundingFee(UFixed18 newFundingFee) external onlyProductOwner(IProduct(this)) {
        _updateFundingFee(newFundingFee);
    }

    /**
     * @notice Updates the funding fee to `newFundingFee`
     * @param newFundingFee new funding fee value
     */
    function _updateFundingFee(UFixed18 newFundingFee) private {
        if (newFundingFee.gt(UFixed18Lib.ONE)) revert ProductInvalidFundingFee();
        _fundingFee.store(newFundingFee);
        emit FundingFeeUpdated(newFundingFee);
    }

    /**
     * @notice Updates the maker fee to `newMakerFee`
     * @dev only callable by product owner
     * @param newMakerFee new maker fee value
     */
    function updateMakerFee(UFixed18 newMakerFee) external onlyProductOwner(IProduct(this)) {
        _updateMakerFee(newMakerFee);
    }

    /**
     * @notice Updates the maker fee to `newMakerFee`
     * @param newMakerFee new maker fee value
     */
    function _updateMakerFee(UFixed18 newMakerFee) private {
        if (newMakerFee.gt(UFixed18Lib.ONE)) revert ProductInvalidMakerFee();
        _makerFee.store(newMakerFee);
        emit MakerFeeUpdated(newMakerFee);
    }

    /**
     * @notice Updates the taker fee to `newTakerFee`
     * @dev only callable by product owner
     * @param newTakerFee new taker fee value
     */
    function updateTakerFee(UFixed18 newTakerFee) external onlyProductOwner(IProduct(this)) {
        _updateTakerFee(newTakerFee);
    }

    /**
     * @notice Updates the taker fee to `newTakerFee`
     * @param newTakerFee new taker fee value
     */
    function _updateTakerFee(UFixed18 newTakerFee) private {
        if (newTakerFee.gt(UFixed18Lib.ONE)) revert ProductInvalidTakerFee();
        _takerFee.store(newTakerFee);
        emit TakerFeeUpdated(newTakerFee);
    }

    /**
     * @notice Updates the maker limit to `newMakerLimit`
     * @dev only callable by product owner
     * @param newMakerLimit new maker limit value
     */
    function updateMakerLimit(UFixed18 newMakerLimit) external onlyProductOwner(IProduct(this)) {
        _updateMakerLimit(newMakerLimit);
    }

    /**
     * @notice Updates the maker limit to `newMakerLimit`
     * @param newMakerLimit new maker limit value
     */
    function _updateMakerLimit(UFixed18 newMakerLimit) private {
        _makerLimit.store(newMakerLimit);
        emit MakerLimitUpdated(newMakerLimit);
    }

    /**
     * @notice Updates the utilization curve limit to `newUtilizationCurve`
     * @dev only callable by product owner
     * @param newUtilizationCurve new utilization curve value
     */
    function updateUtilizationCurve(JumpRateUtilizationCurve calldata newUtilizationCurve) external onlyProductOwner(IProduct(this)) {
        _updateUtilizationCurve(newUtilizationCurve);
    }

    /**
     * @notice Updates the utilization curve limit to `newUtilizationCurve`
     * @param newUtilizationCurve new utilization curve value
     */
    function _updateUtilizationCurve(JumpRateUtilizationCurve calldata newUtilizationCurve) private {
        _utilizationCurve.store(newUtilizationCurve);
        emit JumpRateUtilizationCurveUpdated(
            newUtilizationCurve.minRate.unpack(),
            newUtilizationCurve.maxRate.unpack(),
            newUtilizationCurve.targetRate.unpack(),
            newUtilizationCurve.targetUtilization.unpack()
        );
    }

    /**
     * @notice Opens a taker position for `msg.sender`
     * @param amount Amount of the position to open
     */
    function updateClosed(bool newClosed) external nonReentrant onlyProductOwner(IProduct(this)) {
        _settle();
        _closed.store(newClosed);
        // event
    }

    /// @dev Limit total maker for guarded rollouts
    modifier makerInvariant {
        _;

        Position memory next = positionAtVersion(latestVersion()).next(_position.pre);

        if (next.maker.gt(makerLimit())) revert ProductMakerOverLimitError();
    }

    /// @dev Limit maker short exposure to the range 0.0-1.0x of their position
    modifier takerInvariant {
        _;

        Position memory next = positionAtVersion(latestVersion()).next(_position.pre);
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
        if (latestVersion() == 0) revert ProductOracleBootstrappingError();

        _;
    }
}
