// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/token/types/Token6.sol";
import "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";

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
        UNWRAP,
        WRAP_AND_DEPOSIT,
        WITHDRAW_AND_UNWRAP
    }

    /// @dev Struct for action invocation
    struct Invocation {
        PerennialAction action;
        bytes args;
    }

    function initialize(IController controller_) external;
    function USDC() external view returns (Token6); // solhint-disable-line func-name-mixedcase
    function batcher() external view returns (IBatcher);
    function invoke(Invocation[] calldata invocations) external;
}
