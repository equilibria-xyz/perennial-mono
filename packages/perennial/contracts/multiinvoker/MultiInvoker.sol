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

    /**
     * @notice Initializes the contract state
     * @dev Must be called atomically as part of the upgradeable proxy deployment to
     *      avoid front-running
     */
    function initialize() external initializer(1) {
        ICollateral _collateral = controller.collateral();
        Token18 token = _collateral.token();
        token.approve(address(_collateral));
        token.approve(address(batcher.RESERVE()));
        USDC.approve(address(batcher));
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
                (address account, uint256 amount) = abi.decode(invocation.args, (address, uint256));
                depositTo(account, invocation.product, UFixed18.wrap(amount));

            // Withdraw from `msg.sender`s `product` collateral account to `receiver`
            } else if (invocation.action == PerennialAction.WITHDRAW) {
                (address receiver, uint256 amount) = abi.decode(invocation.args, (address, uint256));
                controller.collateral().withdrawFrom(msg.sender, receiver, invocation.product, UFixed18.wrap(amount));

            // Open a take position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.OPEN_TAKE) {
                (uint256 amount) = abi.decode(invocation.args, (uint256));
                invocation.product.openTakeFor(msg.sender, UFixed18.wrap(amount));

            // Close a take position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.CLOSE_TAKE) {
                (uint256 amount) = abi.decode(invocation.args, (uint256));
                invocation.product.closeTakeFor(msg.sender, UFixed18.wrap(amount));

            // Open a make position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.OPEN_MAKE) {
                (uint256 amount) = abi.decode(invocation.args, (uint256));
                invocation.product.openMakeFor(msg.sender, UFixed18.wrap(amount));

            // Close a make position on behalf of `msg.sender`
            } else if (invocation.action == PerennialAction.CLOSE_MAKE) {
                (uint256 amount) = abi.decode(invocation.args, (uint256));
                invocation.product.closeMakeFor(msg.sender, UFixed18.wrap(amount));

            // Claim `msg.sender`s incentive reward for `product` programs
            } else if (invocation.action == PerennialAction.CLAIM) {
                (uint256[] memory programIds) = abi.decode(invocation.args, (uint256[]));
                controller.incentivizer().claimFor(msg.sender, invocation.product, programIds);

            // Wrap `msg.sender`s USDC into DSU and return the DSU to `account`
            } else if (invocation.action == PerennialAction.WRAP) {
                (address receiver, uint256 amount) = abi.decode(invocation.args, (address, uint256));
                wrap(receiver, UFixed18.wrap(amount));

            // Unwrap `msg.sender`s DSU into USDC and return the USDC to `account`
            } else if (invocation.action == PerennialAction.UNWRAP) {
                (address receiver, uint256 amount) = abi.decode(invocation.args, (address, uint256));
                unwrap(receiver, UFixed18.wrap(amount));
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
        ICollateral _collateral = controller.collateral();

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

        // Wrap the USDC into DSU and return to the receiver
        batcher.wrap(amount, receiver);
    }

    /**
     * @notice Unwraps `amount` DSU into USDC, pulling from `msg.sender` and sending  to `receiver`
     * @param receiver Address to receive the USDC
     * @param amount Amount of DSU to unwrap
     */
    function unwrap(address receiver, UFixed18 amount) private {
        // Pull the token from the `msg.sender`
        controller.collateral().token().pull(msg.sender, amount);

        // Unwrap the DSU into USDC and return to the receiver
        // The current batcher does not have UNWRAP functionality yet, so just go directly to the reserve
        batcher.RESERVE().redeem(amount);

        // Push the amount to the receiver
        USDC.push(receiver, amount);
    }
}
