// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";

import "../interfaces/IMultiInvoker.sol";

contract MultiInvoker is IMultiInvoker, UInitializable {
    /// @dev USDC stablecoin address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    /// @dev DSU address
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Batcher address
    IBatcher public immutable batcher;

    /// @dev Controller address
    IController public immutable controller;

    /// @dev Collateral address
    ICollateral public immutable collateral;

    /// @dev Reserve address
    IEmptySetReserve public immutable reserve;

    /**
     * @notice Initializes the immutable contract state
     * @dev Called at implementation instantiate and constant for that implementation.
     * @param usdc_ USDC stablecoin address
     * @param batcher_ Protocol Batcher address
     * @param reserve_ EmptySet Reserve address
     * @param controller_ Protocol Controller address
     */
    constructor(Token6 usdc_, IBatcher batcher_, IEmptySetReserve reserve_, IController controller_) {
        USDC = usdc_;
        batcher = batcher_;
        controller = controller_;
        collateral = controller.collateral();
        DSU = collateral.token();
        reserve = reserve_;
    }

    /**
     * @notice Initializes the contract state
     * @dev Must be called atomically as part of the upgradeable proxy deployment to
     *      avoid front-running
     */
    function initialize() external initializer(2) {
        if (address(batcher) != address(0)) {
            DSU.approve(address(batcher), UFixed18Lib.ZERO);
            DSU.approve(address(batcher));
            USDC.approve(address(batcher), UFixed18Lib.ZERO);
            USDC.approve(address(batcher));
        }

        DSU.approve(address(collateral), UFixed18Lib.ZERO);
        DSU.approve(address(collateral));

        DSU.approve(address(reserve), UFixed18Lib.ZERO);
        DSU.approve(address(reserve));
        USDC.approve(address(reserve), UFixed18Lib.ZERO);
        USDC.approve(address(reserve));
    }

    /**
     * @notice Executes a list of invocations in order
     * @param invocations The list of invocations to execute in order
     */
    function invoke(Invocation[] calldata invocations) external {

        for (uint256 i = 0; i < invocations.length; i++) {
            Invocation memory invocation = invocations[i];

            // Deposit from `msg.sender` into `account`s `product` collateral account
            if (invocation.action == PerennialAction.DEPOSIT) {
                (address account, IProduct product, UFixed18 amount) = abi.decode(invocation.args, (address, IProduct, UFixed18));
                _deposit(account, product, amount);

            // Withdraw from `msg.sender`s `product` collateral account to `receiver`
            } else if (invocation.action == PerennialAction.WITHDRAW) {
                (address receiver, IProduct product, UFixed18 amount) = abi.decode(invocation.args, (address, IProduct, UFixed18));
                _withdraw(receiver, product, amount);

            // Open a take position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.OPEN_TAKE) {
                (IProduct product, UFixed18 amount) = abi.decode(invocation.args, (IProduct, UFixed18));
                _openTake(product, amount);

            // Close a take position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.CLOSE_TAKE) {
                (IProduct product, UFixed18 amount) = abi.decode(invocation.args, (IProduct, UFixed18));
                _closeTake(product, amount);

            // Open a make position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.OPEN_MAKE) {
                (IProduct product, UFixed18 amount) = abi.decode(invocation.args, (IProduct, UFixed18));
                _openMake(product, amount);

            // Close a make position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.CLOSE_MAKE) {
                (IProduct product, UFixed18 amount) = abi.decode(invocation.args, (IProduct, UFixed18));
                _closeMake(product, amount);

            // Claim `msg.sender`s incentive reward for `product` programs
            } else if (invocation.action == PerennialAction.CLAIM) {
                (IProduct product, uint256[] memory programIds) = abi.decode(invocation.args, (IProduct, uint256[]));
                _claim(product, programIds);

            // Wrap `msg.sender`s USDC into DSU and return the DSU to `account`
            } else if (invocation.action == PerennialAction.WRAP) {
                (address receiver, UFixed18 amount) = abi.decode(invocation.args, (address, UFixed18));
                _wrap(receiver, amount);

            // Unwrap `msg.sender`s DSU into USDC and return the USDC to `account`
            } else if (invocation.action == PerennialAction.UNWRAP) {
                (address receiver, UFixed18 amount) = abi.decode(invocation.args, (address, UFixed18));
                _unwrap(receiver, amount);

            // Wrap `msg.sender`s USDC into DSU and deposit into `account`s `product` collateral account
            } else if (invocation.action == PerennialAction.WRAP_AND_DEPOSIT) {
                (address account, IProduct product, UFixed18 amount) = abi.decode(invocation.args, (address, IProduct, UFixed18));
                _wrapAndDeposit(account, product, amount);
            }

            // Withdraw DSU from `msg.sender`s `product` collateral account, unwrap into USDC, and return the USDC to `receiver`
            else if (invocation.action == PerennialAction.WITHDRAW_AND_UNWRAP) {
                (address receiver, IProduct product, UFixed18 amount) = abi.decode(invocation.args, (address, IProduct, UFixed18));
                _withdrawAndUnwrap(receiver, product, amount);
            }

            // Deposit `amount` DSU from `msg.sender` into `vault` on behalf of `account`
            else if (invocation.action == PerennialAction.VAULT_DEPOSIT) {
                (address account, IPerennialVault vault, UFixed18 amount) = abi.decode(invocation.args, (address, IPerennialVault, UFixed18));
                _vaultDeposit(account, vault, amount);
            }

            // Redeem `shares` from from `vault` on behalf of `msg.sender`
            else if (invocation.action == PerennialAction.VAULT_REDEEM) {
                (IPerennialVault vault, UFixed18 shares) = abi.decode(invocation.args, (IPerennialVault, UFixed18));
                _vaultRedeem(vault, shares);
            }

            // Claim assets from `vault` on behalf of `owner`
            else if (invocation.action == PerennialAction.VAULT_CLAIM) {
                (address owner, IPerennialVault vault) = abi.decode(invocation.args, (address, IPerennialVault));
                _vaultClaim(vault, owner);
            }

            // Wrap `amount` USDC from `msg.sender` and deposit the DSU into the `vault`
            else if (invocation.action == PerennialAction.VAULT_WRAP_AND_DEPOSIT) {
                (address account, IPerennialVault vault, UFixed18 amount) = abi.decode(invocation.args, (address, IPerennialVault, UFixed18));
                _vaultWrapAndDeposit(account, vault, amount);
            }

            else if (invocation.action == PerennialAction.CHARGE_FEE) {
                (address receiver, UFixed18 amount, bool wrapped) = abi.decode(invocation.args, (address, UFixed18, bool));

                _chargeFee(receiver, amount, wrapped);
            }
        }
    }

    /**
     * @notice opens `amount` of take on behalf of `msg.sender` in `product`
     * @param product Product to increase take position of
     * @param amount Amount to increase take position by
     */
    function _openTake(IProduct product, UFixed18 amount) internal {
        product.openTakeFor(msg.sender, amount);
    }

    /**
     * @notice closes `amount` of take on behalf of `msg.sender` in `product`
     * @param product Product to decrease take position of
     * @param amount Amount to decrease take position by
     */
    function _closeTake(IProduct product, UFixed18 amount) internal {
        product.closeTakeFor(msg.sender, amount);
    }

    /**
     * @notice opens `amount` of make on behalf of `msg.sender` in `product`
     * @param product Product to increase make position of
     * @param amount Amount to increase make position by
     */
    function _openMake(IProduct product, UFixed18 amount) internal {
        product.openMakeFor(msg.sender, amount);
    }

    /**
     * @notice closes `amount` of make on behalf of `msg.sender` in `product`
     * @param product Product to decrease make position of
     * @param amount Amount to decrease make position by
     */
    function _closeMake(IProduct product, UFixed18 amount) internal {
        product.closeMakeFor(msg.sender, amount);
    }

    /**
     * @notice Deposits `amount` DSU from `msg.sender` into `account`s `product` collateral account
     * @param account Account to deposit funds on behalf of
     * @param product Product to deposit funds for
     * @param amount Amount of DSU to deposit into the collateral account
     */
    function _deposit(address account, IProduct product, UFixed18 amount) internal {
        // Pull the token from the `msg.sender`
        DSU.pull(msg.sender, amount);

        // Deposit the amount to the collateral account
        collateral.depositTo(account, product, amount);
    }

    /**
     * @notice Withdraws `amount` DSU from `msg.sender`s `product` collateral account to `receiver`
     * @param receiver address to withdraw funds on behalf of msg.sender to
     * @param product Product to withdraw frunds from
     * @param amount Amount of DSU to withdraw out of the collateral account
     */
    function _withdraw(address receiver, IProduct product, UFixed18 amount) internal {
        collateral.withdrawFrom(msg.sender, receiver, IProduct(product), amount);
    }

    /**
     * @notice Claim `msg.sender`s incentive reward for `product` programs
     * @param product Product to claim
     */
    function _claim(IProduct product, uint256[] memory programIds) internal {
        controller.incentivizer().claimFor(msg.sender, product, programIds);
    }

    /**
     * @notice Wraps `amount` USDC into DSU, pulling from `msg.sender` and sending to `receiver`
     * @param receiver Address to receive the DSU
     * @param amount Amount of USDC to wrap
     */
    function _wrap(address receiver, UFixed18 amount) internal {
        // Pull USDC from the `msg.sender`
        USDC.pull(msg.sender, amount, true);

        _handleWrap(receiver, amount);
    }

    /**
     * @notice Unwraps `amount` DSU into USDC, pulling from `msg.sender` and sending  to `receiver`
     * @param receiver Address to receive the USDC
     * @param amount Amount of DSU to unwrap
     */
    function _unwrap(address receiver, UFixed18 amount) internal {
        // Pull the token from the `msg.sender`
        DSU.pull(msg.sender, amount);

        _handleUnwrap(receiver, amount);
    }

    /**
     * @notice Wraps `amount` USDC from `msg.sender` into DSU, then deposits the USDC into `account`s `product` collateral account
     * @param account Account to deposit funds on behalf of
     * @param product Product to deposit funds for
     * @param amount Amount of USDC to deposit into the collateral account
     */
    function _wrapAndDeposit(address account, IProduct product, UFixed18 amount) internal {
        // Pull USDC from the `msg.sender`
        USDC.pull(msg.sender, amount, true);

        _handleWrap(address(this), amount);

        // Deposit the amount to the collateral account
        collateral.depositTo(account, product, amount);
    }

    /**
     * @notice Withdraws `amount` DSU from `msg.sender`s `product` collateral account, then unwraps the DSU into USDC and sends it to `receiver`
     * @param receiver Address to receive the USDC
     * @param product Product to withdraw funds for
     * @param amount Amount of DSU to withdraw from the collateral account
     */
    function _withdrawAndUnwrap(address receiver, IProduct product, UFixed18 amount) internal {
        // If amount is uint256 max, withdraw the entire balance
        if (amount.eq(UFixed18Lib.MAX)) {
            product.settleAccount(msg.sender);
            amount = collateral.collateral(msg.sender, product);
        }

        // Withdraw the amount from the collateral account
        collateral.withdrawFrom(msg.sender, address(this), product, amount);

        _handleUnwrap(receiver, amount);
    }

    /**
     * @notice Deposit `amount` DSU from `msg.sender` into `vault` on behalf of `account`
     * @param account Address to receive the vault shares
     * @param vault Vault to deposit funds into
     * @param amount Amount of DSU to deposit into the vault
     */
    function _vaultDeposit(address account, IPerennialVault vault, UFixed18 amount) internal {
        // Pull the DSU from the user
        DSU.pull(msg.sender, amount);

        // Just-in-time approval to the vault for the amount being deposited
        DSU.approve(address(vault), amount);

        // Deposit the DSU to the vault, crediting shares to `account`
        vault.deposit(amount, account);
    }

    /**
     * @notice Redeems `shares` shares from the vault on behalf of `msg.sender`
     * @dev Does not return any assets to the user due to delayed settlement. Use `claim` to claim assets
     *      If account is not msg.sender, requires prior spending approval
     * @param shares Amount of shares to redeem
     * @param vault Vault to redeem from
     */
    function _vaultRedeem(IPerennialVault vault, UFixed18 shares) internal {
        vault.redeem(shares, msg.sender);
    }

    /**
     * @notice Claims all claimable assets for account, sending assets to account
     * @param vault Vault to claim from
     * @param owner Account to claim for
     */
    function _vaultClaim(IPerennialVault vault, address owner) internal {
        vault.claim(owner);
    }

    /**
     * @notice Wrap `amount` USDC from `msg.sender` and deposit the DSU into the `vault`
     * @param account Address to receive the vault shares
     * @param vault Vault to deposit funds into
     * @param amount Amount of USDC to wrap and deposit into the vault
     */
    function _vaultWrapAndDeposit(address account, IPerennialVault vault, UFixed18 amount) internal {
        // Pull USDC from the `msg.sender`
        USDC.pull(msg.sender, amount, true);

        _handleWrap(address(this), amount);

        // Just-in-time approval to the vault for the amount being deposited
        DSU.approve(address(vault), amount);

        // Deposit the DSU to the vault, crediting shares to `account`
        vault.deposit(amount, account);
    }

    /**
     * @notice Helper function to wrap `amount` USDC from `msg.sender` into DSU using the batcher or reserve
     * @param receiver Address to receive the DSU
     * @param amount Amount of USDC to wrap
     */
    function _handleWrap(address receiver, UFixed18 amount) internal {
        // If the batcher is 0 or  doesn't have enough for this wrap, go directly to the reserve
        if (address(batcher) == address(0) || amount.gt(DSU.balanceOf(address(batcher)))) {
            reserve.mint(amount);
            if (receiver != address(this)) DSU.push(receiver, amount);
        } else {
            // Wrap the USDC into DSU and return to the receiver
            batcher.wrap(amount, receiver);
        }
    }

    /**
     * @notice Helper function to unwrap `amount` DSU into USDC and send to `receiver`
     * @param receiver Address to receive the USDC
     * @param amount Amount of DSU to unwrap
     */
    function _handleUnwrap(address receiver, UFixed18 amount) internal {
        // If the batcher is 0 or doesn't have enough for this unwrap, go directly to the reserve
        if (address(batcher) == address(0) || amount.gt(USDC.balanceOf(address(batcher)))) {
            reserve.redeem(amount);
            if (receiver != address(this)) USDC.push(receiver, amount);
        } else {
            // Unwrap the DSU into USDC and return to the receiver
            batcher.unwrap(amount, receiver);
        }
    }

    /**
     * @notice Helper function to include an interface fee
     * @param receiver The interface receiving the fee
     * @param amount The amount of DSU to credit the interface
     * @param wrapped Bool to specify is USDC is wrapped to DSU
     */
    function _chargeFee(address receiver, UFixed18 amount, bool wrapped) internal {
        if (wrapped) {
            USDC.pull(msg.sender, amount);
            _handleWrap(receiver, amount);
        } else {
            USDC.pullTo(msg.sender, receiver, amount);
        }
    }
}
