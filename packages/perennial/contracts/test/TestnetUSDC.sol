// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract TestnetUSDC is ERC20, ERC20Burnable {
    // solhint-disable-next-line no-empty-blocks
    constructor() ERC20("USD Coin", "USDC") { }

    function decimals() override public pure returns (uint8) {
      return 6;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
