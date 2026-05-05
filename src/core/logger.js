import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, '../../trades.json');
const CSV_PATH = join(__dirname, '../../trades.csv');
const CSV_HEADER = 'id,timestamp,symbol,direction,timeframes,entry,sl,tp1,tp2,rr_tp1,rr_tp2,confluence,bias,sentiment,status,outcome,pnl_r,notes\n';
function loadTrades() {
  if (!existsSync(LOG_PATH)) return [];
  try { return JSON.parse(readFileSync(LOG_PATH, 'utf8')); } catch { return []; }
}
function saveTrades(trades) { writeFileSync(LOG_PATH, JSON.stringify(trades, null, 2)); }
function ensureCSV() { if (!existsSync(CSV_PATH)) writeFileSync(CSV_PATH, CSV_HEADER); }
function tradeToCSV(t) {
  return [t.id, t.timestamp, t.symbol, t.direction, (t.timeframes||[]).join('-'), t.entry, t.sl, t.tp1||'', t.tp2||'', t.rr_tp1||'', t.rr_tp2||'', t.confluence||'', t.bias||'', t.sentiment||'', t.status, t.outcome||'', t.pnl_r||'', (t.notes||'').replace(/,/g,';')].join(',') + '\n';
}
export function logTrade(trade) {
  const trades = loadTrades();
  const id = `TRD-${Date.now()}`;
  const entry = { id, timestamp: new Date().toISOString(), symbol: trade.symbol||'', direction: trade.direction||'', timeframes: trade.timeframes||['1D','4H','1H','15M'], entry: trade.entry??null, sl: trade.sl??null, tp1: trade.tp1??null, tp2: trade.tp2??null, rr_tp1: trade.rr_tp1??null, rr_tp2: trade.rr_tp2??null, confluence: trade.confluence??null, bias: trade.bias||'', sentiment: trade.sentiment||'', status: 'pending', outcome: null, pnl_r: null, notes: trade.notes||'' };
  trades.push(entry);
  saveTrades(trades);
  ensureCSV();
  appendFileSync(CSV_PATH, tradeToCSV(entry));
  return { success: true, id, trade: entry };
}
export function updateTrade(id, updates) {
  const trades = loadTrades();
  const idx = trades.findIndex(t => t.id === id);
  if (idx === -1) return { success: false, reason: `Trade ${id} not found` };
  trades[idx] = { ...trades[idx], ...updates };
  saveTrades(trades);
  writeFileSync(CSV_PATH, CSV_HEADER + trades.map(tradeToCSV).join(''));
  return { success: true, trade: trades[idx] };
}
export function getTrades(limit = 20) { return loadTrades().slice(-limit).reverse(); }
export function getPerformance() {
  const trades = loadTrades().filter(t => t.outcome);
  if (!trades.length) return { success: true, message: 'No closed trades yet', stats: null };
  const wins = trades.filter(t => t.outcome === 'win').length;
  const losses = trades.filter(t => t.outcome === 'loss').length;
  const be = trades.filter(t => t.outcome === 'breakeven').length;
  const pnl = trades.filter(t => t.pnl_r != null).map(t => parseFloat(t.pnl_r));
  const totalR = parseFloat(pnl.reduce((a,b) => a+b, 0).toFixed(2));
  const bySymbol = {};
  for (const t of trades) {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { wins:0, losses:0, total_r:0 };
    if (t.outcome === 'win') bySymbol[t.symbol].wins++;
    if (t.outcome === 'loss') bySymbol[t.symbol].losses++;
    if (t.pnl_r != null) bySymbol[t.symbol].total_r += parseFloat(t.pnl_r);
  }
  return { success: true, stats: { total_trades: trades.length, wins, losses, breakeven: be, win_rate_pct: parseFloat(((wins/trades.length)*100).toFixed(1)), total_r: totalR, avg_r: pnl.length ? parseFloat((totalR/pnl.length).toFixed(2)) : null, best_r: pnl.length ? Math.max(...pnl) : null, worst_r: pnl.length ? Math.min(...pnl) : null, by_symbol: bySymbol } };
}
