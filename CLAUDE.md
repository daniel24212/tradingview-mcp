# TradingView MCP — Claude Instructions

68 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"
1. `pine_set_source` → inject code into editor
2. `pine_smart_compile` → compile with auto-detection + error check
3. `pine_get_errors` → read compilation errors
4. `pine_get_console` → read log.info() output
5. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
6. `pine_save` → save to TradingView cloud
7. `pine_new` → create blank indicator/strategy/library
8. `pine_open` → load a saved script by name

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`

## ⚠️ CRITICAL — NO HALLUCINATION RULE
**NEVER generate price levels, entry points, stop losses, take profits, or any market analysis from training memory.**
Every single price, level, and signal MUST come from live tool calls. If the tools fail, say so — do not substitute with remembered data.

Before ANY analysis:
1. Call `chart_set_symbol` to switch to the requested symbol
2. Call `quote_get` IMMEDIATELY after — verify the live price matches what you expect
3. If the live price differs significantly from what you remember — USE THE LIVE PRICE, not your memory
4. Include the live price from `quote_get` in every signal output

If you find yourself writing price levels without having called `quote_get` first — STOP and call the tools.

## Signal Generation Workflow (MANDATORY)
When asked to analyze a symbol or generate a signal, follow this exact sequence — no shortcuts:

### Step 1 — Load the symbol
- `chart_set_symbol` with the requested symbol
- Wait 1.5 seconds for chart to load
- `quote_get` → get live price (THIS IS THE ONLY VALID PRICE)

### Step 2 — Check trade conditions
- `rules_no_trade_check` → check for no-trade windows (FOMC, weekend forex block)
- `rules_show` → confirm active ruleset (min R:R, timeframes, etc.)

### Step 3 — Multi-timeframe analysis
- `rules_mtf_analysis` with symbol and mode (trend or reversal)
  - This cycles 1D → 4H → 1H → 15M automatically
  - Returns STRONG BUY / BUY / WAIT / SELL / STRONG SELL with confluence score
  - Includes RSI(14), EMA(50/200), MACD(12,26,9), Volume, trendlines on each timeframe

### Step 4 — Zone-based stop loss
- `rules_suggest_sl` with direction (buy or sell) → returns strongest zone SL
- Never place SL manually — always use the zone-based suggestion

### Step 5 — Validate the trade
- `rules_check_trade` with entry, stop, target → validates R:R (min 1:3), no-trade window, bias
- If verdict is BLOCKED → do not generate a signal, explain why
- If verdict is CAUTION → generate signal with warning

### Step 6 — Log the signal
- `trade_log` → save every approved signal to the journal automatically

### R:R Rules (ENFORCED)
- Minimum R:R = 1:3 (risk 1 to make 3)
- TP1 must be at least 3× the risk distance
- Any signal with TP1 R:R below 1:3 is INVALID — do not output it

### Mode Selection
- Default: trend mode (follows 1D/4H macro bias)
- When user says "reversal" or "bounce": use `mode: reversal, direction: buy/sell`
- Reversal mode only looks at 1H + 15M and checks if price is at a zone

## New Rules Tools Reference
| Tool | Purpose |
|------|---------|
| `rules_mtf_analysis` | Full 1D→4H→1H→15M confluence with trendlines |
| `rules_get_bias` | Single timeframe bias (RSI, EMA, MACD, Volume, trendlines) |
| `rules_get_zones` | Detect all demand/supply zones with strength scores |
| `rules_suggest_sl` | Best SL from strongest zone (buy=below demand, sell=above supply) |
| `rules_check_trade` | Full pre-trade gate (no-trade + R:R + bias + zones) |
| `rules_no_trade_check` | Check if current time/date is blocked |
| `rules_validate_rr` | Validate entry/stop/target R:R ratio |
| `rules_show` | Display full active ruleset |
| `trade_log` | Save signal to journal |
| `trade_update` | Update trade outcome |
| `trade_history` | View recent trades |
| `trade_performance` | Win rate, total R, performance by symbol |
