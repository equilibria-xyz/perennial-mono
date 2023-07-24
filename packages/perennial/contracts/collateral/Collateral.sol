// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/control/unstructured/UReentrancyGuard.sol";
import "../interfaces/ICollateral.sol";
import "./types/OptimisticLedger.sol";
import "../controller/UControllerProvider.sol";

/**
 * @title Collateral
 * @notice Manages logic and state for all collateral accounts in the protocol.
 */
contract Collateral is ICollateral, UInitializable, UControllerProvider, UReentrancyGuard {
    /// @dev ERC20 stablecoin for collateral
    Token18 public immutable token;

    /// @dev Per product collateral state
    mapping(IProduct => OptimisticLedger) private _products;

    /// @dev Protocol and product fees collected, but not yet claimed
    mapping(address => UFixed18) public fees;

    /**
     * @notice Initializes the immutable contract state
     * @dev Called at implementation instantiate and constant for that implementation.
     * @param token_ Collateral ERC20 stablecoin address
     */
    constructor(Token18 token_) {
        token = token_;
    }

    /**
     * @notice Initializes the contract state
     * @dev Must be called atomically as part of the upgradeable proxy deployment to
     *      avoid front-running
     * @param controller_ Factory contract address
     */
    function initialize(IController controller_) external initializer(1) {
        __UControllerProvider__initialize(controller_);
        __UReentrancyGuard__initialize();
    }

    /**
     * @notice Deposits `amount` collateral from `msg.sender` to `account`'s `product`
     *         account
     * @param account Account to deposit the collateral for
     * @param product Product to credit the collateral to
     * @param amount Amount of collateral to deposit
     */
    function depositTo(address account, IProduct product, UFixed18 amount)
    external
    nonReentrant
    notPaused
    notZeroAddress(account)
    isProduct(product)
    collateralInvariant(account, product)
    {
        _products[product].creditAccount(account, amount);
        token.pull(msg.sender, amount);

        emit Deposit(account, product, amount);
    }

    /**
     * @notice Withdraws `amount` collateral from `msg.sender`'s `product` account
     *         and sends it to `receiver`
     * @param receiver Account to withdraw the collateral to
     * @param product Product to withdraw the collateral from
     * @param amount Amount of collateral to withdraw
     */
    function withdrawTo(address receiver, IProduct product, UFixed18 amount) external {
        withdrawFrom(msg.sender, receiver, product, amount);
    }

    /**
     * @notice Withdraws `amount` collateral from `account`'s `product` account
     *         and sends it to `receiver`
     * @param account Account to withdraw the collateral from
     * @param receiver Account to withdraw the collateral to
     * @param product Product to withdraw the collateral from
     * @param amount Amount of collateral to withdraw
     */
    function withdrawFrom(address account, address receiver, IProduct product, UFixed18 amount)
    public
    nonReentrant
    notPaused
    notZeroAddress(receiver)
    isProduct(product)
    onlyAccountOrMultiInvoker(account)
    settleForAccount(account, product)
    collateralInvariant(account, product)
    maintenanceInvariant(account, product)
    {
        amount = amount.eq(UFixed18Lib.MAX) ? collateral(account, product) : amount;
        _products[product].debitAccount(account, amount);
        token.push(receiver, amount);

        emit Withdrawal(account, product, amount);
    }

    /**
     * @notice Liquidates `account`'s `product` collateral account
     * @dev Account must be under-collateralized, fee returned immediately to `msg.sender`
     * @param account Account to liquidate
     * @param product Product to liquidate for
     */
    function liquidate(address account, IProduct product)
    external
    nonReentrant
    notPaused
    isProduct(product)
    settleForAccount(account, product)
    {
        if (product.isLiquidating(account)) revert CollateralAccountLiquidatingError(account);

        UFixed18 totalMaintenance = product.maintenance(account);
        UFixed18 totalCollateral = collateral(account, product);

        if (!totalMaintenance.gt(totalCollateral))
            revert CollateralCantLiquidate(totalMaintenance, totalCollateral);

        product.closeAll(account);

        // claim fee
        UFixed18 liquidationFee = controller().liquidationFee();
        // If maintenance is less than minCollateral, use minCollateral for fee amount
        UFixed18 collateralForFee = UFixed18Lib.max(totalMaintenance, controller().minCollateral());
        UFixed18 fee = UFixed18Lib.min(totalCollateral, collateralForFee.mul(liquidationFee));

        _products[product].debitAccount(account, fee);
        token.push(msg.sender, fee);

        emit Liquidation(account, product, msg.sender, fee);
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
    function settleAccount(address account, Fixed18 amount) external onlyProduct {
        IProduct product = IProduct(msg.sender);

        UFixed18 newShortfall = _products[product].settleAccount(account, amount);

        emit AccountSettle(product, account, amount, newShortfall);
    }

    /**
     * @notice Debits `amount` from product's total collateral account
     * @dev Callable only by the corresponding product as part of the settlement flywheel
     *      Removes collateral from the product as fees.
     * @param amount Amount to debit from the account
     */
    function settleProduct(UFixed18 amount) external onlyProduct {
        (IProduct product, IController controller) = (IProduct(msg.sender), controller());

        address protocolTreasury = controller.treasury();
        address productTreasury = controller.treasury(product);

        UFixed18 protocolFee = amount.mul(controller.protocolFee());
        UFixed18 productFee = amount.sub(protocolFee);

        _products[product].debit(amount);
        fees[protocolTreasury] = fees[protocolTreasury].add(protocolFee);
        fees[productTreasury] = fees[productTreasury].add(productFee);

        emit ProductSettle(product, protocolFee, productFee);
    }

    /**
     * @notice Returns the balance of `account`'s `product` collateral account
     * @param account Account to return for
     * @param product Product to return for
     * @return The balance of the collateral account
     */
    function collateral(address account, IProduct product) public view returns (UFixed18) {
        return _products[product].balances[account];
    }

    /**
     * @notice Returns the total balance of `product`'s collateral
     * @param product Product to return for
     * @return The total balance of collateral in the product
     */
    function collateral(IProduct product) external view returns (UFixed18) {
        return _products[product].total;
    }

    /**
     * @notice Returns the current shortfall of `product`'s collateral
     * @param product Product to return for
     * @return The current shortfall of the product
     */
    function shortfall(IProduct product) external view returns (UFixed18) {
        return _products[product].shortfall;
    }

    /**
     * @notice Returns whether `account`'s `product` collateral account can be liquidated
     * @param account Account to return for
     * @param product Product to return for
     * @return Whether the account can be liquidated
     */
    function liquidatable(address account, IProduct product) external view returns (bool) {
        if (product.isLiquidating(account)) return false;

        return product.maintenance(account).gt(collateral(account, product));
    }

    /**
     * @notice Returns whether `account`'s `product` collateral account can be liquidated
     *         after the next oracle version settlement
     * @dev Takes into account the current pre-position on the account
     * @param account Account to return for
     * @param product Product to return for
     * @return Whether the account can be liquidated
     */
    function liquidatableNext(address account, IProduct product) external view returns (bool) {
        return product.maintenanceNext(account).gt(collateral(account, product));
    }

    /**
     * @notice Injects additional collateral into a product to resolve shortfall
     * @dev Shortfall is a measure of settled insolvency in the market
     *      This hook can be used by the product owner or an insurance fund to re-capitalize an insolvent market
     * @param product Product to resolve shortfall for
     * @param amount Amount of shortfall to resolve
     */
    function resolveShortfall(IProduct product, UFixed18 amount) external isProduct(product) notPaused {
        _products[product].resolve(amount);
        token.pull(msg.sender, amount);

        emit ShortfallResolution(product, amount);
    }

    /**
     * @notice Claims all of `msg.sender`'s fees
     */
    function claimFee() external notPaused {
        UFixed18 amount = fees[msg.sender];

        fees[msg.sender] = UFixed18Lib.ZERO;
        token.push(msg.sender, amount);

        emit FeeClaim(msg.sender, amount);
    }

    /// @dev Ensure that the address is non-zero
    modifier notZeroAddress(address account) {
        if (account == address(0)) revert CollateralZeroAddressError();

        _;
    }

    /// @dev Ensure that the user has sufficient margin for both current and next maintenance
    modifier maintenanceInvariant(address account, IProduct product) {
        _;

        UFixed18 maintenance = product.maintenance(account);
        UFixed18 maintenanceNext = product.maintenanceNext(account);

        if (UFixed18Lib.max(maintenance, maintenanceNext).gt(collateral(account, product)))
            revert CollateralInsufficientCollateralError();
    }

    /// @dev Ensure that the account is either empty or above the collateral minimum
    modifier collateralInvariant(address account, IProduct product) {
        _;

        UFixed18 accountCollateral = collateral(account, product);
        if (!accountCollateral.isZero() && accountCollateral.lt(controller().minCollateral()))
            revert CollateralUnderLimitError();
    }

    /// @dev Helper to fully settle an account's state
    modifier settleForAccount(address account, IProduct product) {
        product.settleAccount(account);

        _;
    }
}
