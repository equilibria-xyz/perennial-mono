// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./IMultiInvoker.sol";

interface IMultiInvokerRollup is IMultiInvoker {
    struct PTR {
        uint256 pos;
    }

    event AddressAddedToCache(address indexed value, uint256 index);

    error MultiInvokerRollupAddressIndexOutOfBoundsError();
    error MultiInvokerRollupInvalidUint256LengthError();
    error MultiInvokerRollupMissingMagicByteError();

    function addressCache(uint256 index) external view returns(address);
    function addressLookup(address value) external view returns(uint256 index);
}
