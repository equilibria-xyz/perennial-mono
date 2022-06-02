// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.14;

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
     * @notice Returns the name of the provided `product`
     * @param product Product address
     * @return Name of the product
     */
    function name(IProduct product) external view returns (string memory) {
        return product.productProvider().name();
    }

    /**
     * @notice Returns the symbol of the provided `product`
     * @param product Product address
     * @return Symbol of the product
     */
    function symbol(IProduct product) external view returns (string memory) {
        return product.productProvider().symbol();
    }

    /**
     * @notice Protocol collateral address
     * @return Protocol collateral address
     */
    function collateral() public view returns (ICollateral) {
        return controller.collateral();
    }

    /**
     * @notice User collateral amount for product after settle
     * @param account Account address
     * @param product Product address
     * @return User deposited collateral for product
     */
    function collateral(address account, IProduct product) external settleAccount(account, product) returns (UFixed18) {
        return collateral().collateral(account, product);
    }

    /**
     * @notice Product total collateral amount after settle
     * @param product Product address
     * @return Total collateral for product
     */
    function collateral(IProduct product) external settle(product) returns (UFixed18) {
        return collateral().collateral(product);
    }

    /**
     * @notice Product total shortfall amount after settle
     * @param product Product address
     * @return Total shortfall for product
     */
    function shortfall(IProduct product) external settle(product) returns (UFixed18) {
        return collateral().shortfall(product);
    }

    /**
     * @notice User maintenance amount for product after settle
     * @param account Account address
     * @param product Product address
     * @return Maximum of user maintenance, and maintenanceNext
     */
    function maintenance(address account, IProduct product)
        external
        settleAccount(account, product)
        returns (UFixed18)
    {
        return UFixed18Lib.max(product.maintenance(account), product.maintenanceNext(account));
    }

    /**
     * @notice User liquidatble status for product after settle
     * @param account Account address
     * @param product Product address
     * @return Whether or not the user's position eligible to be liquidated
     */
    function liquidatable(address account, IProduct product) external settleAccount(account, product) returns (bool) {
        return collateral().liquidatable(account, product);
    }

    /**
     * @notice User pre position for product after settle
     * @param account Account address
     * @param product Product address
     * @return User pre-position
     */
    function pre(address account, IProduct product)
        external
        settleAccount(account, product)
        returns (PrePosition memory)
    {
        return product.pre(account);
    }

    /**
     * @notice Product pre position after settle
     * @param product Product address
     * @return Product pre-position
     */
    function pre(IProduct product) external settle(product) returns (PrePosition memory) {
        return product.pre();
    }

    /**
     * @notice User position for product after settle
     * @param account Account address
     * @param product Product address
     * @return User position
     */
    function position(address account, IProduct product)
        external
        settleAccount(account, product)
        returns (Position memory)
    {
        return product.position(account);
    }

    /**
     * @notice Product position after settle
     * @param product Product address
     * @return product position
     */
    function position(IProduct product) external settle(product) returns (Position memory) {
        return latestPosition(product);
    }

    /**
     * @notice User pre-position and position for product after settle
     * @param account Account address
     * @param product Product address
     * @return User pre-position
     * @return User position
     */
    function userPosition(address account, IProduct product)
        external
        settleAccount(account, product)
        returns (PrePosition memory, Position memory)
    {
        return (product.pre(account), product.position(account));
    }

    /**
     * @notice Product pre-position and position after settle
     * @param product Product address
     * @return Product pre-position
     * @return Product position
     */
    function globalPosition(IProduct product) external settle(product) returns (PrePosition memory, Position memory) {
        return (product.pre(), latestPosition(product));
    }

    /**
     * @notice Current price of product after settle
     * @param product Product address
     * @return Product latest price
     */
    function price(IProduct product) external settle(product) returns (Fixed18) {
        return latestVersion(product).price;
    }

    /**
     * @notice Fees accumulated by product and protocol treasuries after settle
     * @param product Product address
     * @return protocolFees fees accrued by the protocol
     * @return productFees fees accrued by the product owner
     */
    function fees(IProduct product) external settle(product) returns (UFixed18 protocolFees, UFixed18 productFees) {
        address protocolTreasury = controller.treasury();
        address productTreasury = controller.treasury(product);

        protocolFees = collateral().fees(protocolTreasury);
        productFees = collateral().fees(productTreasury);
    }

    /**
     * @notice Fees accumulated by treasury after settle
     * @param account Account address
     * @param products Product addresses
     * @return sum of all fees accrued by the account
     */
    function fees(address account, IProduct[] memory products) external returns (UFixed18) {
        for (uint256 i = 0; i < products.length; i++) {
            products[i].settle();
        }

        return collateral().fees(account);
    }

    /**
     * @notice User's open interest in product after settle
     * @param account Account address
     * @param product Product address
     * @return User's maker or taker position multiplied by latest price after settle
     */
    function openInterest(address account, IProduct product)
        external
        settleAccount(account, product)
        returns (Position memory)
    {
        return product.position(account).mul(latestVersion(product).price.abs());
    }

    /**
     * @notice Product total open interest after settle
     * @param product Product address
     * @return Product maker and taker position multiplied by latest price after settle
     */
    function openInterest(IProduct product) external settle(product) returns (Position memory) {
        return latestPosition(product).mul(latestVersion(product).price.abs());
    }

    /**
     * @notice Product funding rate after settle
     * @param product Product address
     * @return Product current funding rate
     */
    function rate(IProduct product) external settle(product) returns (Fixed18) {
        Position memory position_ = latestPosition(product);
        return product.productProvider().rate(position_);
    }

    /**
     * @notice Product funding extrapolated to a daily rate after settle
     * @param product Product address
     * @return Product current funding extrapolated to a daily rate
     */
    function dailyRate(IProduct product) external settle(product) returns (Fixed18) {
        Position memory position_ = latestPosition(product);
        return product.productProvider().rate(position_).mul(Fixed18Lib.from(60 * 60 * 24));
    }

    /**
     * @notice User's maintenance required for position size in product after settle
     * @param account Account address
     * @param product Product address
     * @param positionSize size of position for maintenance calculation
     * @return Maintenance required for position in product
     */
    function maintenanceRequired(
        address account,
        IProduct product,
        UFixed18 positionSize
    ) external settleAccount(account, product) returns (UFixed18) {
        UFixed18 notional = positionSize.mul(latestVersion(product).price.abs());
        return notional.mul(product.productProvider().maintenance());
    }

    /**
     * @notice User's unclaimed rewards for all programs for product after settle
     * @param account Account address
     * @param product Product address
     * @return tokens Token addresses of unclaimed incentive rewards for given product
     * @return amounts Token amounts of unclaimed incentive rewards for given product
     */
    function unclaimedIncentiveRewards(address account, IProduct product)
        external
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
    ) external settleAccount(account, product) returns (Token18[] memory tokens, UFixed18[] memory amounts) {
        IIncentivizer incentivizer = controller.incentivizer();
        tokens = new Token18[](programIds.length);
        amounts = new UFixed18[](programIds.length);
        for (uint256 i = 0; i < programIds.length; i++) {
            ProgramInfo memory programInfo = incentivizer.programInfos(product, programIds[i]);
            tokens[i] = programInfo.token;
            amounts[i] = incentivizer.unclaimed(product, account, programIds[i]);
        }
    }

    // TODO: all data for Product, all data for User, batching

    /**
     * @notice Returns the Product's latest position
     * @dev Internal function, does not call settle itself
     * @param product Product address
     * @return Latest position for the product
     */
    function latestPosition(IProduct product) internal view returns (Position memory) {
        return product.positionAtVersion(product.latestVersion());
    }

    /**
     * @notice Returns the Product's latest version
     * @dev Internal function, does not call settle itself
     * @param product Product address
     * @return Latest version for the product
     */
    function latestVersion(IProduct product) internal view returns (IOracleProvider.OracleVersion memory) {
        return product.productProvider().currentVersion();
    }

    /// @dev Settles the product
    modifier settle(IProduct product) {
        product.settle();
        _;
    }

    /// @dev Settles the product. product.settleAccount also settles the product
    modifier settleAccount(address account, IProduct product) {
        product.settleAccount(account);
        _;
    }
}
