//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/perennial/contracts/interfaces/ICollateral.sol";
import "./interfaces/IBalancedVaultDefinition.sol";

library PerennialLib {
    /**
     * @notice Adjusts the position on `product` to `targetPosition`
     * @param product The product to adjust the vault's position on
     * @param targetPosition The new position to target
     */
    function updateMakerPosition(IProduct product, UFixed18 targetPosition) internal {
        UFixed18 accountPosition = product.position(address(this)).next(product.pre(address(this))).maker;

        if (targetPosition.lt(accountPosition)) {
            // compute headroom until hitting taker amount
            Position memory position = product.positionAtVersion(product.latestVersion()).next(product.pre());
            UFixed18 makerAvailable = position.maker.gt(position.taker) ?
                position.maker.sub(position.taker) :
                UFixed18Lib.ZERO;

            product.closeMake(accountPosition.sub(targetPosition).min(makerAvailable));
        }

        if (targetPosition.gt(accountPosition)) {
            // compute headroom until hitting makerLimit
            UFixed18 currentMaker = product.positionAtVersion(product.latestVersion()).next(product.pre()).maker;
            UFixed18 makerLimit = product.makerLimit();
            UFixed18 makerAvailable = makerLimit.gt(currentMaker) ? makerLimit.sub(currentMaker) : UFixed18Lib.ZERO;

            product.openMake(targetPosition.sub(accountPosition).min(makerAvailable));
        }
    }

    /**
     * @notice Adjusts the collateral on `product` to `targetCollateral`
     * @param collateral The Perennial collateral contract
     * @param product The product to adjust the vault's collateral on
     * @param targetCollateral The new collateral to target
     */
    function updateCollateral(ICollateral collateral, IProduct product, UFixed18 targetCollateral) internal {
        UFixed18 currentCollateral = collateral.collateral(address(this), product);

        //TODO: compute if we're withdrawing more than maintenance

        if (currentCollateral.gt(targetCollateral))
            collateral.withdrawTo(address(this), product, currentCollateral.sub(targetCollateral));
        if (currentCollateral.lt(targetCollateral))
            collateral.depositTo(address(this), product, targetCollateral.sub(currentCollateral));
    }
}
