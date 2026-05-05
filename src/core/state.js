/**
 * state.js — Persists Oscar's runtime state and protects rules.json from corruption.
 * Survives connection drops, restarts, and crashes.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const STATE_PATH   = join(ROOT, 'oscar_state.json');
const RULES_PATH   = join(ROOT, 'rules.json');
const RULES_BACKUP = join(ROOT, 'rules.backup.json');

const REQUIRED_FIELDS = {
  'watchlist':                   'object',
  'timeframes_to_check':         'array',
  'bias_criteria':               'object',
  'risk_rules':                  'object',
  'risk_rules.min_rr_ratio':     'number',
  'risk_rules.no_trades_during': 'array',
  'indicators_i_care_about':     'array',
};

const DEFAULTS = {
  watchlist: { majors: [], alts: [], macro: [] },
  timeframes_to_check: ['1D','4H','1H','15M'],
  bias_criteria: {
    bullish: 'Price above 50D EMA, RSI on daily between 45 and 70, higher highs and higher lows on 4H',
    bearish: 'Price below 50D EMA, RSI on daily below 45, lower highs and lower lows on 4H',
    neutral: 'Price chopping around 50D EMA, RSI between 40 and 60, no clear structure',
  },
  risk_rules: {
    max_risk_per_trade: '1% of portfolio',
    min_rr_ratio: 3,
    no_trades_during: ['major US CPI', 'FOMC', 'weekend thin liquidity'],
    no_trade_dates: [],
  },
  indicators_i_care_about: ['RSI (14)', 'MACD (12, 26, 9)', '50 EMA', '200 EMA', 'Volume'],
};

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function validateRules(rules) {
  const errors = [];
  for (const [field, type] of Object.entries(REQUIRED_FIELDS)) {
    const val = getNestedValue(rules, field);
    if (val === undefined || val === null) {
      errors.push(`Missing: ${field}`);
    } else if (type === 'array' && !Array.isArray(val)) {
      errors.push(`Invalid type for ${field}: expected array`);
    } else if (type === 'number' && typeof val !== 'number') {
      errors.push(`Invalid type for ${field}: expected number`);
    } else if (type === 'object' && (typeof val !== 'object' || Array.isArray(val))) {
      errors.push(`Invalid type for ${field}: expected object`);
    }
  }
  return errors;
}

function mergeWithDefaults(rules) {
  const merged = { ...DEFAULTS };
  if (rules.watchlist)              merged.watchlist             = rules.watchlist;
  if (rules.timeframes_to_check)    merged.timeframes_to_check   = rules.timeframes_to_check;
  if (rules.bias_criteria)          merged.bias_criteria         = rules.bias_criteria;
  if (rules.risk_rules) {
    merged.risk_rules = { ...DEFAULTS.risk_rules, ...rules.risk_rules };
  }
  if (rules.indicators_i_care_about) merged.indicators_i_care_about = rules.indicators_i_care_about;
  return merged;
}

/**
 * Load rules.json with auto-backup and validation.
 * Falls back to backup if main file is corrupt.
 * Falls back to defaults if both are corrupt.
 */
export function loadRulesSafe() {
  let rules = null;
  let source = 'main';

  // Try main rules.json
  try {
    if (existsSync(RULES_PATH)) {
      rules = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
      const errors = validateRules(rules);
      if (errors.length > 0) {
        console.error('[Oscar] rules.json has issues:', errors.join(', '));
        rules = null;
      } else {
        // Valid — save backup
        copyFileSync(RULES_PATH, RULES_BACKUP);
      }
    }
  } catch (e) {
    console.error('[Oscar] Failed to read rules.json:', e.message);
    rules = null;
  }

  // Try backup
  if (!rules) {
    source = 'backup';
    try {
      if (existsSync(RULES_BACKUP)) {
        rules = JSON.parse(readFileSync(RULES_BACKUP, 'utf8'));
        console.warn('[Oscar] Loaded rules from backup file.');
        // Restore main from backup
        copyFileSync(RULES_BACKUP, RULES_PATH);
      }
    } catch (e) {
      console.error('[Oscar] Backup also failed:', e.message);
      rules = null;
    }
  }

  // Fall back to defaults
  if (!rules) {
    source = 'defaults';
    rules = DEFAULTS;
    console.warn('[Oscar] Using built-in default rules. Check rules.json!');
    writeFileSync(RULES_PATH, JSON.stringify(DEFAULTS, null, 2));
  }

  return { rules: mergeWithDefaults(rules), source };
}

/**
 * Save Oscar's current analysis state to oscar_state.json.
 */
export function saveState(state) {
  try {
    const current = loadState();
    const updated = {
      ...current,
      ...state,
      last_updated: new Date().toISOString(),
    };
    writeFileSync(STATE_PATH, JSON.stringify(updated, null, 2));
    return true;
  } catch (e) {
    console.error('[Oscar] Failed to save state:', e.message);
    return false;
  }
}

/**
 * Load Oscar's persisted state.
 */
export function loadState() {
  try {
    if (existsSync(STATE_PATH)) {
      return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[Oscar] Failed to load state:', e.message);
  }
  return {
    symbol: null,
    timeframe: null,
    last_signal: null,
    last_analysis: null,
    last_updated: null,
    session_count: 0,
  };
}

/**
 * Increment session counter and log startup.
 */
export function onStartup() {
  const state = loadState();
  state.session_count = (state.session_count || 0) + 1;
  state.last_startup = new Date().toISOString();
  saveState(state);
  const { rules, source } = loadRulesSafe();
  console.log(`[Oscar] Session #${state.session_count} started. Rules loaded from: ${source}`);
  console.log(`[Oscar] min_rr: ${rules.risk_rules.min_rr_ratio} | timeframes: ${rules.timeframes_to_check.join(',')} | no_trade_dates: ${rules.risk_rules.no_trade_dates?.length || 0}`);
  return { state, rules, source };
}
