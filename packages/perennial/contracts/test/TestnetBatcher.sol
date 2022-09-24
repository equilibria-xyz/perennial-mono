// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";
import "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/token/types/Token6.sol";
import "./TestnetReserve.sol";

contract TestnetBatcher is IBatcher {
    TestnetReserve public reserve;

    // solhint-disable-next-line no-empty-blocks
    constructor(TestnetReserve reserve_) {
        reserve = reserve_;

        reserve.USDC().approve(address(reserve));
        reserve.DSU().approve(address(reserve));
    }

    function totalBalance() external pure returns (UFixed18) {
        return UFixed18Lib.MAX;
    }

    // Passthrough to Reserve
    function wrap(UFixed18 amount, address to) external {
        reserve.USDC().pull(msg.sender, amount, true);
        reserve.mint(amount, to);

        emit Wrap(to, amount);
    }

    // Passthrough to Reserve
    function unwrap(UFixed18 amount, address to) external {
        reserve.DSU().pull(msg.sender, amount);
        reserve.redeem(amount, to);

        emit Unwrap(to, amount);
    }

    function rebalance() external pure {
        revert BatcherNotImplementedError();
    }
}
