// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "hardhat/console.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";

import "../controller/UControllerProvider.sol";
import "../interfaces/IProduct.sol";
import "../interfaces/ICollateral.sol";
import "../interfaces/IMultiInvoker.sol";

contract MultiInvoker is IMultiInvoker, UInitializable, UControllerProvider {
    /// @dev USDC stablecoin address
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    /// @dev Batcher address
    Batcher public immutable batcher;

    /**
     * @notice Initializes the immutable contract state
     * @dev Called at implementation instantiate and constant for that implementation.
     * @param usdc_ USDC stablecoin address
     * @param batcher_ Protocol Batcher address
     */
    constructor(Token6 usdc_, Batcher batcher_) {
        USDC = usdc_;
        batcher = batcher_;
    }

    /**
     * @notice Initializes the contract state
     * @dev Must be called atomically as part of the upgradeable proxy deployment to
     *      avoid front-running
     * @param controller_ Controller contract address
     */
    function initialize(IController controller_) external initializer(1) {
        __UControllerProvider__initialize(controller_);

        ICollateral _collateral = controller().collateral();
        Token18 token = _collateral.token();
        address reserve = address(batcher.RESERVE());
        token.approve(address(_collateral));
        token.approve(reserve);
        USDC.approve(address(batcher));
        USDC.approve(reserve);
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
                controller().collateral().withdrawFrom(msg.sender, receiver, product, amount);

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
                controller().incentivizer().claimFor(msg.sender, product, programIds);

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
        }
    }

    /**
     * @notice Deposits `amount` DSU from `msg.sender` into `account`s `product` collateral account
     * @param account Account to deposit funds on behalf of
     * @param product Product to deposit funds for
     * @param amount Amount of DSU to deposit into the collateral account
     */
    function depositTo(address account, IProduct product, UFixed18 amount) private {
        ICollateral _collateral = controller().collateral();

        // Pull the token from the `msg.sender`
        _collateral.token().pull(msg.sender, amount);

        // Deposit the amount to the collateral account
        _collateral.depositTo(account, product, amount);
    }

    /**
     * @notice Wraps `amount` USDC into DSU, pulling from `msg.sender` and sending to `receiver`
     * @param receiver Address to receive the DSU
     * @param amount Amount of USDC to wrap
     */
    function wrap(address receiver, UFixed18 amount) private {
        // Pull USDC from the `msg.sender`
        USDC.pull(msg.sender, amount, true);

        _wrap(controller().collateral().token(), receiver, amount);
    }

    /**
     * @notice Unwraps `amount` DSU into USDC, pulling from `msg.sender` and sending  to `receiver`
     * @param receiver Address to receive the USDC
     * @param amount Amount of DSU to unwrap
     */
    function unwrap(address receiver, UFixed18 amount) private {
        // Pull the token from the `msg.sender`
        controller().collateral().token().pull(msg.sender, amount);

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

        ICollateral _collateral = controller().collateral();
        _wrap(_collateral.token(), address(this), amount);

        // Deposit the amount to the collateral account
        _collateral.depositTo(account, product, amount);
    }

    /**
     * @notice Withdraws `amount` DSU from `msg.sender`s `product` collateral account, then unwraps the DSU into USDC and sends it to `receiver`
     * @param receiver Address to receive the USDC
     * @param product Product to withdraw funds for
     * @param amount Amount of DSU to withdraw from the collateral account
     */
    function withdrawAndUnwrap(address receiver, IProduct product, UFixed18 amount) private {
        // Withdraw the amount from the collateral account
        controller().collateral().withdrawFrom(msg.sender, address(this), product, amount);

        _unwrap(receiver, amount);
    }

    /**
     * @notice Helper function to wrap `amount` USDC from `msg.sender` into DSU using the batcher or reserve
     * @param token DSU token address
     * @param receiver Address to receive the DSU
     * @param amount Amount of USDC to wrap
     */
    function _wrap(Token18 token, address receiver, UFixed18 amount) private {
        // If the batcher doesn't have enough for this wrap, go directly to the reserve
        if (amount.gt(token.balanceOf(address(batcher)))) {
            batcher.RESERVE().mint(amount);
            if (receiver != address(this)) token.push(receiver, amount);
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
        // Unwrap the DSU into USDC and return to the receiver
        // The current batcher does not have UNWRAP functionality yet, so just go directly to the reserve
        batcher.RESERVE().redeem(amount);

        // Push the amount to the receiver
        USDC.push(receiver, amount);
    }
}
