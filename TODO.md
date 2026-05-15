This is a personal backlog, not intended for automated implementation from AI agents.

* credit card payments
   * show the due payments, ensure the fund accounts are enough
* best way to fund cash when needed
* recommendation engine?
* roth conversion
* real estate buy events
   * support creating/associating the new mortgage account
* hardcoded foreign equity/bond ticker lists in Investments.tsx (`FOREIGN_EQUITY_TICKERS`, `FOREIGN_BOND_TICKERS`)
   * currently used as a fallback when name-based heuristics are insufficient
   * better fix: use Tiingo metadata (country of exchange) or a user-editable ticker→category map
* Tax page is hardcoded to California (FTB) for the state column — generalize if app is used outside CA
* Demo mode with fake data
* Overview page
* EUR/USD trend: add a setting to specify which currency should be stronger (or, default, use the currency of the current residency country)
* Events page to group Pensions, etc.
* Consolidate LunchMoney features
