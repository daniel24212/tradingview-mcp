import { detectZones, suggestSL } from '../core/zones.js';
import { z } from 'zod';
import { jsonResult } from './_format.js';
import { getRules, isNoTradeWindow, validateRR, isWatchlisted } from '../core/rules.js';
import { analyzeBias } from '../core/bias.js';
import { analyzeTrendlines } from '../core/trendlines.js';
import { getOhlcv } from '../core/data.js';
import { setSymbol, setTimeframe } from '../core/chart.js';
const TF_MAP = { '1D':'1D','4H':'240','1H':'60','15M':'15','15':'15','240':'240','60':'60' };
async function analyzeOneTimeframe(tf, barCount, symbol) {
  await setTimeframe({ timeframe: TF_MAP[tf] || tf });
  await new Promise(r => setTimeout(r, 2000));
  const ohlcv = await getOhlcv({ count: barCount, summary: false, symbol });
  if (!ohlcv?.bars?.length) return { timeframe: tf, error: 'No data', signal: 'unavailable' };
  const bias = analyzeBias(ohlcv.bars);
  const tl = analyzeTrendlines(ohlcv.bars);
  let signal = bias.bias;
  if (tl.available && tl.trendline_signal !== 'neutral') {
    signal = tl.trendline_signal === bias.bias ? bias.bias : 'neutral';
  }
  return { timeframe: tf, signal, bias: bias.bias, trendline_signal: tl.trendline_signal || 'neutral', metrics: bias.metrics, trendlines: tl.available ? { support: tl.support || null, resistance: tl.resistance || null } : { available: false }, bars_analyzed: ohlcv.bars.length };
}
function buildVerdict(results) {
  const scores = { bullish: 0, bearish: 0, neutral: 0 };
  for (const r of results) {
    if (r.signal === 'bullish') scores.bullish++;
    else if (r.signal === 'bearish') scores.bearish++;
    else scores.neutral++;
  }
  const total = results.length;
  const bullPct = scores.bullish / total;
  const bearPct = scores.bearish / total;
  const direction = bullPct >= bearPct ? 'bullish' : 'bearish';
  const alignedPct = Math.max(bullPct, bearPct);
  let score = 0;
  if (alignedPct >= 1.0)       score += 4;
  else if (alignedPct >= 0.75) score += 3;
  else if (alignedPct >= 0.5)  score += 1;
  const rsiValues = results.filter(r => r.metrics?.rsi14 != null).map(r => r.metrics.rsi14);
  const avgRsi = rsiValues.length ? rsiValues.reduce((a, b) => a + b, 0) / rsiValues.length : null;
  if (avgRsi !== null) {
    if (direction === 'bearish' && avgRsi >= 45 && avgRsi < 65) score += 2;
    else if (direction === 'bullish' && avgRsi > 35 && avgRsi <= 55) score += 2;
    else if (direction === 'bearish' && avgRsi >= 65) score += 1;
    else if (direction === 'bullish' && avgRsi <= 35) score += 1;
  }
  const emaAligned = results.filter(r => {
    if (r.metrics?.above_ema50 == null) return false;
    return direction === 'bearish' ? r.metrics.above_ema50 === false : r.metrics.above_ema50 === true;
  }).length;
  if (emaAligned === total)            score += 2;
  else if (emaAligned >= total * 0.75) score += 1;
  const tlAligned = results.filter(r => r.trendline_signal === direction).length;
  if (tlAligned >= total * 0.75) score += 2;
  else if (tlAligned >= total * 0.5) score += 1;
  score = Math.min(10, score);
  const rsiBlocked = avgRsi !== null && (
    (direction === 'bearish' && avgRsi < 35) ||
    (direction === 'bullish' && avgRsi > 65)
  );
  const passes = score >= 8 && !rsiBlocked;
  const allAligned = alignedPct >= 1.0;
  const rsiNote = avgRsi != null ? ` RSI avg: ${avgRsi.toFixed(1)}.` : '';
  if (passes && allAligned && direction === 'bullish')
    return { signal: 'STRONG BUY', strength: 'high', confluence_score: `${score}/10`, numeric_score: score, breakdown: scores, avg_rsi: avgRsi?.toFixed(1) ?? null, rsi_blocked: false, advice: `All TFs bullish. Score ${score}/10.${rsiNote} Wait for 5M bullish candle close.` };
  if (passes && allAligned && direction === 'bearish')
    return { signal: 'STRONG SELL', strength: 'high', confluence_score: `${score}/10`, numeric_score: score, breakdown: scores, avg_rsi: avgRsi?.toFixed(1) ?? null, rsi_blocked: false, advice: `All TFs bearish. Score ${score}/10.${rsiNote} Wait for 5M bearish candle close.` };
  if (passes && !allAligned && direction === 'bullish')
    return { signal: 'BUY', strength: 'medium', confluence_score: `${score}/10`, numeric_score: score, breakdown: scores, avg_rsi: avgRsi?.toFixed(1) ?? null, rsi_blocked: false, advice: `High confluence BUY (${score}/10).${rsiNote} Wait for 15M confirmation.` };
  if (passes && !allAligned && direction === 'bearish')
    return { signal: 'SELL', strength: 'medium', confluence_score: `${score}/10`, numeric_score: score, breakdown: scores, avg_rsi: avgRsi?.toFixed(1) ?? null, rsi_blocked: false, advice: `High confluence SELL (${score}/10).${rsiNote} Wait for 15M confirmation.` };
  const reason = rsiBlocked
    ? `RSI ${avgRsi?.toFixed(1)} extreme — ${direction === 'bearish' ? 'oversold: do not short' : 'overbought: do not buy'}`
    : `Score ${score}/10 below minimum (8). ${alignedPct < 0.75 ? 'TFs not aligned.' : 'RSI/EMA/trendline weak.'}`;
  return { signal: 'WAIT', strength: 'low', confluence_score: `${score}/10`, numeric_score: score, breakdown: scores, avg_rsi: avgRsi?.toFixed(1) ?? null, rsi_blocked: rsiBlocked, advice: `No trade. ${reason}` };
}
// Ensure crypto symbols use BYBIT: prefix for real exchange data
// Avoids TradingView defaulting to CFD/synthetic feeds (volume=0)
function resolveSymbol(sym) {
  if (!sym) return sym;
  if (sym.includes(':')) return sym;  // already has exchange prefix
  const s = sym.toUpperCase();
  // Crypto patterns: contains digits or ends in USDT/USDC/BTC/ETH/BNB
  const isCrypto = /\d/.test(s) || /USDT$|USDC$|BTC$|ETH$|BNB$|SOL$/.test(s) || s.endsWith('.P');
  return isCrypto ? `BYBIT:${s}` : sym;
}

export function registerRulesTools(server) {
  server.tool('rules_show', 'Display all active trading rules from rules.json', {}, async () => {
    try { return jsonResult({ success: true, rules: getRules() }); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
  server.tool('rules_no_trade_check', 'Check if current time is in a no-trade window', {}, async () => {
    try { return jsonResult({ success: true, ...isNoTradeWindow() }); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
  server.tool('rules_validate_rr', 'Validate entry/stop/target against minimum R:R ratio', {
    entry: z.coerce.number(), stop: z.coerce.number(), target: z.coerce.number(),
  }, async ({ entry, stop, target }) => {
    try { const r = validateRR(entry, stop, target); return jsonResult({ success: true, verdict: r.valid ? '✅ R:R PASSES' : '⛔ R:R FAILS', ...r }); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
  server.tool('rules_get_bias', 'Analyze any symbol for bias using RSI(14), EMA(50/200), structure and trendlines. Auto-switches chart.', {
    symbol: z.string().optional().describe('Symbol e.g. ALICEUSDT.P'),
    bar_count: z.coerce.number().optional(),
  }, async ({ symbol, bar_count = 300 }) => {
    try {
      if (symbol) { await setSymbol({ symbol: resolveSymbol(symbol) }); await new Promise(r => setTimeout(r, 1500)); }
      const ohlcv = await getOhlcv({ count: Math.min(bar_count, 500), summary: false, symbol: symbol ? resolveSymbol(symbol) : undefined });
      if (!ohlcv?.bars?.length) throw new Error('No OHLCV data. Is TradingView loaded?');
      const bias = analyzeBias(ohlcv.bars);
      const tl = analyzeTrendlines(ohlcv.bars);
      return jsonResult({ success: true, symbol: ohlcv.symbol || symbol || 'unknown', timeframe: ohlcv.timeframe || 'unknown', bars_analyzed: ohlcv.bars.length, in_watchlist: isWatchlisted(ohlcv.symbol || symbol || ''), ...bias, trendlines: tl });
    } catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
  server.tool('rules_mtf_analysis', 'Multi-timeframe confluence: cycles 1D→4H→1H→15M, calculates RSI(14), EMA(50/200), structure and trendlines on each, outputs STRONG BUY/BUY/WAIT/SELL/STRONG SELL with confluence score. Auto-switches symbol and restores timeframe.', {
    symbol: z.string().optional().describe('Symbol e.g. ALICEUSDT.P'),
    timeframes: z.array(z.string()).optional().describe('Default: ["1D","4H","1H","15M"]'),
    bar_count: z.coerce.number().optional().describe('Bars per timeframe, default 300'),
  }, async ({ symbol, timeframes = ['4H','1H','15M','5M'], bar_count = 300 }) => {
    try {
      const noTrade = isNoTradeWindow(symbol || null);
      if (noTrade.blocked) return jsonResult({ success: true, verdict: '⛔ ANALYSIS BLOCKED', reason: noTrade.message });
      const resolvedSym = symbol ? resolveSymbol(symbol) : undefined;
      if (resolvedSym) { await setSymbol({ symbol: resolvedSym }); await new Promise(r => setTimeout(r, 1500)); }
      const results = [];
      for (const tf of timeframes) {
        try { results.push(await analyzeOneTimeframe(tf, Math.min(bar_count, 500), resolvedSym)); }
        catch (e) { results.push({ timeframe: tf, error: e.message, signal: 'unavailable' }); }
      }
      try { await setTimeframe({ timeframe: '1D' }); } catch (_) {}
      const valid = results.filter(r => r.signal && r.signal !== 'unavailable');
      const verdict = buildVerdict(valid);
      const summary = results.map(r => ({
        timeframe: r.timeframe, signal: r.signal || 'unavailable',
        bias: r.bias || '-', trendline: r.trendline_signal || '-',
        rsi14: r.metrics?.rsi14 ?? '-', above_ema50: r.metrics?.above_ema50 ?? '-',
        support_level: r.trendlines?.support?.level ?? '-', support_pos: r.trendlines?.support?.position ?? '-',
        resistance_level: r.trendlines?.resistance?.level ?? '-', resistance_pos: r.trendlines?.resistance?.position ?? '-',
      }));
      // ── Hard gate: block signals below 8/10 ─────────────────────────────
      if (verdict.numeric_score < 7) {
        return jsonResult({
          success: true,
          gate_blocked: true,
          verdict: 'WAIT',
          confluence_score: `${verdict.numeric_score}/10`,
          numeric_score: verdict.numeric_score,
          avg_rsi: verdict.avg_rsi,
          instruction: `⛔ HARD STOP. Score ${verdict.numeric_score}/10 is below minimum (7/10). You MUST output exactly: "⏳ WAIT — Confluence ${verdict.numeric_score}/10 below minimum (7/10). No trade." — nothing else. No entry. No SL. No TP. No scorecard. No options A/B.`,
        });
      }
      return jsonResult({ success: true, symbol: symbol || 'current chart', verdict: verdict.signal, strength: verdict.strength, confluence_score: verdict.confluence_score, numeric_score: verdict.numeric_score, gate_blocked: false, advice: verdict.advice, no_trade_warning: noTrade.warnings?.length ? noTrade.warnings : null, timeframe_breakdown: summary, raw: results });
    } catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
  server.tool('rules_check_trade', 'Full pre-trade check: no-trade window + R:R + bias + trendlines. Watchlist is informational only.', {
    entry: z.coerce.number(), stop: z.coerce.number(), target: z.coerce.number(),
    symbol: z.string().optional().describe('Symbol e.g. ALICEUSDT.P — auto-loads in TradingView'),
  }, async ({ entry, stop, target, symbol }) => {
    try {
      if (symbol) { await setSymbol({ symbol: resolveSymbol(symbol) }); await new Promise(r => setTimeout(r, 1500)); }
      const noTrade = isNoTradeWindow(symbol || null);
      const rr = validateRR(entry, stop, target);
      let biasResult = null, tlResult = null, chartSymbol = symbol || null;
      try {
        const ohlcv = await getOhlcv({ count: 300, summary: false, symbol: symbol ? resolveSymbol(symbol) : undefined });
        if (ohlcv?.bars?.length) { biasResult = analyzeBias(ohlcv.bars); tlResult = analyzeTrendlines(ohlcv.bars); if (!chartSymbol) chartSymbol = ohlcv.symbol; }
      } catch (e) { biasResult = { bias: 'error', reason: e.message }; }
      const watchlisted = chartSymbol ? isWatchlisted(chartSymbol) : null;
      const blocked = noTrade.blocked || !rr.valid;
      const hasWarnings = noTrade.warnings?.length > 0;
      return jsonResult({ success: true, symbol: chartSymbol, verdict: blocked ? '⛔ TRADE BLOCKED' : hasWarnings ? '⚠️ TRADE ALLOWED WITH CAUTION' : '✅ TRADE APPROVED', approved: !blocked, checks: {
        no_trade_window: { passed: !noTrade.blocked, detail: noTrade.message, warnings: noTrade.warnings || [] },
        rr_ratio: { passed: rr.valid, detail: rr.valid ? `R:R ${rr.rr} ✅ (min ${rr.min_rr})` : `R:R ${rr.rr} ⛔ — ${rr.reason}` },
        bias: biasResult ? { value: biasResult.bias, metrics: biasResult.metrics } : { value: 'unavailable' },
        trendlines: tlResult?.available ? { support: tlResult.support, resistance: tlResult.resistance, signal: tlResult.trendline_signal } : { available: false },
        watchlist: { in_watchlist: watchlisted, detail: watchlisted === null ? 'Symbol unknown' : watchlisted ? `${chartSymbol} is in your watchlist` : `${chartSymbol} not in watchlist — analyzed anyway` },
      }});
    } catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}


export function registerZoneTools(server) {
  server.tool('rules_get_zones', 'Detect all demand and supply zones on the current chart. Shows zone boundaries, strength score, freshness, and how many times price has returned to each zone.', {
    symbol: z.string().optional().describe('Symbol to analyze e.g. ALICEUSDT.P — auto-loads if provided'),
    bar_count: z.coerce.number().optional().describe('Bars to scan (default 300)'),
  }, async ({ symbol, bar_count = 300 }) => {
    try {
      if (symbol) { await setSymbol({ symbol: resolveSymbol(symbol) }); await new Promise(r => setTimeout(r, 1500)); }
      const ohlcv = await getOhlcv({ count: Math.min(bar_count, 500), summary: false, symbol: symbol ? resolveSymbol(symbol) : undefined });
      if (!ohlcv?.bars?.length) throw new Error('No OHLCV data. Is TradingView loaded?');
      const zones = detectZones(ohlcv.bars);
      return jsonResult({ success: true, symbol: ohlcv.symbol || symbol || 'unknown', timeframe: ohlcv.timeframe || 'unknown', current_price: zones.current_price, atr: zones.atr, demand_zones: zones.demandZones, supply_zones: zones.supplyZones, demand_count: zones.demandZones.length, supply_count: zones.supplyZones.length });
    } catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('rules_suggest_sl', 'Suggest the strongest stop loss level for a BUY or SELL trade based on demand/supply zones. BUY: SL just below strongest demand zone. SELL: SL just above strongest supply zone. Buffer = 15% of zone height + ATR cushion.', {
    direction: z.string().describe('Trade direction: "buy" or "sell"'),
    symbol: z.string().optional().describe('Symbol e.g. ALICEUSDT.P — auto-loads if provided'),
    bar_count: z.coerce.number().optional().describe('Bars to scan (default 300)'),
  }, async ({ direction, symbol, bar_count = 300 }) => {
    try {
      if (symbol) { await setSymbol({ symbol: resolveSymbol(symbol) }); await new Promise(r => setTimeout(r, 1500)); }
      const ohlcv = await getOhlcv({ count: Math.min(bar_count, 500), summary: false, symbol: symbol ? resolveSymbol(symbol) : undefined });
      if (!ohlcv?.bars?.length) throw new Error('No OHLCV data. Is TradingView loaded?');
      const result = suggestSL(ohlcv.bars, direction);
      return jsonResult({ success: true, symbol: ohlcv.symbol || symbol || 'unknown', timeframe: ohlcv.timeframe || 'unknown', ...result });
    } catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}

async function analyzeReversalMode(symbol, barCount, forceDirection = null) {
  // Get zones and current price from daily chart
  const ohlcvD = await getOhlcv({ count: barCount, summary: false, symbol: symbol || undefined });
  if (!ohlcvD?.bars?.length) throw new Error('No OHLCV data');
  const { detectZones } = await import('../core/zones.js');
  const zones = detectZones(ohlcvD.bars);
  const price = zones.current_price;

  // Check if price is at demand or supply zone (within 1.5% of zone boundary)
  const atDemand = forceDirection === "sell" ? null : zones.demandZones.find(z => price <= z.zone_high * 1.015 && price >= z.zone_low * 0.985 && z.valid);
  const atSupply = forceDirection === "buy" ? null : zones.supplyZones.find(z => price >= z.zone_low * 0.985 && price <= z.zone_high * 1.015 && z.valid);

  if (!atDemand && !atSupply) {
    return { mode: 'reversal', signal: 'WAIT', reason: 'Price is not at any demand or supply zone — no reversal setup', price, zones: { demand_count: zones.demandZones.length, supply_count: zones.supplyZones.length } };
  }

  const direction = atDemand ? 'buy' : 'sell';
  const zone = atDemand || atSupply;

  // Confirm on 1H and 15M only
  const confirmTFs = ['1H', '15M'];
  const confirmResults = [];
  for (const tf of confirmTFs) {
    try { confirmResults.push(await analyzeOneTimeframe(tf, barCount, symbol || undefined)); } catch(e) { confirmResults.push({ timeframe: tf, signal: 'unavailable', error: e.message }); }
  }

  // Reversal confirmed if at least 1 of 2 lower TFs shows bullish (for buy) or bearish (for sell)
  const aligned = confirmResults.filter(r => r.signal === direction || r.bias === direction);
  const confirmed = aligned.length >= 1;

  // Higher TF context (informational)
  let htfBias = 'unknown';
  try {
    await setTimeframe({ timeframe: '1D' });
    await new Promise(r => setTimeout(r, 2000));
    const ohlcv1D = await getOhlcv({ count: barCount, summary: false, symbol: symbol || undefined });
    if (ohlcv1D?.bars?.length) {
      const { analyzeBias } = await import('../core/bias.js');
      htfBias = analyzeBias(ohlcv1D.bars).bias;
    }
  } catch(_) {}

  const isCounterTrend = (direction === 'buy' && htfBias === 'bearish') || (direction === 'sell' && htfBias === 'bullish');

  const summary = confirmResults.map(r => ({
    timeframe: r.timeframe, signal: r.signal, bias: r.bias, trendline: r.trendline_signal, rsi14: r.metrics?.rsi14 ?? '-',
  }));

  return {
    mode: 'reversal',
    signal: confirmed ? (direction === 'buy' ? 'BUY' : 'SELL') : 'WAIT',
    direction,
    confirmed,
    counter_trend: isCounterTrend,
    counter_trend_warning: isCounterTrend ? `⚠️ Counter-trend trade — daily bias is ${htfBias}. Use tighter SL and smaller size.` : null,
    daily_bias: htfBias,
    zone_type: atDemand ? 'demand' : 'supply',
    zone,
    price,
    lower_tf_confirmation: summary,
    advice: confirmed
      ? `Price is at ${atDemand ? 'demand' : 'supply'} zone (strength: ${zone.strength}). ${aligned.length}/2 lower TFs confirm ${direction.toUpperCase()}. ${isCounterTrend ? 'Counter-trend — reduce size.' : 'Aligned with trend.'}`
      : `Price is at zone but lower TFs not yet confirming. Wait for 15M ${direction === 'buy' ? 'bullish engulfing or pin bar' : 'bearish engulfing or pin bar'}.`,
  };
}
