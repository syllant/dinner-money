import {
  parseEcbSpfCsv,
  parsePredictionMarketItems,
  parseTradingEconomicsForecastHtml,
  parseYahooChartResponse,
} from './currencyForecast'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function runCurrencyForecastParserSmokeTests() {
  const now = new Date('2026-05-04T12:00:00Z')
  const fetchedAt = '2026-05-04T12:00:00.000Z'

  const tradingEconomicsHtml = `
    <table>
      <thead><tr><th>Name</th><th>Q2/26</th><th>Q3/26</th><th>Q4/26</th></tr></thead>
      <tbody><tr><td>EURUSD</td><td>1.09</td><td>1.10</td><td>1.12</td></tr></tbody>
    </table>
  `
  const tradingEconomics = parseTradingEconomicsForecastHtml(tradingEconomicsHtml, fetchedAt, now)
  if (typeof DOMParser !== 'undefined') {
    assert(tradingEconomics.length === 3, 'Trading Economics parser should use quarter headers')
    assert(tradingEconomics[0]?.value === 1.09, 'Trading Economics parser should extract EUR/USD values')
  }

  const ecbCsv = [
    'TIME_PERIOD,OBS_VALUE',
    '2026-Q1,1.05',
    '2026-Q2,1.09',
    '2026-Q2,1.11',
    '2026-Q2,1.13',
    '2026-Q2,1.15',
    '2026-Q2,1.17',
  ].join('\n')
  const ecb = parseEcbSpfCsv(ecbCsv, 12, fetchedAt, 'https://example.test/ecb.csv', now)
  assert(ecb != null, 'ECB SPF parser should return a point')
  assert(ecb.median === 1.13, 'ECB SPF parser should compute the latest-period median')
  assert(ecb.low != null && ecb.high != null, 'ECB SPF parser should compute bands when enough observations exist')

  const yahoo = parseYahooChartResponse({
    chart: { result: [{ meta: { regularMarketPrice: 1.1045 } }] },
  }, '6EM26.CME', fetchedAt, now)
  assert(yahoo != null, 'Yahoo parser should return a futures point')
  assert(yahoo.date === '2026-06-15', 'Yahoo parser should infer futures month from CME symbol')
  assert(yahoo.value === 1.1045, 'Yahoo parser should extract futures price')

  const markets = parsePredictionMarketItems([{
    question: 'Will EUR/USD be above 1.10 on Dec 31, 2026?',
    yes_bid: 42,
  }], 'kalshi', fetchedAt, 'https://example.test/kalshi')
  assert(markets.length === 1, 'Prediction market parser should keep parseable EUR/USD markets')
  assert(markets[0]?.probability === 0.42, 'Prediction market parser should normalize cents to probability')
}
