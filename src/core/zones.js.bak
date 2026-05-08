/**
 * zones.js — Detects demand and supply zones from OHLCV data.
 * Demand zone: consolidation base followed by strong bullish impulse.
 * Supply zone: consolidation base followed by strong bearish impulse.
 * SL placement: BUY -> just below demand zone low. SELL -> just above supply zone high.
 */

function calcATR(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const { high, low } = bars[i];
    const pc = bars[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc)));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calcAvgRange(bars, period = 20) {
  const recent = bars.slice(-period);
  return recent.reduce((sum, b) => sum + (b.high - b.low), 0) / recent.length;
}

export function detectZones(bars, lookback = 150) {
  if (bars.length < 30) return { demandZones: [], supplyZones: [], atr: null };

  const avgRange    = calcAvgRange(bars, 20);
  const atr         = calcATR(bars, 14);
  const slice       = bars.slice(-lookback);
  const price       = bars[bars.length - 1].close;
  const demandZones = [];
  const supplyZones = [];
  const MIN_BASE = 3;
  const MAX_BASE = 12;

  let i = 0;
  while (i < slice.length - MIN_BASE - 2) {
    let baseLow   = slice[i].low;
    let baseHigh  = slice[i].high;
    let baseCount = 0;

    for (let j = i; j < Math.min(i + MAX_BASE, slice.length - 2); j++) {
      const range = slice[j].high - slice[j].low;
      if (range <= avgRange * 1.5) {
        baseCount++;
        baseLow  = Math.min(baseLow,  slice[j].low);
        baseHigh = Math.max(baseHigh, slice[j].high);
      } else { break; }
    }

    if (baseCount < MIN_BASE) { i++; continue; }

    const baseEnd = i + baseCount - 1;
    const impulse = slice[baseEnd + 1];
    if (!impulse) { i = baseEnd + 1; continue; }

    const impulseRange = impulse.high - impulse.low;
    const isBullish = impulse.close > impulse.open
                   && impulseRange > avgRange * 1.8
                   && impulse.close > baseHigh;
    const isBearish = impulse.close < impulse.open
                   && impulseRange > avgRange * 1.8
                   && impulse.close < baseLow;

    if (isBullish || isBearish) {
      const zoneHeight = baseHigh - baseLow;
      let returns = 0;
      for (let k = baseEnd + 2; k < slice.length; k++) {
        if (slice[k].low <= baseHigh && slice[k].high >= baseLow) returns++;
      }
      const freshness = Math.max(0.1, 1 - returns * 0.25);
      const strength  = parseFloat(((impulseRange / avgRange) * (baseCount / MIN_BASE) * freshness).toFixed(2));

      const zone = {
        zone_low:        parseFloat(baseLow.toFixed(8)),
        zone_high:       parseFloat(baseHigh.toFixed(8)),
        zone_height:     parseFloat(zoneHeight.toFixed(8)),
        strength,
        freshness:       parseFloat(freshness.toFixed(2)),
        returns_to_zone: returns,
        base_candles:    baseCount,
      };

      if (isBullish && price >= baseLow * 0.97) {
        zone.valid = price > baseLow;
        demandZones.push(zone);
      } else if (isBearish && price <= baseHigh * 1.03) {
        zone.valid = price < baseHigh;
        supplyZones.push(zone);
      }
    }
    i = baseEnd + 1;
  }

  demandZones.sort((a, b) => b.strength - a.strength);
  supplyZones.sort((a, b) => b.strength - a.strength);

  return {
    demandZones,
    supplyZones,
    atr: atr ? parseFloat(atr.toFixed(8)) : null,
    current_price: price,
  };
}

export function suggestSL(bars, direction) {
  const { demandZones, supplyZones, atr, current_price } = detectZones(bars);
  const dir = direction.toLowerCase();

  /**
   * Zone quality by touch count:
   *   0-1 touches = STRONG     (fresh, reliable SL)
   *   2   touches = WEAKENED   (use with warning)
   *   3+  touches = COMPROMISED (reject — use ATR fallback)
   */
  function pickBestZone(zones) {
    const fresh = zones.filter(z => z.returns_to_zone <= 1);
    if (fresh.length) return { zone: fresh[0], quality: 'strong', warning: null };
    const warn = zones.filter(z => z.returns_to_zone === 2);
    if (warn.length) return {
      zone: warn[0], quality: 'weakened',
      warning: `Zone tested ${warn[0].returns_to_zone}x — weakened, elevated risk of break`,
    };
    const any = zones[0];
    if (any) return {
      zone: any, quality: 'compromised',
      warning: `Zone tested ${any.returns_to_zone}x — HIGH RISK of break`,
    };
    return null;
  }

  if (dir === 'buy' || dir === 'long') {
    const valid = demandZones.filter(z => z.zone_low < current_price && z.valid);
    if (!valid.length) {
      return {
        success: false, direction: 'buy',
        reason: 'No valid demand zone found below current price',
        fallback_sl: atr ? parseFloat((current_price - atr * 2).toFixed(8)) : null,
        fallback_note: 'Using 2x ATR below price as fallback',
      };
    }
    const picked = pickBestZone(valid);
    if (picked.quality === 'compromised') {
      return {
        success: false, direction: 'buy',
        reason: `Best demand zone tested ${picked.zone.returns_to_zone}x — too weak for reliable SL`,
        fallback_sl: atr ? parseFloat((current_price - atr * 2).toFixed(8)) : null,
        fallback_note: 'Zone over-tested. Using 2x ATR below price as safer SL',
        rejected_zone: picked.zone,
      };
    }
    const best   = picked.zone;
    const buffer = Math.max(best.zone_height * 0.15, atr ? atr * 0.5 : 0);
    const sl     = parseFloat((best.zone_low - buffer).toFixed(8));
    return {
      success: true, direction: 'buy', suggested_sl: sl, zone: best,
      zone_quality: picked.quality,
      warning: picked.warning,
      buffer: parseFloat(buffer.toFixed(8)),
      reasoning: `SL placed ${((buffer / best.zone_low) * 100).toFixed(2)}% below demand zone low (${best.zone_low}). Touches: ${best.returns_to_zone}, Quality: ${picked.quality}, Strength: ${best.strength}.${picked.warning ? ' WARN: ' + picked.warning : ''}`,
    };
  }

  if (dir === 'sell' || dir === 'short') {
    const valid = supplyZones.filter(z => z.zone_high > current_price && z.valid);
    if (!valid.length) {
      return {
        success: false, direction: 'sell',
        reason: 'No valid supply zone found above current price',
        fallback_sl: atr ? parseFloat((current_price + atr * 2).toFixed(8)) : null,
        fallback_note: 'Using 2x ATR above price as fallback',
      };
    }
    const picked = pickBestZone(valid);
    if (picked.quality === 'compromised') {
      return {
        success: false, direction: 'sell',
        reason: `Best supply zone tested ${picked.zone.returns_to_zone}x — too weak for reliable SL`,
        fallback_sl: atr ? parseFloat((current_price + atr * 2).toFixed(8)) : null,
        fallback_note: 'Zone over-tested. Using 2x ATR above price as safer SL',
        rejected_zone: picked.zone,
      };
    }
    const best   = picked.zone;
    const buffer = Math.max(best.zone_height * 0.15, atr ? atr * 0.5 : 0);
    const sl     = parseFloat((best.zone_high + buffer).toFixed(8));
    return {
      success: true, direction: 'sell', suggested_sl: sl, zone: best,
      zone_quality: picked.quality,
      warning: picked.warning,
      buffer: parseFloat(buffer.toFixed(8)),
      reasoning: `SL placed ${((buffer / best.zone_high) * 100).toFixed(2)}% above supply zone high (${best.zone_high}). Touches: ${best.returns_to_zone}, Quality: ${picked.quality}, Strength: ${best.strength}.${picked.warning ? ' WARN: ' + picked.warning : ''}`,
    };
  }

  return { success: false, reason: 'Direction must be "buy" or "sell"' };
}
