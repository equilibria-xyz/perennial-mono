// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.15;

import "@equilibria/root/curve/types/JumpRateUtilizationCurve.sol";
import "../interfaces/IProductProvider.sol";

contract TestnetProductProvider is IProductProvider {

    IOracleProvider public immutable oracle;
    JumpRateUtilizationCurveStorage private constant _utilizationCurve =
        JumpRateUtilizationCurveStorage.wrap(keccak256("equilibria.perennial.TestnetProductProvider.utilizationCurve"));

    constructor(IOracleProvider oracle_, JumpRateUtilizationCurve memory utilizationCurve_) {
        oracle = oracle_;
        _utilizationCurve.store(utilizationCurve_);
    }

    function sync() external returns (OracleVersion memory) {
        return _transform(oracle.sync());
    }

    function currentVersion() external view returns (OracleVersion memory) {
        return _transform(oracle.currentVersion());
    }

    function atVersion(uint256 oracleVersion) external view returns (OracleVersion memory) {
        return _transform(oracle.atVersion(oracleVersion));
    }

    function rate(Position memory position) external view returns (Fixed18) {
        UFixed18 utilization = position.taker.unsafeDiv(position.maker);
        Fixed18 annualizedRate = _utilizationCurve.read().compute(utilization);
        return annualizedRate.div(Fixed18Lib.from(365 days));
    }

    function _transform(OracleVersion memory oracleVersion) internal pure returns (OracleVersion memory) {
        return OracleVersion({
            version: oracleVersion.version,
            timestamp: oracleVersion.timestamp,
            price: _payoff(oracleVersion.price)
        });
    }

    function _payoff(Fixed18 price) internal pure returns (Fixed18) {
        return price.mul(price);
    }
}
