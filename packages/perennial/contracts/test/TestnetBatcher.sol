// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";
import "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/token/types/Token6.sol";
import "./TestnetReserve.sol";

contract TestnetBatcher is IBatcher {
    TestnetReserve public reserve;

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

    function unwrap(UFixed18, address) external pure {
        revert BatcherNotImplementedError();
    }

    // No-op
    function rebalance() external pure {
        return;
    }
}
