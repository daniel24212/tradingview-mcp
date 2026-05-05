export function findPivots(highs, lows, lookback = 5) {
  const pivotHighs = [], pivotLows = [];
  for (let i = lookback; i < highs.length - lookback; i++) {
    let isPH = true, isPL = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isPH = false;
      if (lows[j]  <= lows[i])  isPL = false;
    }
    if (isPH) pivotHighs.push({ index: i, price: highs[i] });
    if (isPL) pivotLows.push({ index: i, price: lows[i] });
  }
  return { pivotHighs, pivotLows };
}
function projectLine(p1, p2, currentIndex) {
  const slope = (p2.price - p1.price) / (p2.index - p1.index);
  return p1.price + slope * (currentIndex - p1.index);
}
function classifyDistance(price, level, thresholdPct = 0.5) {
  const pct = Math.abs((price - level) / level) * 100;
  if (pct <= 0.1) return 'at_level';
  const near = pct <= thresholdPct;
  if (price > level) return near ? 'approaching_from_above' : 'above';
  return near ? 'approaching_from_below' : 'below';
}
export function analyzeTrendlines(bars, lookback = 5) {
  if (!bars || bars.length < lookback * 2 + 5) return { available: false, reason: 'Not enough bars' };
  const highs = bars.map(b => b.high), lows = bars.map(b => b.low);
  const price = bars[bars.length - 1].close, lastIdx = bars.length - 1;
  const { pivotHighs, pivotLows } = findPivots(highs, lows, lookback);
  const resistance = pivotHighs.length >= 2 ? { p1: pivotHighs[pivotHighs.length - 2], p2: pivotHighs[pivotHighs.length - 1] } : null;
  const support    = pivotLows.length  >= 2 ? { p1: pivotLows[pivotLows.length - 2],   p2: pivotLows[pivotLows.length - 1]   } : null;
  const result = { available: true, price };
  if (resistance) {
    const level = projectLine(resistance.p1, resistance.p2, lastIdx);
    const slope = resistance.p2.price - resistance.p1.price;
    result.resistance = { level: parseFloat(level.toFixed(8)), slope: slope > 0 ? 'ascending' : slope < 0 ? 'descending' : 'flat', pivot1: parseFloat(resistance.p1.price.toFixed(8)), pivot2: parseFloat(resistance.p2.price.toFixed(8)), position: classifyDistance(price, level) };
  }
  if (support) {
    const level = projectLine(support.p1, support.p2, lastIdx);
    const slope = support.p2.price - support.p1.price;
    result.support = { level: parseFloat(level.toFixed(8)), slope: slope > 0 ? 'ascending' : slope < 0 ? 'descending' : 'flat', pivot1: parseFloat(support.p1.price.toFixed(8)), pivot2: parseFloat(support.p2.price.toFixed(8)), position: classifyDistance(price, level) };
  }
  let trendlineSignal = 'neutral';
  if (support && result.support) {
    const pos = result.support.position;
    if ((pos === 'above' || pos === 'approaching_from_above') && result.support.slope === 'ascending') trendlineSignal = 'bullish';
    else if (pos === 'approaching_from_above') trendlineSignal = 'bullish';
  }
  if (resistance && result.resistance) {
    const pos = result.resistance.position;
    if ((pos === 'below' || pos === 'approaching_from_below') && result.resistance.slope === 'descending') trendlineSignal = 'bearish';
    else if (pos === 'at_level' || pos === 'approaching_from_below') trendlineSignal = trendlineSignal === 'bullish' ? 'neutral' : 'bearish';
  }
  result.trendline_signal = trendlineSignal;
  return result;
}
