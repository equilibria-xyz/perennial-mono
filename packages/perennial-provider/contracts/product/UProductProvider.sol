// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/unstructured/UOwnable.sol";
import "./ProductProvider.sol";

/**
 * @title UProductProvider
 * @notice Library for manage storing, surfacing, and upgrading a product provider.
 * @dev Uses an unstructured storage pattern to store the product provider parameters which allows this provider to be
 *      safely used with upgradeable contracts.
 */
abstract contract UProductProvider is ProductProvider, UOwnable {
    event MaintenanceUpdated(UFixed18 newMaintenance);
    event FundingFeeUpdated(UFixed18 newFundingFee);
    event MakerFeeUpdated(UFixed18 newMakerFee);
    event TakerFeeUpdated(UFixed18 newTakerFee);
    event MakerLimitUpdated(UFixed18 newMakerLimit);

    /// @dev The maintenance value
    UFixed18Storage private constant _maintenance = UFixed18Storage.wrap(keccak256("equilibria.perennial.UProductProvider.maintenance"));
    function maintenance() external view returns (UFixed18) { return _maintenance.read(); }

    /// @dev The funding fee value
    UFixed18Storage private constant _fundingFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.UProductProvider.fundingFee"));
    function fundingFee() external view returns (UFixed18) { return _fundingFee.read(); }

    /// @dev The maker fee value
    UFixed18Storage private constant _makerFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.UProductProvider.makerFee"));
    function makerFee() external view returns (UFixed18) { return _makerFee.read(); }

    /// @dev The taker fee value
    UFixed18Storage private constant _takerFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.UProductProvider.takerFee"));
    function takerFee() external view returns (UFixed18) { return _takerFee.read(); }

    /// @dev The maker limit value
    UFixed18Storage private constant _makerLimit = UFixed18Storage.wrap(keccak256("equilibria.perennial.UProductProvider.makerLimit"));
    function makerLimit() external view returns (UFixed18) { return _makerLimit.read(); }

    /**
     * @notice Initializes the contract state
     * @param maintenance_ Initial maintenance value
     * @param fundingFee_ Initial funding fee value
     * @param makerFee_ Initial maker fee value
     * @param takerFee_ Initial taker fee value
     * @param makerLimit_ Initial maker limit value
     */
    // solhint-disable-next-line func-name-mixedcase
    function __UProductProvider__initialize(
        UFixed18 maintenance_,
        UFixed18 fundingFee_,
        UFixed18 makerFee_,
        UFixed18 takerFee_,
        UFixed18 makerLimit_
    ) internal onlyInitializer {
        updateMaintenance(maintenance_);
        updateFundingFee(fundingFee_);
        updateMakerFee(makerFee_);
        updateTakerFee(takerFee_);
        updateMakerLimit(makerLimit_);
    }

    /**
     * @notice Updates the maintenance to `newMaintenance`
     * @param newMaintenance new maintenance value
     */
    function updateMaintenance(UFixed18 newMaintenance) public onlyOwner {
        _maintenance.store(newMaintenance);
        emit MaintenanceUpdated(newMaintenance);
    }

    /**
     * @notice Updates the funding fee to `newFundingFee`
     * @param newFundingFee new funding fee value
     */
    function updateFundingFee(UFixed18 newFundingFee) public onlyOwner {
        _fundingFee.store(newFundingFee);
        emit FundingFeeUpdated(newFundingFee);
    }

    /**
     * @notice Updates the maker fee to `newMakerFee`
     * @param newMakerFee new maker fee value
     */
    function updateMakerFee(UFixed18 newMakerFee) public onlyOwner {
        _makerFee.store(newMakerFee);
        emit MakerFeeUpdated(newMakerFee);
    }

    /**
     * @notice Updates the taker fee to `newTakerFee`
     * @param newTakerFee new taker fee value
     */
    function updateTakerFee(UFixed18 newTakerFee) public onlyOwner {
        _takerFee.store(newTakerFee);
        emit TakerFeeUpdated(newTakerFee);
    }

    /**
     * @notice Updates the maker limit to `newMakerLimit`
     * @param newMakerLimit new maker limit value
     */
    function updateMakerLimit(UFixed18 newMakerLimit) public onlyOwner {
        _makerLimit.store(newMakerLimit);
        emit MakerLimitUpdated(newMakerLimit);
    }
}
