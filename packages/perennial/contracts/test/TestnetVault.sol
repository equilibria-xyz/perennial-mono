// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import { IPerennialVault } from "../interfaces/IMultiInvoker.sol";

contract TestnetVault is ERC20, IPerennialVault {
    Token18 public immutable asset;
    mapping(address => UFixed18) public claimable;

    uint256 private _version;

    constructor(Token18 _asset) ERC20("TestnetVaultToken", "TVT") {
        asset = _asset;
    }

    function deposit(UFixed18 assets, address account) external {
        asset.pull(msg.sender, assets);

        _mint(account, UFixed18.unwrap(assets));

        emit Deposit(msg.sender, account, _version, assets);
    }

    function redeem(UFixed18 shares, address account) external {
        _burn(account, UFixed18.unwrap(shares));

        claimable[account] = claimable[account].add(shares);

        emit Redemption(msg.sender, account, _version, shares);
    }

    function claim(address owner) external {
        UFixed18 claimAmount = claimable[owner];
        claimable[owner] = UFixed18Lib.ZERO;
        asset.push(owner, claimAmount);

        emit Claim(msg.sender, owner, claimAmount);
    }

    function _incrementVersion() external {
        _version += 1;
    }
}
