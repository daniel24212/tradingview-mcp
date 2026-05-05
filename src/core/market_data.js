/**
 * market_data.js — Fetches real-time price + OHLCV directly from Binance REST API.
 * Completely bypasses TradingView's internal bar cache (which can be stale/frozen).
 * Used by Oscar for live price and multi-timeframe analysis.
 */

const BINANCE_BASE = 'https://api.binance.com/api/v3';
const TIMEOUT_MS   = 8000;

// Map Oscar timeframe labels to Binance interval strings
const TF_MAP = {
  '1D': '1d', 'D': '1d',
  '4H': '4h', '240': '4h',
  '1H': '1h', '60':  '1h',
  '15M': '15m', '15': '15m',
  '5M':  '5m',  '5':  '5m',
  '1W':  '1w',  'W':  '1w',
};

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

function cleanSymbol(symbol) {
  // Strip exchange prefix, .P suffix, ensure uppercase
  return symbol.toUpperCase().replace(/^[^:]+:/, '').replace(/\.P$/, '');
}

/**
 * Get live quote for a symbol.
 * Returns: { symbol, price, change_24h_pct, volume_24h, high_24h, low_24h }
 */
export async function getLiveQuote(symbol) {
  const sym = cleanSymbol(symbol);
  try {
    const data = await fetchWithTimeout(`${BINANCE_BASE}/ticker/24hr?symbol=${sym}`);
    return {
      success:          true,
      symbol:           sym,
      price:            parseFloat(data.lastPrice),
      open_24h:         parseFloat(data.openPrice),
      high_24h:         parseFloat(data.highPrice),
      low_24h:          parseFloat(data.lowPrice),
      volume_24h:       parseFloat(data.volume),
      quote_volume_24h: parseFloat(data.quoteVolume),
      change_24h:       parseFloat(data.priceChange),
      change_24h_pct:   parseFloat(data.priceChangePercent),
      source:           'binance_rest',
    };
  } catch (err) {
    return { success: false, symbol: sym, error: err.message };
  }
}

/**
 * Get OHLCV bars for a symbol and timeframe.
 * Returns array of { time, open, high, low, close, volume }
 */
export async function getOhlcvBinance(symbol, timeframe = '1d', limit = 300) {
  const sym      = cleanSymbol(symbol);
  const interval = TF_MAP[timeframe] || timeframe;
  const count    = Math.min(limit, 1000);
  try {
    const data = await fetchWithTimeout(
      `${BINANCE_BASE}/klines?symbol=${sym}&interval=${interval}&limit=${count}`
    );
    const bars = data.map(k => ({
      time:   Math.floor(k[0] / 1000),   // ms → seconds
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
    return {
      success:   true,
      symbol:    sym,
      timeframe: interval,
      bar_count: bars.length,
      bars,
      source:    'binance_rest',
    };
  } catch (err) {
    return { success: false, symbol: sym, timeframe: interval, error: err.message };
  }
}

/**
 * Fetch OHLCV for multiple timeframes in one call.
 * Returns { '1D': {...bars}, '4H': {...bars}, '1H': {...bars}, '15M': {...bars} }
 */
export async function getMultiTFOhlcv(symbol, timeframes = ['1D','4H','1H','15M'], limit = 300) {
  const results = {};
  await Promise.all(timeframes.map(async tf => {
    results[tf] = await getOhlcvBinance(symbol, tf, limit);
  }));
  return results;
}
