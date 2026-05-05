export function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return parseFloat(ema.toFixed(8));
}
export function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}
export function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  const emaFast = [], emaSlow = [];
  const kf = 2 / (fast + 1), ks = 2 / (slow + 1);
  let ef = closes.slice(0, fast).reduce((a, b) => a + b, 0) / fast;
  let es = closes.slice(0, slow).reduce((a, b) => a + b, 0) / slow;
  for (let i = fast; i < closes.length; i++) { ef = closes[i] * kf + ef * (1 - kf); emaFast.push({ i, v: ef }); }
  for (let i = slow; i < closes.length; i++) { es = closes[i] * ks + es * (1 - ks); emaSlow.push({ i, v: es }); }
  const macdLine = [];
  for (const s of emaSlow) {
    const f = emaFast.find(x => x.i === s.i);
    if (f) macdLine.push({ i: s.i, v: parseFloat((f.v - s.v).toFixed(8)) });
  }
  if (macdLine.length < signal) return null;
  const macdValues = macdLine.map(m => m.v);
  const ks2 = 2 / (signal + 1);
  let sigLine = macdValues.slice(0, signal).reduce((a, b) => a + b, 0) / signal;
  const signalValues = [];
  for (let i = signal; i < macdValues.length; i++) { sigLine = macdValues[i] * ks2 + sigLine * (1 - ks2); signalValues.push(sigLine); }
  const lastMacd = macdValues[macdValues.length - 1];
  const lastSignal = signalValues[signalValues.length - 1];
  const lastHist = parseFloat((lastMacd - lastSignal).toFixed(8));
  const prevHist = signalValues.length >= 2 ? parseFloat((macdValues[macdValues.length - 2] - signalValues[signalValues.length - 2]).toFixed(8)) : lastHist;
  let macdBias = 'neutral';
  if (lastMacd > lastSignal && lastHist > 0 && lastHist >= prevHist) macdBias = 'bullish';
  else if (lastMacd < lastSignal && lastHist < 0 && lastHist <= prevHist) macdBias = 'bearish';
  return { macd: parseFloat(lastMacd.toFixed(8)), signal: parseFloat(lastSignal.toFixed(8)), histogram: lastHist, histogram_prev: prevHist, above_zero: lastMacd > 0, macd_bias: macdBias };
}
export function analyzeVolume(bars, period = 20) {
  if (bars.length < period + 1) return null;
  const recent = bars.slice(-period);
  const avgVol = recent.reduce((s, b) => s + (b.volume || 0), 0) / period;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const lastVol = last.volume || 0;
  const volRatio = avgVol > 0 ? parseFloat((lastVol / avgVol).toFixed(2)) : null;
  const isBullishCandle = last.close > last.open;
  const isBearishCandle = last.close < last.open;
  const bullBars = recent.filter(b => b.close > b.open);
  const bearBars = recent.filter(b => b.close < b.open);
  const avgBullVol = bullBars.length ? bullBars.reduce((s, b) => s + (b.volume || 0), 0) / bullBars.length : 0;
  const avgBearVol = bearBars.length ? bearBars.reduce((s, b) => s + (b.volume || 0), 0) / bearBars.length : 0;
  let volumeBias = 'neutral';
  if (avgBullVol > avgBearVol * 1.2) volumeBias = 'bullish';
  else if (avgBearVol > avgBullVol * 1.2) volumeBias = 'bearish';
  return { avg_volume: parseFloat(avgVol.toFixed(0)), last_volume: lastVol, vol_ratio: volRatio, high_volume: volRatio !== null && volRatio >= 1.5, volume_bias: volumeBias, buying_dominance: avgBullVol > avgBearVol, avg_bull_vol: parseFloat(avgBullVol.toFixed(0)), avg_bear_vol: parseFloat(avgBearVol.toFixed(0)) };
}
export function checkStructure(highs, lows, lookback = 20) {
  if (highs.length < lookback) return 'neutral';
  const h = highs.slice(-lookback), l = lows.slice(-lookback);
  const mid = Math.floor(lookback / 2);
  const hhhl = Math.max(...h.slice(mid)) > Math.max(...h.slice(0, mid)) && Math.min(...l.slice(mid)) > Math.min(...l.slice(0, mid));
  const lhll = Math.max(...h.slice(mid)) < Math.max(...h.slice(0, mid)) && Math.min(...l.slice(mid)) < Math.min(...l.slice(0, mid));
  return hhhl ? 'bullish' : lhll ? 'bearish' : 'neutral';
}
export function analyzeBias(bars) {
  if (!bars || bars.length < 52) return { bias: 'insufficient_data', reason: `Need 52+ bars, got ${bars?.length ?? 0}`, metrics: null };
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const rsi14 = calcRSI(closes, 14);
  const ema50 = calcEMA(closes, 50);
  const ema200 = closes.length >= 200 ? calcEMA(closes, 200) : null;
  const price = closes[closes.length - 1];
  const structure = checkStructure(highs, lows, 20);
  const macd = calcMACD(closes, 12, 26, 9);
  const volume = analyzeVolume(bars, 20);
  const aboveEma50 = price > ema50;
  const aboveEma200 = ema200 !== null ? price > ema200 : null;
  // Core bias from EMA + RSI + structure
  let coreBias;
  if (aboveEma50 && rsi14 >= 45 && rsi14 <= 70 && structure === 'bullish') coreBias = 'bullish';
  else if (!aboveEma50 && rsi14 < 45 && structure === 'bearish') coreBias = 'bearish';
  else coreBias = 'neutral';
  // MACD confirmation
  const macdConfirms = macd ? macd.macd_bias === coreBias : true;
  const macdConflicts = macd && macd.macd_bias !== 'neutral' && macd.macd_bias !== coreBias;
  // Volume confirmation
  const volConfirms = volume ? volume.volume_bias === coreBias || volume.volume_bias === 'neutral' : true;
  const volConflicts = volume && volume.volume_bias !== 'neutral' && volume.volume_bias !== coreBias;
  // Downgrade to neutral if both MACD and volume conflict with core bias
  let bias = coreBias;
  if (macdConflicts && volConflicts) bias = 'neutral';
  // Upgrade confidence if MACD and volume both confirm
  const confirmed = macdConfirms && volConfirms && coreBias !== 'neutral';
  return {
    bias,
    confirmed,
    metrics: {
      price, ema50, ema200,
      rsi14,
      structure,
      above_ema50: aboveEma50,
      above_ema200: aboveEma200,
      macd: macd ? { line: macd.macd, signal: macd.signal, histogram: macd.histogram, bias: macd.macd_bias, above_zero: macd.above_zero } : null,
      volume: volume ? { ratio: volume.vol_ratio, bias: volume.volume_bias, high_volume: volume.high_volume, buying_dominance: volume.buying_dominance } : null,
    },
    conflicts: macdConflicts || volConflicts ? { macd_conflict: macdConflicts, volume_conflict: volConflicts } : null,
  };
}
