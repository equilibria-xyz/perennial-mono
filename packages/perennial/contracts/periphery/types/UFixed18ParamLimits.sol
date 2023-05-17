// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed18.sol";

struct UFixed18ParamLimits {
    UFixed18 min;
    UFixed18 max;
}

using UFixed18ParamLimitsLib for UFixed18ParamLimits global;
type UFixed18ParamLimitsStorage is bytes32;
using UFixed18ParamLimitsStorageLib for UFixed18ParamLimitsStorage global;

library UFixed18ParamLimitsLib {
    function valid(UFixed18ParamLimits memory self, UFixed18 value) internal pure returns (bool) {
        return self.min.lt(value) && self.max.gt(value);
    }
}

library UFixed18ParamLimitsStorageLib {
    function read(UFixed18ParamLimitsStorage self) internal view returns (UFixed18ParamLimits memory) {
        return _storagePointer(self);
    }

    function store(UFixed18ParamLimitsStorage self, UFixed18ParamLimits memory value) internal {
        UFixed18ParamLimits storage storagePointer = _storagePointer(self);

        storagePointer.min = value.min;
        storagePointer.max = value.max;
    }

    function _storagePointer(UFixed18ParamLimitsStorage self)
    private pure returns (UFixed18ParamLimits storage pointer) {
        /// @solidity memory-safe-assembly
        assembly { pointer.slot := self } // solhint-disable-line no-inline-assembly
    }
}
