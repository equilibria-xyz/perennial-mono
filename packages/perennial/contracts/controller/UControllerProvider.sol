// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "@equilibria/root/storage/UStorage.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../interfaces/IController.sol";
import "../interfaces/IProduct.sol";

/**
 * @title UControllerProvider
 * @notice Mix-in that manages a controller pointer and associated permissioning modifiers.
 * @dev Uses unstructured storage so that it is safe to mix-in to upgreadable contracts without modifying
 *      their storage layout.
 */
abstract contract UControllerProvider is UInitializable {
    error NotOwnerError(uint256 coordinatorId);
    error NotProductError(IProduct product);
    error PausedError();
    error InvalidControllerError();

    /// @dev The controller contract address
    AddressStorage private constant _controller = AddressStorage.wrap(keccak256("equilibria.perennial.UControllerProvider.controller"));
    function controller() public view returns (IController) { return IController(_controller.read()); }

    /**
     * @notice Initializes the contract state
     * @param controller_ Protocol Controller contract address
     */
    // solhint-disable-next-line func-name-mixedcase
    function __UControllerProvider__initialize(IController controller_) internal onlyInitializer {
        if (!Address.isContract(address(controller_))) revert InvalidControllerError();
        _controller.store(address(controller_));
    }
}
