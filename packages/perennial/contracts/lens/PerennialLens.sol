// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "../interfaces/IPerennialLens.sol";

/**
 * @title Lens contract to conveniently pull protocol data
 * @notice All functions should be called using `callStatic`
 */
contract PerennialLens is IPerennialLens {
    /**
     * @notice Protocol controller
     * @return Protocol controller
     */
    IController public immutable controller;

    /// @param _controller Protocol controller address
    constructor(IController _controller) {
        controller = _controller;
    }

    /**
     *  Snapshot Functions
     */

    /**
     * @notice Returns the snapshots of the provided `productAddresses`
     * @param productAddresses Product addresses
     * @return _snapshots a snapshot for each product after settle
     */
    function snapshots(IProduct[] calldata productAddresses) public returns (ProductSnapshot[] memory _snapshots) {
        _snapshots = new ProductSnapshot[](productAddresses.length);
        for (uint256 i = 0; i < productAddresses.length; i++) {
            _snapshots[i] = snapshot(productAddresses[i]);
        }
    }

    /**
     * @notice Returns the snapshot of the provided `product`
     * @param product Product address
     * @return _snapshot for the product after settle
     */
    function snapshot(IProduct product) public settle(product) returns (ProductSnapshot memory _snapshot) {
        _snapshot.definition = definition(product);
        _snapshot.parameter = parameter(product);
        _snapshot.utilizationCurve = utilizationCurve(product);
        _snapshot.productAddress = address(product);
        _snapshot.rate = rate(product);
        _snapshot.dailyRate = dailyRate(product);
        _snapshot.latestVersion = latestVersion(product);
        _snapshot.collateral = collateral(product);
        _snapshot.pre = pre(product);
        _snapshot.position = position(product);
        (_snapshot.productFee, _snapshot.protocolFee) = fees(product);
        _snapshot.openInterest = openInterest(product);
    }

    /**
     * @notice Returns the user snapshots for the provided `productAddresses`
     * @param account User addresses
     * @param productAddresses Product addresses
     * @return _snapshots UserSnapshot for each product after settle
     */
    function snapshots(address account, IProduct[] memory productAddresses)
        public returns (UserProductSnapshot[] memory _snapshots)
    {
        _snapshots = new UserProductSnapshot[](productAddresses.length);
        for (uint256 i = 0; i < productAddresses.length; i++) {
            _snapshots[i] = snapshot(account, productAddresses[i]);
        }
    }

    /**
     * @notice Returns the user snapshot for the provided `product`
     * @param account User addresses
     * @param product Product address
     * @return _snapshot UserSnapshot for the product after settle
     */
    function snapshot(address account, IProduct product)
        public
        settleAccount(account, product)
        returns (UserProductSnapshot memory _snapshot)
    {
        _snapshot.productAddress = address(product);
        _snapshot.userAddress = account;
        _snapshot.collateral = collateral(account, product);
        _snapshot.maintenance = maintenance(account, product);
        _snapshot.pre = pre(account, product);
        _snapshot.position = position(account, product);
        _snapshot.liquidatable = liquidatable(account, product);
        _snapshot.liquidating = liquidating(account, product);
        _snapshot.openInterest = openInterest(account, product);
        _snapshot.exposure = exposure(account, product);
    }

    /**
     *  End Snapshot Functions
     */

    /**
     *  Product Individual Fields Functions
     */

    /**
     * @notice Returns the name of the provided `product`
     * @param product Product address
     * @return Name of the product
     */
    function name(IProduct product) public view returns (string memory) {
        return product.name();
    }

    /**
     * @notice Returns the symbol of the provided `product`
     * @param product Product address
     * @return Symbol of the product
     */
    function symbol(IProduct product) public view returns (string memory) {
        return product.symbol();
    }

    function token(IProduct product) public view returns (Token18) {
        return product.token();
    }

    function definition(IProduct product) public view returns (IProduct.ProductDefinition memory _definition) {
        _definition.name = name(product);
        _definition.symbol = symbol(product);
        _definition.token = token(product);
        _definition.payoffDefinition = product.payoffDefinition();
        _definition.oracle = product.oracle();
    }

    function parameter(IProduct product) public view returns (Parameter memory) {
        return product.parameter();
    }

    function utilizationCurve(IProduct product) public view returns (JumpRateUtilizationCurve memory) {
        return product.utilizationCurve();
    }

    /**
     * @notice Product total collateral amount after settle
     * @param product Product address
     * @return Total collateral for product
     */
    function collateral(IProduct product) public settle(product) returns (Fixed18) {
        return Fixed18Lib.from(product.token().balanceOf(address(product)))
            .sub(Fixed18Lib.from(product.protocolFees()))
            .sub(Fixed18Lib.from(product.productFees()));
    }

    /**
     * @notice Product pre position after settle
     * @param product Product address
     * @return Product pre-position
     */
    function pre(IProduct product) public settle(product) returns (PrePosition memory) {
        return product.pre();
    }

    /**
     * @notice Product position after settle
     * @param product Product address
     * @return product position
     */
    function position(IProduct product) public settle(product) returns (Position memory) {
        return _latestPosition(product);
    }

    /**
     * @notice Product pre-position and position after settle
     * @param product Product address
     * @return Product pre-position
     * @return Product position
     */
    function globalPosition(IProduct product) public settle(product) returns (PrePosition memory, Position memory) {
        return (product.pre(), _latestPosition(product));
    }

    /**
     * @notice Current price of product after settle
     * @param product Product address
     * @return Product latest price
     */
    function latestVersion(IProduct product) public settle(product) returns (IOracleProvider.OracleVersion memory) {
        return _latestVersion(product);
    }

    /**
     * @notice Prices of product at specified versions after settle
     * @param product Product address
     * @param versions Oracle versions to query
     * @return prices Product prices at specified versions
     */
    function atVersions(IProduct product, uint256[] memory versions)
        public
        settle(product)
        returns (IOracleProvider.OracleVersion[] memory prices)
    {
        prices = new IOracleProvider.OracleVersion[](versions.length);
        for (uint256 i = 0; i < versions.length; i++) {
            prices[i] = product.atVersion(versions[i]);
        }
    }

    /**
     * @notice Product funding rate after settle
     * @param product Product address
     * @return Product current funding rate
     */
    function rate(IProduct product) public settle(product) returns (Fixed18) {
        Position memory position_ = _latestPosition(product);
        JumpRateUtilizationCurve memory utilizationCurve_ = product.utilizationCurve();
        return utilizationCurve_.compute(position_.utilization()).div(Fixed18Lib.from(365 days));
    }

    /**
     * @notice Product funding extrapolated to a daily rate after settle
     * @param product Product address
     * @return Product current funding extrapolated to a daily rate
     */
    function dailyRate(IProduct product) public settle(product) returns (Fixed18) {
        Position memory position_ = _latestPosition(product);
        JumpRateUtilizationCurve memory utilizationCurve_ = product.utilizationCurve();
        return utilizationCurve_.compute(position_.utilization()).div(Fixed18Lib.from(365));
    }

    /**
     * @notice Fees accumulated by product and protocol treasuries after settle
     * @param product Product address
     * @return protocolFees fees accrued by the protocol
     * @return productFees fees accrued by the product owner
     */
    function fees(IProduct product) public settle(product) returns (UFixed18 protocolFees, UFixed18 productFees) {
        protocolFees = product.protocolFees();
        productFees = product.productFees();
    }

    /**
     * @notice Product total open interest after settle
     * @param product Product address
     * @return Product maker and taker position multiplied by latest price after settle
     */
    function openInterest(IProduct product) public settle(product) returns (Position memory) {
        return _latestPosition(product).mul(_latestVersion(product).price.abs());
    }

    /**
     *  End Product Individual Fields Functions
     */

    /**
     *  UserProduct Individual Fields Functions
     */

    /**
     * @notice User collateral amount for product after settle
     * @param account Account address
     * @param product Product address
     * @return User deposited collateral for product
     */
    function collateral(address account, IProduct product) public settleAccount(account, product) returns (Fixed18) {
        Account memory productAccount = product.accounts(account);
        return productAccount.collateral;
    }

    /**
     * @notice User maintenance amount for product after settle
     * @param account Account address
     * @param product Product address
     * @return Maximum of user maintenance, and maintenanceNext
     */
    function maintenance(address account, IProduct product) public settleAccount(account, product) returns (UFixed18) {
        Account memory productAccount = product.accounts(account);
        return _maintenance(product, productAccount.position());
    }

    function maintenanceNext(address account, IProduct product) public settleAccount(account, product) returns (UFixed18) {
        Account memory productAccount = product.accounts(account);
        return _maintenance(product, productAccount.position().add(productAccount.pre()));
    }

    /**
     * @notice User liquidatble status for product after settle
     * @param account Account address
     * @param product Product address
     * @return Whether or not the user's position eligible to be liquidated
     */
    function liquidatable(address account, IProduct product) public settleAccount(account, product) returns (bool) {
        Account memory productAccount = product.accounts(account);
        UFixed18 maintenanceAmount = _maintenance(product, productAccount.position());
        return Fixed18Lib.from(maintenanceAmount).gt(productAccount.collateral);
    }

    /**
     * @notice User liquidating status for product after settle
     * @param account Account address
     * @param product Product address
     * @return Whether or not the user's position is being liquidated
     */
    function liquidating(address account, IProduct product) public settleAccount(account, product) returns (bool) {
        return product.liquidation(account);
    }

    /**
     * @notice User pre position for product after settle
     * @param account Account address
     * @param product Product address
     * @return User pre-position
     */
    function pre(address account, IProduct product)
        public
        settleAccount(account, product)
        returns (Fixed18)
    {
        Account memory productAccount = product.accounts(account);
        return productAccount.pre();
    }

    /**
     * @notice User position for product after settle
     * @param account Account address
     * @param product Product address
     * @return User position
     */
    function position(address account, IProduct product)
        public
        settleAccount(account, product)
        returns (Fixed18)
    {
        Account memory productAccount = product.accounts(account);
        return productAccount.position();
    }

    /**
     * @notice User pre-position and position for product after settle
     * @param account Account address
     * @param product Product address
     * @return User pre-position
     * @return User position
     */
    function userPosition(address account, IProduct product)
        public
        settleAccount(account, product)
        returns (Fixed18, Fixed18)
    {
        Account memory productAccount = product.accounts(account);
        return (productAccount.pre(), productAccount.position());
    }

    /**
     * @notice User's open interest in product after settle
     * @param account Account address
     * @param product Product address
     * @return User's maker or taker position multiplied by latest price after settle
     */
    function openInterest(address account, IProduct product)
        public
        settleAccount(account, product)
        returns (Fixed18)
    {
        Account memory productAccount = product.accounts(account);
        return productAccount.position().mul(_latestVersion(product).price);
    }

    /**
     * @notice User's exposure in product after settle
     * @param account Account address
     * @param product Product address
     * @return User's exposure (openInterest * utilization) after settle
     */
    function exposure(address account, IProduct product) public settleAccount(account, product) returns (Fixed18) {
        (, Position memory _pos) = globalPosition(product);
        if (_pos.maker.isZero()) { return Fixed18Lib.ZERO; }

        Fixed18 _openInterest = openInterest(account, product);
        if (_openInterest.sign() == 1) {
            return _openInterest; // Taker exposure is always 100% of openInterest
        }

        UFixed18 utilization = _pos.taker.div(_pos.maker);
        return Fixed18Lib.from(utilization).mul(_openInterest); // Maker exposure is openInterest * utilization
    }

    /**
     * @notice User's maintenance required for position size in product after settle
     * @param account Account address
     * @param product Product address
     * @param positionSize size of position for maintenance calculation
     * @return Maintenance required for position in product
     */
    function maintenanceRequired(address account, IProduct product, Fixed18 positionSize)
        public
        settleAccount(account, product)
        returns (UFixed18)
    {
        return _maintenance(product, positionSize);
    }

    /**
     * @notice User's unclaimed rewards for all programs for product after settle
     * @param account Account address
     * @param product Product address
     * @return tokens Token addresses of unclaimed incentive rewards for given product
     * @return amounts Token amounts of unclaimed incentive rewards for given product
     */
    function unclaimedIncentiveRewards(address account, IProduct product)
        public
        settleAccount(account, product)
        returns (Token18[] memory tokens, UFixed18[] memory amounts)
    {
        IIncentivizer incentivizer = controller.incentivizer();

        uint256 programsLength = incentivizer.count(product);
        tokens = new Token18[](programsLength);
        amounts = new UFixed18[](programsLength);
        for (uint256 i = 0; i < programsLength; i++) {
            ProgramInfo memory programInfo = incentivizer.programInfos(product, i);
            tokens[i] = programInfo.token;
            amounts[i] = incentivizer.unclaimed(product, account, i);
        }
    }

    /**
     * @notice User's unclaimed rewards for provided programs for product after settle
     * @param account Account address
     * @param product Product address
     * @param programIds Program IDs to query
     * @return tokens Token addresses of unclaimed incentive rewards for given program IDs
     * @return amounts Token amounts of unclaimed incentive rewards for given program IDs
     */
    function unclaimedIncentiveRewards(
        address account,
        IProduct product,
        uint256[] calldata programIds
    ) public settleAccount(account, product) returns (Token18[] memory tokens, UFixed18[] memory amounts) {
        IIncentivizer incentivizer = controller.incentivizer();
        tokens = new Token18[](programIds.length);
        amounts = new UFixed18[](programIds.length);
        for (uint256 i = 0; i < programIds.length; i++) {
            ProgramInfo memory programInfo = incentivizer.programInfos(product, programIds[i]);
            tokens[i] = programInfo.token;
            amounts[i] = incentivizer.unclaimed(product, account, programIds[i]);
        }
    }

    /**
     *  End UserProduct Individual Fields Functions
     */

    function _maintenance(IProduct product, Fixed18 positionSize) private view returns (UFixed18) {
        UFixed18 maintenance_ = product.parameter().maintenance;
        UFixed18 notional = positionSize.mul(_latestVersion(product).price).abs();
        return notional.mul(maintenance_);
    }

    /**
     *  Private Helper Functions
     */

    /**
     * @notice Returns the Product's latest position
     * @dev Private function, does not call settle itself
     * @param product Product address
     * @return Latest position for the product
     */
    function _latestPosition(IProduct product) private view returns (Position memory) {
        return product.versions(product.latestVersion()).position();
    }

    /**
     * @notice Returns the Product's latest version
     * @dev Private function, does not call settle itself
     * @param product Product address
     * @return Latest version for the product
     */
    function _latestVersion(IProduct product) private view returns (IOracleProvider.OracleVersion memory) {
        return product.atVersion(product.latestVersion());
    }

    /**
     *  End Private Helper Functions
     */

    /**
     *  Modifier Functions
     */

    /// @dev Settles the product
    modifier settle(IProduct product) {
        product.settle(address(0));
        _;
    }

    /// @dev Settles the product. product.settleAccount also settles the product
    modifier settleAccount(address account, IProduct product) {
        product.settle(account);
        _;
    }

    /**
     *  End Modifier Functions
     */
}
