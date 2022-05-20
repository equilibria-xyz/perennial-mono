// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.13;

import "./ProductProvider.sol";

/**
 * @title XProductProvider
 * @notice Library for manage storing and surfacing an product provider.
 * @dev Uses an immutable storage pattern to store the product provider parameters which is more gas efficient,
 *      but does not allow parameters to be updated over time.
 */
abstract contract XProductProvider is ProductProvider {
    /// @dev The maintenance value
    UFixed18 public immutable maintenance;

    /// @dev The funding fee value
    UFixed18 public immutable fundingFee;

    /// @dev The maker fee value
    UFixed18 public immutable makerFee;

    /// @dev The taker fee value
    UFixed18 public immutable takerFee;

    /// @dev The maker limit value
    UFixed18 public immutable makerLimit;

    /**
     * @notice Initializes the contract state
     * @param maintenance_ Maintenance value
     * @param fundingFee_ Funding fee value
     * @param makerFee_ Maker fee value
     * @param takerFee_ Taker fee value
     * @param makerLimit_ Maker limit value
     */
    constructor(
        UFixed18 maintenance_,
        UFixed18 fundingFee_,
        UFixed18 makerFee_,
        UFixed18 takerFee_,
        UFixed18 makerLimit_
    ) {
        maintenance = maintenance_;
        fundingFee = fundingFee_;
        makerFee = makerFee_;
        takerFee = takerFee_;
        makerLimit = makerLimit_;
    }
}
