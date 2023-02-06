// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/token/types/Token6.sol";

contract TestnetReserve is IEmptySetReserve {
    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    constructor(Token18 dsu_, Token6 usdc_) {
        DSU = dsu_;
        USDC = usdc_;
    }

    function mint(UFixed18 amount) external {
        USDC.pull(msg.sender, amount, true);
        ERC20PresetMinterPauser(Token18.unwrap(DSU)).mint(msg.sender, UFixed18.unwrap(amount));

        uint256 pulledAmount = Math.ceilDiv(UFixed18.unwrap(amount), 1e12);
        emit Mint(msg.sender, UFixed18.unwrap(amount), pulledAmount);
    }

    function redeem(UFixed18 amount) external {
        DSU.pull(msg.sender, amount);
        ERC20Burnable(Token18.unwrap(DSU)).burn(UFixed18.unwrap(amount));
        USDC.push(msg.sender, amount, true);

        uint256 pushedAmount = UFixed18.unwrap(amount) / 1e12;
        emit Redeem(msg.sender, UFixed18.unwrap(amount), pushedAmount);
    }

    function debt(address) external pure returns (UFixed18) {
        return UFixed18Lib.ZERO;
    }

    function repay(address, UFixed18) external pure {
        return;
    }
}
