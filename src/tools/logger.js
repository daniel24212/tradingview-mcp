import { z } from 'zod';
import { jsonResult } from './_format.js';
import { logTrade, updateTrade, getTrades, getPerformance } from '../core/logger.js';
export function registerLoggerTools(server) {
  server.tool('trade_log', 'Save a trade signal to Oscar\'s journal (trades.json + trades.csv). Call this after every signal Oscar generates.', {
    symbol:      z.string().describe('e.g. SOLUSDT, ALICEUSDT.P'),
    direction:   z.string().describe('buy or sell'),
    entry:       z.coerce.number().describe('Entry price'),
    sl:          z.coerce.number().describe('Stop loss price'),
    tp1:         z.coerce.number().optional().describe('Take profit 1'),
    tp2:         z.coerce.number().optional().describe('Take profit 2'),
    rr_tp1:      z.coerce.number().optional().describe('R:R at TP1'),
    rr_tp2:      z.coerce.number().optional().describe('R:R at TP2'),
    confluence:  z.coerce.number().optional().describe('Confluence score e.g. 7'),
    bias:        z.string().optional().describe('Bias summary e.g. bearish BOS, supply retest'),
    sentiment:   z.string().optional().describe('Market sentiment e.g. Fear 33'),
    timeframes:  z.array(z.string()).optional().describe('Timeframes used e.g. ["4H","1H","30M","15M"]'),
    notes:       z.string().optional().describe('Any extra notes'),
  }, async (trade) => {
    try { return jsonResult(logTrade(trade)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
  server.tool('trade_update', 'Update a logged trade with its outcome. Use after trade closes.', {
    id:      z.string().describe('Trade ID e.g. TRD-1234567890'),
    status:  z.string().optional().describe('active, closed, cancelled'),
    outcome: z.string().optional().describe('win, loss, breakeven'),
    pnl_r:   z.coerce.number().optional().describe('P&L in R multiples e.g. 3 for +3R, -1 for -1R'),
    notes:   z.string().optional().describe('Closing notes'),
  }, async ({ id, ...updates }) => {
    try { return jsonResult(updateTrade(id, updates)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
  server.tool('trade_history', 'Show recent logged trades from Oscar\'s journal.', {
    limit: z.coerce.number().optional().describe('Number of trades to show (default 20)'),
  }, async ({ limit = 20 }) => {
    try { return jsonResult({ success: true, trades: getTrades(limit) }); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
  server.tool('trade_performance', 'Show Oscar\'s overall performance stats: win rate, total R, avg R per trade, best/worst trade, breakdown by symbol.', {}, async () => {
    try { return jsonResult(getPerformance()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
