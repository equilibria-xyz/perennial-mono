// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.15;

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
                depositTo(account, product, amount);

            // Withdraw from `msg.sender`s `product` collateral account to `receiver`
            } else if (invocation.action == PerennialAction.WITHDRAW) {
                (address receiver, IProduct product, UFixed18 amount) = abi.decode(invocation.args, (address, IProduct, UFixed18));
                collateral.withdrawFrom(msg.sender, receiver, product, amount);

            // Open a take position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.OPEN_TAKE) {
                (IProduct product, UFixed18 amount) = abi.decode(invocation.args, (IProduct, UFixed18));
                product.openTakeFor(msg.sender, amount);

            // Close a take position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.CLOSE_TAKE) {
                (IProduct product, UFixed18 amount) = abi.decode(invocation.args, (IProduct, UFixed18));
                product.closeTakeFor(msg.sender, amount);

            // Open a make position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.OPEN_MAKE) {
                (IProduct product, UFixed18 amount) = abi.decode(invocation.args, (IProduct, UFixed18));
                product.openMakeFor(msg.sender, amount);

            // Close a make position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.CLOSE_MAKE) {
                (IProduct product, UFixed18 amount) = abi.decode(invocation.args, (IProduct, UFixed18));
                product.closeMakeFor(msg.sender, amount);

            // Claim `msg.sender`s incentive reward for `product` programs
            } else if (invocation.action == PerennialAction.CLAIM) {
                (IProduct product, uint256[] memory programIds) = abi.decode(invocation.args, (IProduct, uint256[]));
                controller.incentivizer().claimFor(msg.sender, product, programIds);

            // Wrap `msg.sender`s USDC into DSU and return the DSU to `account`
            } else if (invocation.action == PerennialAction.WRAP) {
                (address receiver, UFixed18 amount) = abi.decode(invocation.args, (address, UFixed18));
                wrap(receiver, amount);

            // Unwrap `msg.sender`s DSU into USDC and return the USDC to `account`
            } else if (invocation.action == PerennialAction.UNWRAP) {
                (address receiver, UFixed18 amount) = abi.decode(invocation.args, (address, UFixed18));
                unwrap(receiver, amount);

            // Wrap `msg.sender`s USDC into DSU and deposit into `account`s `product` collateral account
            } else if (invocation.action == PerennialAction.WRAP_AND_DEPOSIT) {
                (address account, IProduct product, UFixed18 amount) = abi.decode(invocation.args, (address, IProduct, UFixed18));
                wrapAndDeposit(account, product, amount);
            }

            // Withdraw DSU from `msg.sender`s `product` collateral account, unwrap into USDC, and return the USDC to `receiver`
            else if (invocation.action == PerennialAction.WITHDRAW_AND_UNWRAP) {
                (address receiver, IProduct product, UFixed18 amount) = abi.decode(invocation.args, (address, IProduct, UFixed18));
                withdrawAndUnwrap(receiver, product, amount);
            }

            // Deposit `amount` DSU from `msg.sender` into `vault` on behalf of `account`
            else if (invocation.action == PerennialAction.VAULT_DEPOSIT) {
                (address account, IPerennialVault vault, UFixed18 amount) = abi.decode(invocation.args, (address, IPerennialVault, UFixed18));
                vaultDeposit(account, vault, amount);
            }

            // Redeem `shares` from from `vault` on behalf of `msg.sender`
            else if (invocation.action == PerennialAction.VAULT_REDEEM) {
                (IPerennialVault vault, UFixed18 shares) = abi.decode(invocation.args, (IPerennialVault, UFixed18));
                vault.redeem(shares, msg.sender);
            }

            // Claim assets from `vault` on behalf of `owner`
            else if (invocation.action == PerennialAction.VAULT_CLAIM) {
                (address owner, IPerennialVault vault) = abi.decode(invocation.args, (address, IPerennialVault));
                vault.claim(owner);
            }

            // Wrap `amount` USDC from `msg.sender` and deposit the DSU into the `vault`
            else if (invocation.action == PerennialAction.VAULT_WRAP_AND_DEPOSIT) {
                (address account, IPerennialVault vault, UFixed18 amount) = abi.decode(invocation.args, (address, IPerennialVault, UFixed18));
                vaultWrapAndDeposit(account, vault, amount);
            }
        }
    }

    /**
     * @notice Deposits `amount` DSU from `msg.sender` into `account`s `product` collateral account
     * @param account Account to deposit funds on behalf of
     * @param product Product to deposit funds for
     * @param amount Amount of DSU to deposit into the collateral account
     */
    function depositTo(address account, IProduct product, UFixed18 amount) private {
        // Pull the token from the `msg.sender`
        DSU.pull(msg.sender, amount);

        // Deposit the amount to the collateral account
        collateral.depositTo(account, product, amount);
    }

    /**
     * @notice Wraps `amount` USDC into DSU, pulling from `msg.sender` and sending to `receiver`
     * @param receiver Address to receive the DSU
     * @param amount Amount of USDC to wrap
     */
    function wrap(address receiver, UFixed18 amount) private {
        // Pull USDC from the `msg.sender`
        USDC.pull(msg.sender, amount, true);

        _wrap(receiver, amount);
    }

    /**
     * @notice Unwraps `amount` DSU into USDC, pulling from `msg.sender` and sending  to `receiver`
     * @param receiver Address to receive the USDC
     * @param amount Amount of DSU to unwrap
     */
    function unwrap(address receiver, UFixed18 amount) private {
        // Pull the token from the `msg.sender`
        DSU.pull(msg.sender, amount);

        _unwrap(receiver, amount);
    }

    /**
     * @notice Wraps `amount` USDC from `msg.sender` into DSU, then deposits the USDC into `account`s `product` collateral account
     * @param account Account to deposit funds on behalf of
     * @param product Product to deposit funds for
     * @param amount Amount of USDC to deposit into the collateral account
     */
    function wrapAndDeposit(address account, IProduct product, UFixed18 amount) private {
        // Pull USDC from the `msg.sender`
        USDC.pull(msg.sender, amount, true);

        _wrap(address(this), amount);

        // Deposit the amount to the collateral account
        collateral.depositTo(account, product, amount);
    }

    /**
     * @notice Withdraws `amount` DSU from `msg.sender`s `product` collateral account, then unwraps the DSU into USDC and sends it to `receiver`
     * @param receiver Address to receive the USDC
     * @param product Product to withdraw funds for
     * @param amount Amount of DSU to withdraw from the collateral account
     */
    function withdrawAndUnwrap(address receiver, IProduct product, UFixed18 amount) private {
        // Withdraw the amount from the collateral account
        collateral.withdrawFrom(msg.sender, address(this), product, amount);

        _unwrap(receiver, amount);
    }

    /**
     * @notice Deposit `amount` DSU from `msg.sender` into `vault` on behalf of `account`
     * @param account Address to receive the vault shares
     * @param vault Vault to deposit funds into
     * @param amount Amount of DSU to deposit into the vault
     */
    function vaultDeposit(address account, IPerennialVault vault, UFixed18 amount) private {
        // Pull the DSU from the user
        DSU.pull(msg.sender, amount);

        // Just-in-time approval to the vault for the amount being deposited
        DSU.approve(address(vault), amount);

        // Deposit the DSU to the vault, crediting shares to `account`
        vault.deposit(amount, account);
    }

    /**
     * @notice Wrap `amount` USDC from `msg.sender` and deposit the DSU into the `vault`
     * @param account Address to receive the vault shares
     * @param vault Vault to deposit funds into
     * @param amount Amount of USDC to wrap and deposit into the vault
     */
    function vaultWrapAndDeposit(address account, IPerennialVault vault, UFixed18 amount) private {
        // Pull USDC from the `msg.sender`
        USDC.pull(msg.sender, amount, true);

        _wrap(address(this), amount);

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
    function _wrap(address receiver, UFixed18 amount) private {
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
    function _unwrap(address receiver, UFixed18 amount) private {
        // If the batcher is 0 or doesn't have enough for this unwrap, go directly to the reserve
        if (address(batcher) == address(0) || amount.gt(USDC.balanceOf(address(batcher)))) {
            reserve.redeem(amount);
            if (receiver != address(this)) USDC.push(receiver, amount);
        } else {
            // Unwrap the DSU into USDC and return to the receiver
            batcher.unwrap(amount, receiver);
        }
    }
}
