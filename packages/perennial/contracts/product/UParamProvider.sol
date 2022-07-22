// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/control/unstructured/UInitializable.sol";
import "../interfaces/IParamProvider.sol";
import "../interfaces/IProduct.sol";

abstract contract UParamProvider is IParamProvider, UInitializable {
    /**
     * @notice Initializes the contract state
     * @param productInfo_ product info struct
     */
    // solhint-disable-next-line func-name-mixedcase
    function __UParamProvider__initialize(IProduct.ProductInfo calldata productInfo_) internal onlyInitializer {
        _updateMaintenance(productInfo_.maintenance);
        _updateFundingFee(productInfo_.fundingFee);
        _updateMakerFee(productInfo_.makerFee);
        _updateTakerFee(productInfo_.takerFee);
        _updateMakerLimit(productInfo_.makerLimit);
        _updateUtilizationCurve(productInfo_.utilizationCurve);
    }

    /// @dev The maintenance value
    UFixed18Storage private constant _maintenance = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.maintenance"));
    function maintenance() public view returns (UFixed18) { return _maintenance.read(); }

    /// @dev The funding fee value
    UFixed18Storage private constant _fundingFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.fundingFee"));
    function fundingFee() public view returns (UFixed18) { return _fundingFee.read(); }

    /// @dev The maker fee value
    UFixed18Storage private constant _makerFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.makerFee"));
    function makerFee() public view returns (UFixed18) { return _makerFee.read(); }

    /// @dev The taker fee value
    UFixed18Storage private constant _takerFee = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.takerFee"));
    function takerFee() public view returns (UFixed18) { return _takerFee.read(); }

    /// @dev The maker limit value
    UFixed18Storage private constant _makerLimit = UFixed18Storage.wrap(keccak256("equilibria.perennial.Product.makerLimit"));
    function makerLimit() public view returns (UFixed18) { return _makerLimit.read(); }

    /// @dev The JumpRateUtilizationCurve params
    JumpRateUtilizationCurveStorage private constant _utilizationCurve =
        JumpRateUtilizationCurveStorage.wrap(keccak256("equilibria.perennial.Product.jumpRateUtilizationCurve"));
    function utilizationCurve() public view returns (JumpRateUtilizationCurve memory) { return _utilizationCurve.read(); }

        /**
     * @notice Updates the maintenance to `newMaintenance`
     * @param newMaintenance new maintenance value
     */
    function _updateMaintenance(UFixed18 newMaintenance) internal {
        _maintenance.store(newMaintenance);
        emit MaintenanceUpdated(newMaintenance);
    }

    /**
     * @notice Updates the funding fee to `newFundingFee`
     * @param newFundingFee new funding fee value
     */
    function _updateFundingFee(UFixed18 newFundingFee) internal {
        if (newFundingFee.gt(UFixed18Lib.ONE)) revert ProductInvalidFundingFee();
        _fundingFee.store(newFundingFee);
        emit FundingFeeUpdated(newFundingFee);
    }

        /**
     * @notice Updates the maker fee to `newMakerFee`
     * @param newMakerFee new maker fee value
     */
    function _updateMakerFee(UFixed18 newMakerFee) internal {
        if (newMakerFee.gt(UFixed18Lib.ONE)) revert ProductInvalidMakerFee();
        _makerFee.store(newMakerFee);
        emit MakerFeeUpdated(newMakerFee);
    }

        /**
     * @notice Updates the taker fee to `newTakerFee`
     * @param newTakerFee new taker fee value
     */
    function _updateTakerFee(UFixed18 newTakerFee) internal {
        if (newTakerFee.gt(UFixed18Lib.ONE)) revert ProductInvalidTakerFee();
        _takerFee.store(newTakerFee);
        emit TakerFeeUpdated(newTakerFee);
    }

    /**
     * @notice Updates the maker limit to `newMakerLimit`
     * @param newMakerLimit new maker limit value
     */
    function _updateMakerLimit(UFixed18 newMakerLimit) internal {
        _makerLimit.store(newMakerLimit);
        emit MakerLimitUpdated(newMakerLimit);
    }

    /**
     * @notice Updates the utilization curve limit to `newUtilizationCurve`
     * @param newUtilizationCurve new utilization curve value
     */
    function _updateUtilizationCurve(JumpRateUtilizationCurve memory newUtilizationCurve) internal {
        _utilizationCurve.store(newUtilizationCurve);
        emit JumpRateUtilizationCurveUpdated(
            newUtilizationCurve.minRate.unpack(),
            newUtilizationCurve.maxRate.unpack(),
            newUtilizationCurve.targetRate.unpack(),
            newUtilizationCurve.targetUtilization.unpack()
        );
    }
}
