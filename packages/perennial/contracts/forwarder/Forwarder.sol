// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.14;

import "../interfaces/IForwarder.sol";

/**
 * @title Forwarder
 * @notice Facilitates collateral deposits to the protocol where the amount is supplied
 *         in USDC then wrapped as DSU before being deposited.
 */
contract Forwarder is IForwarder {
    // @dev USDC stablecoin
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    // @dev DSU stablecoin
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Contract that wraps USDC to DSU
    IBatcher public immutable batcher;

    /// @dev Contract managing state for collateral accounts in the protocol
    ICollateral public immutable collateral;

    /**
     * @notice Initializes the contract state
     * @param usdc_ The USDC token contract address
     * @param dsu_ The DSU token contract address
     * @param batcher_ The USDC-to-DSU batcher contract address
     * @param collateral_ The perennial collateral contract address
     */
    constructor(
        Token6 usdc_,
        Token18 dsu_,
        IBatcher batcher_,
        ICollateral collateral_
    ) {
        if (!Address.isContract(Token6.unwrap(usdc_))) revert ForwarderNotContractAddressError();
        if (!Address.isContract(Token18.unwrap(dsu_))) revert ForwarderNotContractAddressError();
        if (!Address.isContract(address(batcher_))) revert ForwarderNotContractAddressError();
        if (!Address.isContract(address(collateral_))) revert ForwarderNotContractAddressError();

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
        USDC.pull(msg.sender, amount, true);
        batcher.wrap(amount, address(this));
        collateral.depositTo(account, product, amount);
        emit WrapAndDeposit(account, product, amount);
    }
}
