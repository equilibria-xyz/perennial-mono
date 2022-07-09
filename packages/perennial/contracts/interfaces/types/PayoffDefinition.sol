// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/utils/Address.sol";
import "../../interfaces/IProductProvider.sol";

/// @dev PayoffDefinition tyoe
struct PayoffDefinition {
  PayoffDefinitionLib.PayoffType payoffType;
  bytes31 data;
}
using PayoffDefinitionLib for PayoffDefinition global;
type PayoffDefinitionStorage is bytes32;
using PayoffDefinitionStorageLib for PayoffDefinitionStorage global;

library PayoffDefinitionLib {
  error PayoffDefinitionNotContract(PayoffType payoffType, bytes31 data);

  /// @dev Provider type enum
  enum PayoffType { LONG, SHORT, CONTRACT }

  function valid(PayoffDefinition memory self) internal view returns (bool) {
    if (self.payoffType == PayoffType.CONTRACT) {
      return Address.isContract(address(providerContract(self)));
    }

    return true;
  }

  function providerContract(
    PayoffDefinition memory self
  ) internal pure returns (IProductProvider) {
    if (self.payoffType != PayoffType.CONTRACT) revert PayoffDefinitionNotContract(self.payoffType, self.data);
    // Shift to pull the last 20 bytes, then cast to an address
    return IProductProvider(address(bytes20(self.data << 88)));
  }

  function transform(
    PayoffDefinition memory self,
    Fixed18 price
  ) internal view returns (Fixed18) {
    if (self.payoffType == PayoffType.SHORT) {
      return price.mul(Fixed18Lib.NEG_ONE);
    } else if (self.payoffType == PayoffType.CONTRACT) {
      return providerContract(self).payoff(price);
    }

    return price;
  }
}

library PayoffDefinitionStorageLib {
    function read(PayoffDefinitionStorage self) internal view returns (PayoffDefinition memory) {
        return _storagePointer(self);
    }

    function store(PayoffDefinitionStorage self, PayoffDefinition memory value) internal {
        PayoffDefinition storage storagePointer = _storagePointer(self);

        storagePointer.payoffType = value.payoffType;
        storagePointer.data = value.data;
    }

    function _storagePointer(PayoffDefinitionStorage self)
    private pure returns (PayoffDefinition storage pointer) {
        assembly { pointer.slot := self }
    }
}
