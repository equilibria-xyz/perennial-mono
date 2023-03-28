// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./IMultiInvoker.sol";

interface IMultiInvokerRollup is IMultiInvoker {
    event AddressAddedToCache(address indexed addr, uint256 nonce);
    /// @dev reverts when calldata has an issue. causes: length of bytes in a uint > || cache index empty
    error MultiInvokerRollupInvalidCalldataError();

    function addressCache(uint256 nonce) external view returns(address);
    function addressLookup(address addr) external view returns(uint256 nonce);
}
