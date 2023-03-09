// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./IMultiInvoker.sol";

interface IMultiInvokerRollup is IMultiInvoker {
    function addressNonce() external view returns(uint256);
    function addressCache(uint256 nonce) external view returns(address);
    function addressNonces(address addr) external view returns(uint256 nonce);
}
