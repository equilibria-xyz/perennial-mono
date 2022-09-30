// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@equilibria/emptyset-batcher/interfaces/IBatcher.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/token/types/Token6.sol";

contract TestnetReserve {
    event Mint(address indexed to, UFixed18 amount);
    event Redeem(address indexed to, UFixed18 amount);

    Token18 public immutable DSU; // solhint-disable-line var-name-mixedcase
    Token6 public immutable USDC; // solhint-disable-line var-name-mixedcase

    constructor(Token18 dsu_, Token6 usdc_) {
        DSU = dsu_;
        USDC = usdc_;
    }

    function mint(UFixed18 amount, address to) external {
        USDC.pull(msg.sender, amount, true);
        ERC20PresetMinterPauser(Token18.unwrap(DSU)).mint(to, UFixed18.unwrap(amount));

        emit Mint(to, amount);
    }

    function redeem(UFixed18 amount, address to) external {
        DSU.pull(msg.sender, amount);
        ERC20Burnable(Token18.unwrap(DSU)).burn(UFixed18.unwrap(amount));
        USDC.push(to, amount, true);

        emit Redeem(to, amount);
    }
}
