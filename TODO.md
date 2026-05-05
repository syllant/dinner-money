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
