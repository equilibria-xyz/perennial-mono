// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "../../interfaces/IProductProvider.sol";

/// @dev PackedProvider tyoe
type PackedProvider is bytes32;
using PackedProviderLib for PackedProvider global;

library PackedProviderLib {
  enum ProviderType { PASSTHROUGH, CONTRACT }

  function providerType(
    PackedProvider self
  ) internal pure returns (ProviderType pType) {
    pType = ProviderType(uint8(PackedProvider.unwrap(self)[0]));
  }

  function providerContract(
    PackedProvider self
  ) internal pure returns (IProductProvider addr) {
    // Shift to pull the last 20 bytes, then cast to an address
    addr = IProductProvider(address(bytes20(PackedProvider.unwrap(self) << 96)));
  }
}
