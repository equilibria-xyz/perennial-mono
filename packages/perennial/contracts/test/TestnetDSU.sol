// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract TestnetDSU is ERC20, ERC20Burnable {
    uint256 private constant LIMIT = 1_000_000e18;

    address public minter;

    error TestnetDSUNotMinterError();
    error TestnetDSUOverLimitError();

    event TestnetDSUMinterUpdated(address indexed newMinter);

    constructor(address _minter) ERC20("Digital Standard Unit", "DSU") {
        minter = _minter;
    }

    function mint(address account, uint256 amount) external onlyMinter {
        if (amount > LIMIT) revert TestnetDSUOverLimitError();

        _mint(account, amount);
    }

    function updateMinter(address newMinter) external onlyMinter {
        minter = newMinter;

        emit TestnetDSUMinterUpdated(newMinter);
    }

    modifier onlyMinter() {
        if (msg.sender != minter) revert TestnetDSUNotMinterError();
        _;
    }
}
