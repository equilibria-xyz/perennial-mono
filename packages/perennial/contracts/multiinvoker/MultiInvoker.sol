// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "hardhat/console.sol";
import "@equilibria/root/control/unstructured/UInitializable.sol";

import "../interfaces/IProduct.sol";
import "../interfaces/ICollateral.sol";
import "../interfaces/IMultiInvoker.sol";

contract MultiInvoker is IMultiInvoker, UInitializable {
    /// @dev USDC stablecoin address
    Token6 public immutable USDC;

    /// @dev Controller address
    IController public immutable controller;

    /// @dev Batcher address
    Batcher public immutable batcher;

    /**
     * @notice Initializes the immutable contract state
     * @dev Called at implementation instantiate and constant for that implementation.
     * @param usdc_ USDC stablecoin address
     * @param controller_ Protocol Controller address
     * @param batcher_ Protocol Batcher address
     */
    constructor(Token6 usdc_, IController controller_, Batcher batcher_) {
        USDC = usdc_;
        controller = controller_;
        batcher = batcher_;
    }

    function initialize() external initializer(1) {
        ICollateral _collateral = controller.collateral();
        Token18 token = _collateral.token();
        token.approve(address(_collateral));
        token.approve(address(batcher));
        token.approve(address(batcher.RESERVE()));
        USDC.approve(address(batcher));
    }

    /**
     * @notice Executes a list of invocations in order
     * @param invocations The list of invocations to execute in order
     */
    function invoke(Invocation[] calldata invocations) external {
        for (uint i = 0; i < invocations.length; i++) {
            Invocation memory invocation = invocations[i];

            // Deposit from `msg.sender` into `account`s `product` collateral account
            if (invocation.action == PerennialAction.DEPOSIT) {
                (address account, uint amount) = abi.decode(invocation.args, (address, uint));
                depositTo(msg.sender, account, invocation.product, UFixed18.wrap(amount));

            // Withdraw from `msg.sender`s `product` collateral account to `account`
            } else if (invocation.action == PerennialAction.WITHDRAW) {
                (address account, uint amount) = abi.decode(invocation.args, (address, uint));
                collateral().withdrawFrom(msg.sender, account, invocation.product, UFixed18.wrap(amount));

            // Open a take position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.OPEN_TAKE) {
                (uint amount) = abi.decode(invocation.args, (uint));
                invocation.product.openTakeFor(msg.sender, UFixed18.wrap(amount));

            // Close a take position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.CLOSE_TAKE) {
                (uint amount) = abi.decode(invocation.args, (uint));
                invocation.product.closeTakeFor(msg.sender, UFixed18.wrap(amount));

            // Open a make position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.OPEN_MAKE) {
                (uint amount) = abi.decode(invocation.args, (uint));
                invocation.product.openMakeFor(msg.sender, UFixed18.wrap(amount));

            // Close a make position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.CLOSE_MAKE) {
                (uint amount) = abi.decode(invocation.args, (uint));
                invocation.product.closeMakeFor(msg.sender, UFixed18.wrap(amount));

            // Claim `msg.sender`s incentive reward for `product` programs
            } else if (invocation.action == PerennialAction.CLAIM) {
                (uint[] memory programIds) = abi.decode(invocation.args, (uint[]));
                incentivizer().claimFor(msg.sender, invocation.product, programIds);

            // Wrap `msg.sender`s USDC into DSU and return the DSU to `account`
            } else if (invocation.action == PerennialAction.WRAP) {
                (address account, uint amount) = abi.decode(invocation.args, (address, uint));
                wrap(msg.sender, account, UFixed18.wrap(amount));

            // Unwrap `msg.sender`s DSU into USDC and return the USDC to `account`
            } else if (invocation.action == PerennialAction.UNWRAP) {
                (address account, uint amount) = abi.decode(invocation.args, (address, uint));
                unwrap(msg.sender, account, UFixed18.wrap(amount));
            }
        }
    }

    function collateral() private view returns (ICollateral) {
        return controller.collateral();
    }

    function incentivizer() private view returns (IIncentivizer) {
        return controller.incentivizer();
    }

    function depositTo(address from, address account, IProduct product, UFixed18 amount) private {
        ICollateral _collateral = collateral();

        // Pull the token from the account
        _collateral.token().pull(from, amount);

        // Deposit the amount to the collateral account
        _collateral.depositTo(account, product, amount);
    }

    function wrap(address from, address account, UFixed18 amount) private {
        // Pull USDC from the account
        USDC.pull(from, amount, true);

        // Wrap the USDC into DSU and return to the account
        batcher.wrap(amount, account);
    }

    function unwrap(address from, address account, UFixed18 amount) private {
        // Pull the token from the account
        collateral().token().pull(from, amount);

        // Unwrap the DSU into USDC and return to the account
        // The current batcher does not have UNWRAP functionality yet, so just go directly to the reserve
        batcher.RESERVE().redeem(amount);

        // Push the amount to the user
        USDC.push(account, amount);
    }
}
