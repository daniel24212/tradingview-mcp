/**
 * rules.js — Loads and enforces trading rules from rules.json
 *
 * Key behaviours:
 *  - Weekend: FOREX blocked, crypto allowed
 *  - FOMC/CPI dates: warning only, never a hard block
 *  - Min R:R: hard block if not met (reads from risk_rules.min_rr_ratio)
 *  - Watchlist: informational only, never blocks
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(__dirname, '../../rules.json');

let _rules = null;

export function getRules() {
  if (!_rules) {
    _rules = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  }
  return _rules;
}

export function reloadRules() {
  _rules = null;
  return getRules();
}

function isForex(symbol) {
  if (!symbol) return false;
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/\d/.test(s)) return false;
  if (/USDT$|USDC$|BUSD$|BTC$|ETH$|BNB$|SOL$/.test(s)) return false;
  if (symbol.includes('.P')) return false;
  if (/^[A-Z]{6}$/.test(s)) return true;
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(symbol.toUpperCase())) return true;
  return false;
}

export function isNoTradeWindow(symbol) {
  const rules   = getRules();
  const rr      = rules.risk_rules || {};
  const hardBlocked = [];
  const warnings    = [];

  const now       = new Date();
  const day       = now.getUTCDay();
  const todayStr  = now.toISOString().slice(0, 10);
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    if (!symbol) {
      warnings.push('Weekend: verify this is not a forex pair before trading');
    } else if (isForex(symbol)) {
      hardBlocked.push(`Weekend forex trading blocked (${symbol})`);
    }
  }

  const noTradeDates = rr.no_trade_dates || [];
  for (const d of noTradeDates) {
    if (d === todayStr) {
      warnings.push(`FOMC/CPI date today (${d}) — trade with extra caution`);
    }
  }

  const noTradeDuring = rr.no_trades_during || [];
  for (const reason of noTradeDuring) {
    if (/weekend|FOMC|CPI/i.test(reason)) continue;
    warnings.push(reason);
  }

  const blocked = hardBlocked.length > 0;
  let message;
  if (blocked) {
    message = `⛔ TRADE BLOCKED: ${hardBlocked.join('; ')}`;
  } else if (warnings.length > 0) {
    message = `⚠️ CAUTION: ${warnings.join('; ')}`;
  } else {
    message = '✅ No active trade restrictions';
  }

  return { blocked, warnings, hard_blocked_reasons: hardBlocked, message };
}

export function validateRR(entry, stop, target) {
  const rules = getRules();
  const minRR = rules.risk_rules?.min_rr_ratio ?? 3;
  const risk   = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk === 0) return { valid: false, rr: null, min_rr: minRR, reason: 'Stop equals entry' };
  const rr = parseFloat((reward / risk).toFixed(2));
  return {
    valid: rr >= minRR, rr, min_rr: minRR,
    risk: parseFloat(risk.toFixed(8)),
    reward: parseFloat(reward.toFixed(8)),
    reason: rr < minRR ? `R:R ${rr} is below minimum of ${minRR}` : null,
  };
}

export function isWatchlisted(symbol) {
  const rules = getRules();
  const wl    = rules.watchlist || {};
  const all   = [
    ...(Array.isArray(wl) ? wl : []),
    ...(wl.majors || []), ...(wl.alts || []), ...(wl.macro || []),
  ];
  if (!all.length) return false;
  const clean = s => s?.includes(':') ? s.split(':')[1] : s;
  return all.some(s => s === symbol || clean(s) === symbol || clean(s) === clean(symbol));
}

export function getTimeframes() { return getRules().timeframes_to_check || ['1D','4H','1H','15M']; }
export function getBiasCriteria() { return getRules().bias_criteria || {}; }
export function getWatchlist() { return getRules().watchlist || {}; }
export function getRiskRules() { return getRules().risk_rules || {}; }
