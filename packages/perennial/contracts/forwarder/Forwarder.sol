// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.14;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/token/types/Token6.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import "../interfaces/ICollateral.sol";

/**
 * @title Forwarder
 * @notice Facilitates collateral deposits to the protocol where the amount is supplied
 *         in USDC then wrapped as DSU before being deposited.
 */
contract Forwarder {
    // @dev USDC stablecoin
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    // @dev DSU stablecoin
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Contract that wraps USDC to DSU
    IBatcher public immutable batcher;

    /// @dev Contract managing state for collateral accounts in the protocol
    ICollateral public immutable collateral;

    event WrapAndDeposit(address indexed account, IProduct indexed product, UFixed18 amount);

    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IBatcher batcher_,
        ICollateral collateral_
    ) {
        USDC = usdc_;
        DSU = dsu_;
        batcher = batcher_;
        collateral = collateral_;

        USDC.approve(address(batcher));
        DSU.approve(address(collateral));
    }

    /**
     * @notice Pulls `amount` of USDC from `msg.sender`'s balance, wraps it as DSU,
               and deposits it as collateral to `account`'s `product` account 
     * @param account Account to deposit the collateral for
     * @param product Product to credit the collateral to
     * @param amount 18 decimals-normalized stablecoin (USDC, DSU) value of collateral to deposit
    */
    function wrapAndDeposit(
        address account,
        IProduct product,
        UFixed18 amount
    ) external {
        USDC.pull(msg.sender, amount);
        batcher.wrap(amount, address(this));
        collateral.depositTo(account, product, amount);
        emit WrapAndDeposit(account, product, amount);
    }
}
