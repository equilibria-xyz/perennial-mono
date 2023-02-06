// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.15;

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
    error NotCollateralError();
    error PausedError();
    error InvalidControllerError();
    error NotAccountOrMultiInvokerError(address account, address operator);

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

    /// @dev Only allow a valid product contract to call
    modifier onlyProduct {
        if (!controller().isProduct(IProduct(msg.sender))) revert NotProductError(IProduct(msg.sender));

        _;
    }

    /// @dev Verify that `product` is a valid product contract
    modifier isProduct(IProduct product) {
        if (!controller().isProduct(product)) revert NotProductError(product);

        _;
    }

    /// @dev Only allow the Collateral contract to call
    modifier onlyCollateral {
        if (msg.sender != address(controller().collateral())) revert NotCollateralError();

        _;
    }

    /// @dev Only allow the coordinator owner to call
    modifier onlyOwner(uint256 coordinatorId) {
        if (msg.sender != controller().owner(coordinatorId)) revert NotOwnerError(coordinatorId);

        _;
    }

    /// @dev Only allow if the protocol is currently unpaused
    modifier notPaused() {
        if (controller().paused()) revert PausedError();

        _;
    }

    /// @dev Ensure the `msg.sender` is ether the `account` or the Controller's multiInvoker
    modifier onlyAccountOrMultiInvoker(address account) {
        if (!(msg.sender == account || msg.sender == address(controller().multiInvoker()))) {
            revert NotAccountOrMultiInvokerError(account, msg.sender);
        }
        _;
    }
}
