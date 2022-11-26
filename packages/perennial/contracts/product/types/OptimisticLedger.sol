// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/root/number/types/UFixed18.sol";

/// @dev OptimisticLedger type
struct OptimisticLedger {
    /// @dev Individual account collateral balances
    mapping(address => UFixed18) balances;

    /// @dev Total ledger collateral shortfall
    UFixed18 shortfall;
}
using OptimisticLedgerLib for OptimisticLedger global;

/**
 * @title OptimisticLedgerLib
 * @notice Library that manages a global vs account ledger where the global ledger is settled separately,
 *         and ahead of, the user-level accounts.
 * @dev    Ensures that no more collateral leaves the ledger than goes it, while allowing user-level accounts
 *         to settle as a follow up step. Overdrafts on the user-level are accounted as "shortall". Shortfall
 *         in the system is the quantity of insolvency that can be optionally resolved by the ledger owner.
 *         Until the shortfall is resolved, collateral may be withdrawn from the ledger on a FCFS basis. However
 *         once the ledger total has been depleted, users will not be able to withdraw even if they have non-zero
 *         user level balances until the shortfall is resolved, recapitalizing the ledger.
 */
library OptimisticLedgerLib {
    /**
     * @notice Credits `account` with `amount` collateral
     * @dev Funds come from inside the product, not totals are updated
     *      Shortfall is created if more funds are debited from an account than exist
     * @param self The struct to operate on
     * @param account Account to credit collateral to
     * @param amount Amount of collateral to credit
     * @return newShortfall Any new shortfall incurred during this settlement
     */
    function settleAccount(OptimisticLedger storage self, address account, Fixed18 amount)
    internal returns (UFixed18 newShortfall) {
        Fixed18 newBalance = Fixed18Lib.from(self.balances[account]).add(amount);

        newShortfall = newBalance.min(Fixed18Lib.ZERO).abs();
        newBalance = newBalance.max(Fixed18Lib.ZERO);

        self.balances[account] = UFixed18Lib.from(newBalance);
        self.shortfall = self.shortfall.add(newShortfall);
    }

    /**
     * @notice Reduces the amount of collateral shortfall in the ledger
     * @param self The struct to operate on
     * @param amount Amount of shortfall to resolve
     */
    function resolve(OptimisticLedger storage self, UFixed18 amount) internal {
        self.shortfall = self.shortfall.sub(amount);
    }
}
