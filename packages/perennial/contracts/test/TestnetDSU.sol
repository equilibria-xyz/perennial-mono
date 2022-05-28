// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.14;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract TestnetDSU is ERC20, ERC20Burnable {
    uint256 private constant LIMIT = 1_000_000e18;

    error TestnetDSUOverLimitError();

    // solhint-disable-next-line no-empty-blocks
    constructor() ERC20("Digital Standard Unit", "DSU") { }

    function mint(address account, uint256 amount) external {
        if (amount > LIMIT) revert TestnetDSUOverLimitError();

        _mint(account, amount);
    }
}
