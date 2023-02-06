// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";
import "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/token/types/Token6.sol";
import "./TestnetReserve.sol";

contract TestnetBatcher is IBatcher {
    IEmptySetReserve public RESERVE;
    Token6 public USDC;
    Token18 public DSU;

    constructor(IEmptySetReserve reserve_, Token6 usdc_, Token18 dsu_) {
        RESERVE = reserve_;
        USDC = usdc_;
        DSU = dsu_;

        USDC.approve(address(RESERVE));
        DSU.approve(address(RESERVE));
    }

    function totalBalance() external pure returns (UFixed18) {
        return UFixed18Lib.MAX;
    }

    // Passthrough to Reserve
    function wrap(UFixed18 amount, address to) external {
        USDC.pull(msg.sender, amount, true);
        RESERVE.mint(amount);
        DSU.push(to, amount);

        emit Wrap(to, amount);
    }

    // Passthrough to Reserve
    function unwrap(UFixed18 amount, address to) external {
        DSU.pull(msg.sender, amount);
        RESERVE.redeem(amount);
        USDC.push(to, amount);

        emit Unwrap(to, amount);
    }

    // No-op
    function rebalance() external pure {
        return;
    }
}
