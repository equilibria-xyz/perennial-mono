// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/token/types/Token6.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";

import "./IController.sol";
import "./ICollateral.sol";
import "./IProduct.sol";

interface IPerennialVault {
    event Deposit(address indexed sender, address indexed account, uint256 version, UFixed18 assets);
    event Redemption(address indexed sender, address indexed account, uint256 version, UFixed18 shares);
    event Claim(address indexed sender, address indexed account, UFixed18 assets);

    function deposit(UFixed18 assets, address account) external;
    function redeem(UFixed18 shares, address account) external;
    function claim(address account) external;
}

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
        WITHDRAW_AND_UNWRAP,
        VAULT_DEPOSIT,
        VAULT_REDEEM,
        VAULT_CLAIM,
        VAULT_WRAP_AND_DEPOSIT,
        CHARGE_FEE
    }

    /// @dev Struct for action invocation
    struct Invocation {
        PerennialAction action;
        bytes args;
    }

    function initialize() external;
    function USDC() external view returns (Token6); // solhint-disable-line func-name-mixedcase
    function DSU() external view returns (Token18); // solhint-disable-line func-name-mixedcase
    function batcher() external view returns (IBatcher);
    function controller() external view returns (IController);
    function collateral() external view returns (ICollateral);
    function reserve() external view returns (IEmptySetReserve);
    function invoke(Invocation[] calldata invocations) external;
}
