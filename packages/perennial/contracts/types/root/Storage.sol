// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

library Storage {
    function read(bytes32 slot, uint256 offset, uint256 size) internal pure returns (bytes32) {
        return (slot & bytes32((2 ** size - 1) << (256 - offset - size))) >> offset;
    }

    function write(bytes32 slot, uint256 offset, uint256 size, bytes32 data) internal pure returns (bytes32) {
        bytes32 mask = bytes32((2 ** size - 1) << (256 - offset - size));
        return (slot & ~mask) | (data << (256 - offset - size));
    }
}
