// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/token/types/Token6.sol";
import "@equilibria/emptyset-batcher/batcher/Batcher.sol";

import "./IController.sol";
import "./IProduct.sol";

interface IMultiInvoker {
    /// @dev Core protocol actions that can be composed
    enum PerennialAction {
        NO_OP,
        DEPOSIT,
        WITHDRAW,
        OPEN_TAKE,
        CLOSE_TAKE,
        OPEN_MAKE,
        CLOSE_MAKE,
        CLAIM,
        WRAP,
        UNWRAP
    }

    /// @dev Struct for action invocation
    struct Invocation {
        PerennialAction action;
        IProduct product;
        bytes args;
    }

    function initialize() external;
    function USDC() external view returns (Token6); // solhint-disable-line func-name-mixedcase
    function batcher() external view returns (Batcher);
    function controller() external view returns (IController);
    function invoke(Invocation[] calldata invocations) external;
}
