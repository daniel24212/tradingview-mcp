import { evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 12000;
const POLL_INTERVAL   = 400;

function getExpectedBarSeconds(tf) {
  const map = { '1D':'D', 'D':'D', '4H':'240', '240':'240', '1H':'60', '60':'60', '15M':'15', '15':'15', '5M':'5', '5':'5' };
  const norm = map[tf] || tf;
  if (norm === 'D')   return 86400;
  if (norm === '240') return 14400;
  if (norm === '60')  return 3600;
  if (norm === '15')  return 900;
  if (norm === '5')   return 300;
  const mins = parseInt(norm, 10);
  return isNaN(mins) ? 3600 : mins * 60;
}

async function getChartState() {
  return evaluate(`(() => {
    try {
      const ms   = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries();
      const bars = ms.bars();
      const end  = bars.lastIndex();
      const last = end >= 0 ? bars.valueAt(end) : null;
      const prev = end >= 1 ? bars.valueAt(end - 1) : null;
      const spin = document.querySelector('[class*="loader"],[class*="loading"],[data-name="loading"]');
      return {
        symbol:    ms.symbol()   || null,
        interval:  ms.interval ? ms.interval() : null,
        close:     last ? last[4] : null,
        volume:    last ? (last[5] || 0) : 0,
        lastTime:  last ? last[0] : null,
        barSpacing: (last && prev) ? (last[0] - prev[0]) : null,
        loading:   !!(spin && spin.offsetParent !== null),
      };
    } catch(e) { return { error: e.message }; }
  })()`).catch(() => null);
}

export async function waitForChartReady(
  expectedSymbol = null,
  expectedTf     = null,
  timeout        = DEFAULT_TIMEOUT,
  beforeState    = null,
) {
  const start  = Date.now();
  const expSym = expectedSymbol
    ? expectedSymbol.toUpperCase().replace(/^[^:]+:/, '')
    : null;
  const expBarSecs = expectedTf ? getExpectedBarSeconds(expectedTf) : null;
  let stableCount = 0;
  let lastTime    = null;

  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    const state = await getChartState();
    if (!state || state.error) continue;
    if (state.loading) { stableCount = 0; continue; }

    // Symbol check
    if (expSym) {
      const got = (state.symbol || '').toUpperCase().replace(/^[^:]+:/, '');
      if (!got.includes(expSym) && !expSym.includes(got)) { stableCount = 0; continue; }
    }

    // Timeframe check — use bar spacing (most reliable)
    if (expBarSecs && state.barSpacing) {
      const tolerance = expBarSecs * 0.25;
      if (Math.abs(state.barSpacing - expBarSecs) > tolerance) { stableCount = 0; continue; }
    }

    // Data changed from before-switch state
    if (beforeState?.lastTime != null && state.lastTime === beforeState.lastTime
        && state.symbol === beforeState.symbol && state.volume === beforeState.volume) {
      stableCount = 0; continue;
    }

    // Stable last bar time for 2 polls
    if (state.lastTime === lastTime && state.lastTime != null) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastTime = state.lastTime;
    if (stableCount >= 2) return true;
  }
  return false;
}
