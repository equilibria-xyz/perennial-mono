// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/Fixed18.sol";
import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";

struct UtilizationCurveLimits {
    Fixed18 minMinRate;
    Fixed18 maxMinRate;
    Fixed18 minMaxRate;
    Fixed18 maxMaxRate;
    Fixed18 minTargetRate;
    Fixed18 maxTargetRate;
    UFixed18 minTargetUtilization;
    UFixed18 maxTargetUtilization;
}

using UtilizationCurveLimitsLib for UtilizationCurveLimits global;
type UtilizationCurveLimitsStorage is bytes32;
using UtilizationCurveLimitsStorageLib for UtilizationCurveLimitsStorage global;

library UtilizationCurveLimitsLib {
    function valid(UtilizationCurveLimits memory self, JumpRateUtilizationCurve memory value) internal pure returns (bool) {
        return self.minMinRate.lt(value.minRate.unpack()) &&
            self.maxMinRate.gt(value.minRate.unpack()) &&
            self.minMaxRate.lt(value.maxRate.unpack()) &&
            self.maxMaxRate.gt(value.maxRate.unpack()) &&
            self.minTargetRate.lt(value.targetRate.unpack()) &&
            self.maxTargetRate.gt(value.targetRate.unpack()) &&
            self.minTargetUtilization.lt(value.targetUtilization.unpack()) &&
            self.maxTargetUtilization.gt(value.targetUtilization.unpack());
    }
}

library UtilizationCurveLimitsStorageLib {
    function read(UtilizationCurveLimitsStorage self) internal view returns (UtilizationCurveLimits memory) {
        return _storagePointer(self);
    }

    function store(UtilizationCurveLimitsStorage self, UtilizationCurveLimits memory value) internal {
        UtilizationCurveLimits storage storagePointer = _storagePointer(self);

        storagePointer.minMinRate = value.minMinRate;
        storagePointer.maxMinRate = value.maxMinRate;
        storagePointer.minMaxRate = value.minMaxRate;
        storagePointer.maxMaxRate = value.maxMaxRate;
        storagePointer.minTargetRate = value.minTargetRate;
        storagePointer.maxTargetRate = value.maxTargetRate;
        storagePointer.minTargetUtilization = value.minTargetUtilization;
        storagePointer.maxTargetUtilization = value.maxTargetUtilization;
    }

    function _storagePointer(UtilizationCurveLimitsStorage self)
    private pure returns (UtilizationCurveLimits storage pointer) {
        /// @solidity memory-safe-assembly
        assembly { pointer.slot := self } // solhint-disable-line no-inline-assembly
    }
}
