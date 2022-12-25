// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "./interfaces/ILens.sol";

/**
 * @title Lens contract to conveniently pull protocol data
 * @notice All functions should be called using `callStatic`
 */
contract Lens is ILens {
    /**
     * @notice Protocol factory
     * @return Protocol factory
     */
    IFactory public immutable factory;

    /// @param _factory Protocol factory address
    constructor(IFactory _factory) {
        factory = _factory;
    }

    /**
     *  Snapshot Functions
     */

    /**
     * @notice Returns the snapshots of the provided `marketAddresses`
     * @param marketAddresses Market addresses
     * @return _snapshots a snapshot for each market after settle
     */
    function snapshots(IMarket[] calldata marketAddresses) public returns (MarketSnapshot[] memory _snapshots) {
        _snapshots = new MarketSnapshot[](marketAddresses.length);
        for (uint256 i = 0; i < marketAddresses.length; i++) {
            _snapshots[i] = snapshot(marketAddresses[i]);
        }
    }

    /**
     * @notice Returns the snapshot of the provided `market`
     * @param market Market address
     * @return _snapshot for the market after settle
     */
    function snapshot(IMarket market) public settle(market) returns (MarketSnapshot memory _snapshot) {
        _snapshot.definition = definition(market);
        _snapshot.parameter = parameter(market);
        _snapshot.marketAddress = address(market);
        _snapshot.rate = rate(market);
        _snapshot.dailyRate = dailyRate(market);
        _snapshot.latestVersion = latestVersion(market);
        _snapshot.collateral = collateral(market);
        _snapshot.position = position(market);
        _snapshot.fee = fees(market);
        (_snapshot.openMakerInterest, _snapshot.openTakerInterest) = openInterest(market);
    }

    /**
     * @notice Returns the user snapshots for the provided `marketAddresses`
     * @param account User addresses
     * @param marketAddresses Market addresses
     * @return _snapshots UserSnapshot for each market after settle
     */
    function snapshots(address account, IMarket[] memory marketAddresses)
        public returns (UserMarketSnapshot[] memory _snapshots)
    {
        _snapshots = new UserMarketSnapshot[](marketAddresses.length);
        for (uint256 i = 0; i < marketAddresses.length; i++) {
            _snapshots[i] = snapshot(account, marketAddresses[i]);
        }
    }

    /**
     * @notice Returns the user snapshot for the provided `market`
     * @param account User addresses
     * @param market Market address
     * @return _snapshot UserSnapshot for the market after settle
     */
    function snapshot(address account, IMarket market)
        public
        settleAccount(account, market)
        returns (UserMarketSnapshot memory _snapshot)
    {
        _snapshot.marketAddress = address(market);
        _snapshot.userAddress = account;
        _snapshot.collateral = collateral(account, market);
        _snapshot.maintenance = maintenance(account, market);
        _snapshot.next = next(account, market);
        _snapshot.position = position(account, market);
        _snapshot.liquidatable = liquidatable(account, market);
        _snapshot.openInterest = openInterest(account, market);
        _snapshot.exposure = exposure(account, market);
    }

    /**
     *  End Snapshot Functions
     */

    /**
     *  Market Individual Fields Functions
     */

    /**
     * @notice Returns the name of the provided `market`
     * @param market Market address
     * @return Name of the market
     */
    function name(IMarket market) public view returns (string memory) {
        return market.name();
    }

    /**
     * @notice Returns the symbol of the provided `market`
     * @param market Market address
     * @return Symbol of the market
     */
    function symbol(IMarket market) public view returns (string memory) {
        return market.symbol();
    }

    function token(IMarket market) public view returns (Token18) {
        return market.token();
    }

    function definition(IMarket market) public view returns (IMarket.MarketDefinition memory _definition) {
        _definition.name = name(market);
        _definition.symbol = symbol(market);
        _definition.token = token(market);
    }

    function parameter(IMarket market) public view returns (MarketParameter memory) {
        return market.parameter();
    }

    /**
     * @notice Market total collateral amount after settle
     * @param market Market address
     * @return Total collateral for market
     */
    function collateral(IMarket market) public settle(market) returns (Fixed6) {
        Fee memory fee = market.fee();
        return Fixed6.wrap(int256(UFixed18.unwrap(market.token().balanceOf(address(market))) / 1e12))
            .sub(Fixed6Lib.from(fee.protocol()))
            .sub(Fixed6Lib.from(fee.market()));
    }

    /**
     * @notice Market position after settle
     * @param market Market address
     * @return market position
     */
    function position(IMarket market) public settle(market) returns (Position memory) {
        return _latestPosition(market);
    }

    /**
     * @notice Current price of market after settle
     * @param market Market address
     * @return Market latest price
     */
    function latestVersion(IMarket market) public settle(market) returns (OracleVersion memory) {
        return _latestVersion(market);
    }

    /**
     * @notice Prices of market at specified versions after settle
     * @param market Market address
     * @param versions Oracle versions to query
     * @return prices Market prices at specified versions
     */
    function atVersions(IMarket market, uint256[] memory versions)
        public
        settle(market)
        returns (OracleVersion[] memory prices)
    {
        MarketParameter memory marketParameter = market.parameter();
        prices = new OracleVersion[](versions.length);
        for (uint256 i = 0; i < versions.length; i++) {
            prices[i] = marketParameter.oracle.atVersion(versions[i]);
            marketParameter.payoff.transform(prices[i]);
        }
    }

    /**
     * @notice Market funding rate after settle
     * @param market Market address
     * @return Market current funding rate
     */
    function rate(IMarket market) public settle(market) returns (Fixed6) {
        UFixed6 utilization_ = _latestPosition(market).utilization();
        Fixed6 annualRate_ = market.parameter().utilizationCurve.compute(utilization_);
        return annualRate_.div(Fixed6Lib.from(365 days));
    }

    /**
     * @notice Market funding extrapolated to a daily rate after settle
     * @param market Market address
     * @return Market current funding extrapolated to a daily rate
     */
    function dailyRate(IMarket market) public settle(market) returns (Fixed6) {
        UFixed6 utilization_ = _latestPosition(market).utilization();
        Fixed6 annualRate_ = market.parameter().utilizationCurve.compute(utilization_);
        return annualRate_.div(Fixed6Lib.from(365));
    }

    /**
     * @notice Fees accumulated by market and protocol treasuries after settle
     * @param market Market address
     * @return fees accrued by the protocol
     */
    function fees(IMarket market) public settle(market) returns (Fee memory) {
        return market.fee();
    }

    /**
     * @notice Market total open interest after settle
     * @param market Market address
     * @return Market maker and taker position multiplied by latest price after settle
     */
    function openInterest(IMarket market) public settle(market) returns (UFixed6, UFixed6) {
        Position memory _position = _latestPosition(market);
        UFixed6 _price = _latestVersion(market).price.abs();
        return (_position.maker().mul(_price), _position.taker().mul(_price));
    }

    /**
     *  End Market Individual Fields Functions
     */

    /**
     *  UserMarket Individual Fields Functions
     */

    /**
     * @notice User collateral amount for market after settle
     * @param account Account address
     * @param market Market address
     * @return User deposited collateral for market
     */
    function collateral(address account, IMarket market) public settleAccount(account, market) returns (Fixed6) {
        Account memory marketAccount = market.accounts(account);
        return marketAccount.collateral;
    }

    /**
     * @notice User maintenance amount for market after settle
     * @param account Account address
     * @param market Market address
     * @return Maximum of user maintenance, and maintenanceNext
     */
    function maintenance(address account, IMarket market) public settleAccount(account, market) returns (UFixed6) {
        Account memory marketAccount = market.accounts(account);
        return _maintenance(market, marketAccount.position);
    }

    function maintenanceNext(address account, IMarket market) public settleAccount(account, market) returns (UFixed6) {
        Account memory marketAccount = market.accounts(account);
        return _maintenance(market, marketAccount.next);
    }

    /**
     * @notice User liquidatble status for market after settle
     * @param account Account address
     * @param market Market address
     * @return Whether or not the user's position eligible to be liquidated
     */
    function liquidatable(address account, IMarket market) public settleAccount(account, market) returns (bool) {
        Account memory marketAccount = market.accounts(account);
        UFixed6 maintenanceAmount = _maintenance(market, marketAccount.position);
        return Fixed6Lib.from(maintenanceAmount).gt(marketAccount.collateral);
    }

    /**
     * @notice User next position for market after settle
     * @param account Account address
     * @param market Market address
     * @return User next position
     */
    function next(address account, IMarket market)
        public
        settleAccount(account, market)
        returns (Fixed6)
    {
        Account memory marketAccount = market.accounts(account);
        return marketAccount.next;
    }

    /**
     * @notice User position for market after settle
     * @param account Account address
     * @param market Market address
     * @return User position
     */
    function position(address account, IMarket market)
        public
        settleAccount(account, market)
        returns (Fixed6)
    {
        Account memory marketAccount = market.accounts(account);
        return marketAccount.position;
    }

    /**
     * @notice User current and next position for market after settle
     * @param account Account address
     * @param market Market address
     * @return User current position
     * @return User next position
     */
    function userPosition(address account, IMarket market)
        public
        settleAccount(account, market)
        returns (Fixed6, Fixed6)
    {
        Account memory marketAccount = market.accounts(account);
        return (marketAccount.position, marketAccount.next);
    }

    /**
     * @notice User's open interest in market after settle
     * @param account Account address
     * @param market Market address
     * @return User's maker or taker position multiplied by latest price after settle
     */
    function openInterest(address account, IMarket market)
        public
        settleAccount(account, market)
        returns (Fixed6)
    {
        Account memory marketAccount = market.accounts(account);
        return marketAccount.position.mul(_latestVersion(market).price);
    }

    /**
     * @notice User's exposure in market after settle
     * @param account Account address
     * @param market Market address
     * @return User's exposure (openInterest * utilization) after settle
     */
    function exposure(address account, IMarket market) public settleAccount(account, market) returns (Fixed6) {
        Position memory _pos = position(market);
        if (_pos.maker().isZero()) { return Fixed6Lib.ZERO; }

        Fixed6 _openInterest = openInterest(account, market);
        if (_openInterest.sign() == 1) {
            return _openInterest; // Taker exposure is always 100% of openInterest
        }

        UFixed6 utilization = _pos.utilization();
        return Fixed6Lib.from(utilization).mul(_openInterest); // Maker exposure is openInterest * utilization
    }

    /**
     * @notice User's maintenance required for position size in market after settle
     * @param account Account address
     * @param market Market address
     * @param positionSize size of position for maintenance calculation
     * @return Maintenance required for position in market
     */
    function maintenanceRequired(address account, IMarket market, Fixed6 positionSize)
        public
        settleAccount(account, market)
        returns (UFixed6)
    {
        return _maintenance(market, positionSize);
    }

    /**
     *  End UserMarket Individual Fields Functions
     */

    function _maintenance(IMarket market, Fixed6 positionSize) private view returns (UFixed6) {
        UFixed6 maintenance_ = market.parameter().maintenance;
        UFixed6 notional = positionSize.mul(_latestVersion(market).price).abs();
        return notional.mul(maintenance_);
    }

    /**
     *  Private Helper Functions
     */

    /**
     * @notice Returns the Market's latest position
     * @dev Private function, does not call settle itself
     * @param market Market address
     * @return Latest position for the market
     */
    function _latestPosition(IMarket market) private view returns (Position memory) {
        return market.position();
    }

    /**
     * @notice Returns the Market's latest version
     * @dev Private function, does not call settle itself
     * @param market Market address
     * @return oracleVersion Latest version for the market
     */
    function _latestVersion(IMarket market) private view returns (OracleVersion memory oracleVersion) {
        MarketParameter memory marketParameter = market.parameter();
        oracleVersion = marketParameter.oracle.atVersion(market.latestVersion());
        marketParameter.payoff.transform(oracleVersion);
    }

    /**
     *  End Private Helper Functions
     */

    /**
     *  Modifier Functions
     */

    /// @dev Settles the market
    modifier settle(IMarket market) {
        market.settle(address(0));
        _;
    }

    /// @dev Settles the market. market.settleAccount also settles the market
    modifier settleAccount(address account, IMarket market) {
        market.settle(account);
        _;
    }

    /**
     *  End Modifier Functions
     */
}
