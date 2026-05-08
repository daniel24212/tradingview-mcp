# Oscar Trading System

Oscar is a Telegram-driven crypto trading assistant. A message arrives, Oscar runs a live multi-timeframe analysis through TradingView, and replies with a structured signal.

---

## Architecture

```
Telegram
  ↓  (getUpdates long-poll)
~/oscar_listen.sh
  ↓  (spawns: claude -p "You are Oscar…")
Claude Code  ←→  tradingview-mcp MCP server  (stdio)
                        ↓  (Chrome DevTools Protocol)
               Chrome — 127.0.0.1:9222
                        ↓
               TradingView live chart
               (real candles, indicators, zones)
```

Every price, zone, and level comes from a live tool call. Never generate levels from memory.

---

## Key Files

### In this repo

| File | Purpose |
|------|---------|
| `src/server.js` | MCP server entry point — registers all tool groups, starts stdio transport |
| `src/connection.js` | CDP connection manager — retry logic, `evaluate()`, `safeString()` |
| `src/core/bias.js` | `analyzeBias()` — RSI(14), EMA(50/200), MACD(12,26,9), price structure, volume |
| `src/core/zones.js` | `detectZones()`, `suggestSL()` — demand/supply zone detection and SL placement |
| `src/core/rules.js` | `getRules()`, `isNoTradeWindow()`, `validateRR()`, `isWatchlisted()` |
| `src/core/trendlines.js` | `analyzeTrendlines()` — support/resistance from pivot points |
| `src/tools/rules.js` | MCP tools: `rules_mtf_analysis`, `rules_suggest_sl`, `rules_check_trade`, etc. |
| `src/tools/data.js` | MCP tools: `quote_get`, `data_get_ohlcv`, `data_get_study_values` |
| `src/tools/chart.js` | MCP tools: `chart_set_symbol`, `chart_set_timeframe`, `chart_get_state` |
| `src/tools/logger.js` | MCP tools: `trade_log`, `trade_update`, `trade_history`, `trade_performance` |
| `rules.json` | Live config — watchlist, R:R ratio, no-trade dates, zone buffer, indicators |

### Shell scripts in `~/` (not in repo — do not commit)

| File | Purpose |
|------|---------|
| `~/start_oscar.sh` | Full system boot: DNS fix → Xvfb → Chrome → MCP server → listener |
| `~/oscar_listen.sh` | Telegram long-poll loop. Spawns `claude -p` per message. On WAIT verdict, auto-rechecks after 10 minutes. |
| `~/oscar_notify.sh` | Sends a message to Telegram via bot API |
| `~/.oscar_telegram.env` | Exports `TELEGRAM_TOKEN` and `CHAT_ID` — never commit |

---

## Starting Oscar

### Full boot

```bash
~/start_oscar.sh
```

Performs in order:
1. **DNS fix** — locks `/etc/resolv.conf` with `chattr +i` so WSL2 can't overwrite it
2. **Xvfb** — starts virtual display `:99` (Chrome requires a display)
3. **Chrome** — launches with `--remote-debugging-port=9222` on TradingView
4. **MCP server** — `cd ~/tradingview-mcp && npm start` (background)
5. **Listener** — `~/oscar_listen.sh` (foreground)

### Manual (two terminals)

```bash
# Terminal 1
cd ~/tradingview-mcp && npm start

# Terminal 2
~/oscar_listen.sh
```

### Verify

```bash
curl -s http://127.0.0.1:9222/json/version   # CDP alive
pgrep -af oscar_listen                        # listener running
pgrep -a node                                 # MCP server running
```

---

## Telegram Commands

| Message | Mode | Timeframes | Minimum R:R |
|---------|------|-----------|-------------|
| `analyze BTCUSDT` | Swing | 1D → 4H → 1H → 15M | 1:3 |
| `ETHUSDT` (bare pair) | Swing | 1D → 4H → 1H → 15M | 1:3 |
| `day trade SOLUSDT` | Intraday | 4H → 1H → 15M → 5M | 1:1.5 |

**WAIT auto-recheck:** If the MTF analysis returns WAIT (mixed timeframes, no confluence), `oscar_listen.sh` schedules a recheck in 10 minutes and notifies you. If confluence improves, a signal is sent automatically.

**Signal output format:**

```
📊 BTCUSDT | 2026-05-08 | $98,450 (live from quote_get)
📈 Bias: STRONG BUY — 4/4 timeframes bullish
🎯 Entry: $98,200
✅ TP1: $101,500  (R:R 1:3.3)
✅ TP2: $104,800
❌ SL: $97,100 — below demand zone 96,900–97,200 (fresh, 0 touches, strong impulse)
⚠️ Invalidation: daily close below $96,500
🔢 Confluence: 8/10
```

If no valid SL zone exists: `⛔ No valid SL zone — trade skipped.`

---

## MCP Tools Reference

### Signal workflow — call in this order

```
chart_set_symbol(symbol)          # load chart
quote_get()                       # live price — the ONLY valid price source
rules_no_trade_check()            # abort if FOMC/CPI block
rules_mtf_analysis(symbol)        # 1D→4H→1H→15M confluence
rules_suggest_sl(direction)       # zone-based SL
rules_check_trade(entry,sl,tp)    # R:R + no-trade gate
trade_log(...)                    # save approved signal
```

### Core trading tools

| Tool | Purpose |
|------|---------|
| `chart_set_symbol` | Load ticker. Bare crypto symbols auto-get `BYBIT:` prefix. |
| `chart_set_timeframe` | Switch resolution: `"15"`, `"60"`, `"240"`, `"1D"` |
| `quote_get` | Live price snapshot — always call immediately after `chart_set_symbol` |
| `data_get_ohlcv` | Price bars. Always pass `summary: true` unless you need raw bars. |
| `rules_mtf_analysis` | Full 1D→4H→1H→15M analysis. Returns STRONG BUY / BUY / WAIT / SELL / STRONG SELL + confluence score. |
| `rules_get_zones` | All demand/supply zones: boundaries, strength, freshness, touch count |
| `rules_suggest_sl` | Best SL from strongest qualifying zone. Buffer = max(15% zone height, 0.5× ATR). |
| `rules_check_trade` | Pre-trade gate: no-trade window + R:R + bias. Returns APPROVED / CAUTION / BLOCKED. |
| `rules_no_trade_check` | Is now a blocked window? (FOMC, CPI, weekend forex) |
| `rules_validate_rr` | Standalone R:R check against `min_rr_ratio` from rules.json |
| `rules_get_bias` | Single-timeframe bias check |
| `rules_show` | Display full active rules.json config |
| `trade_log` | Save signal to journal |
| `trade_history` | View recent trades |
| `trade_performance` | Win rate, total R, by symbol |

### Context rules

- `data_get_ohlcv`: always `summary: true` unless individual bars are needed
- `data_get_pine_*`: always pass `study_filter` to target one indicator
- `pine_get_source`: avoid — complex scripts return 200KB+
- `chart_get_state`: call once per session, reuse entity IDs

---

## Trading Logic

### MTF Confluence (rules_mtf_analysis)

Each timeframe gets scored on: RSI(14), EMA(50/200) position, price structure (HH/HL), MACD, volume, trendlines.

| Bullish TFs | Bearish TFs | Verdict |
|-------------|-------------|---------|
| 4/4 or 3/4 | — | STRONG BUY |
| 2/4 | — | BUY |
| — | 4/4 or 3/4 | STRONG SELL |
| — | 2/4 | SELL |
| Mixed | Mixed | WAIT |

Only output a signal on STRONG BUY / STRONG SELL (confluence ≥ 7/10). On WAIT, recheck in 10 minutes.

### Zone Quality Filter (src/core/zones.js)

Zones are detected as: consolidation base (3–12 candles within 1.5× avg range) followed by impulse candle (>1.8× avg range breaking out).

Freshness formula: `freshness = max(0.1, 1 − returns_to_zone × 0.25)`

| Touches | Freshness | Status | Tradeable |
|---------|-----------|--------|-----------|
| 0 | 1.00 | Fresh | ✅ |
| 1 | 0.75 | Tested once | ✅ |
| 2 | 0.50 | Weakened | ⚠️ |
| **3** | **0.25** | **Compromised** | **❌ Reject** |
| 4+ | 0.10 | Exhausted | ❌ Reject |

**SL zone must pass all four criteria:**
1. Fresh — 0 or 1 touch (freshness ≥ 0.75)
2. Strong impulse away — impulse candle > 1.8× average range
3. HTF visible — detectable on 1H or 4H bars
4. Clean base — minimal wicks inside the consolidation

### R:R Rules (src/core/rules.js)

| Mode | Minimum R:R | Source |
|------|-------------|--------|
| Swing (`analyze`) | 1:3 | `min_rr_ratio: 3` in rules.json |
| Intraday (`day trade`) | 1:1.5 | Overridden in day trade prompt |

Any signal below the minimum is invalid — do not output it.

### No-Trade Windows

FOMC meeting days and major CPI releases are listed in `rules.json → no_trade_dates`.  
Weekend forex is blocked; weekend crypto is allowed (`weekend_crypto_allowed: true`).  
`rules_no_trade_check` returns `blocked: true` with reason if inside a window.

---

## rules.json Config

```jsonc
{
  "min_rr_ratio": 3,              // Change to 1.5 for day trade sessions
  "sl_zone_buffer_pct": 0.15,    // SL buffer = 15% of zone height
  "sl_atr_multiplier": 0.5,      // + 0.5× ATR cushion

  "weekend_crypto_allowed": true,
  "weekend_forex_blocked": true,
  "fomc_behavior": "warning",    // "warning" | "block"
  "cpi_behavior": "warning",

  "watchlist": {
    "majors": ["BYBIT:BTCUSDT", "BYBIT:ETHUSDT", "BYBIT:SOLUSDT"],
    "alts":   ["BYBIT:LINKUSDT", "BYBIT:AVAXUSDT", "BYBIT:SUIUSDT"],
    "macro":  ["CRYPTOCAP:TOTAL", "CRYPTOCAP:TOTAL3", "CRYPTOCAP:BTC.D"]
  },

  "no_trade_dates": ["2026-01-29", "2026-03-19", ...],  // FOMC/CPI dates YYYY-MM-DD

  "indicators_i_care_about": ["RSI (14)", "MACD (12, 26, 9)", "50 EMA", "200 EMA", "Volume"]
}
```

After editing rules.json, restart the MCP server to reload: `cd ~/tradingview-mcp && npm start`

---

## Chrome / CDP Setup

| Setting | Value |
|---------|-------|
| CDP endpoint | `127.0.0.1:9222` |
| Virtual display | Xvfb `:99` (`DISPLAY=:99`) |
| Symbol prefix | `BYBIT:` — auto-applied to bare crypto tickers |

**Perpetual contracts** use `.P` suffix: `BYBIT:ALICEUSDT.P`

**BYBIT prefix logic** (`src/tools/rules.js → resolveSymbol`): any symbol ending in `USDT/USDC/BTC/ETH/BNB/SOL` or containing digits gets `BYBIT:` prepended unless it already has an exchange prefix. This prevents TradingView defaulting to CFD feeds (which show volume = 0).

---

## DNS Fix for WSL2

WSL2 overwrites `/etc/resolv.conf` on every restart, breaking DNS (npm install fails, curl can't reach Telegram API).

```bash
# Lock resolv.conf permanently
sudo chattr +i /etc/resolv.conf

# Also disable WSL2 auto-generation — add to /etc/wsl.conf:
[network]
generateResolvConf = false

# To unlock if you need to edit nameservers:
sudo chattr -i /etc/resolv.conf
```

`~/start_oscar.sh` runs `chattr +i` automatically on boot.

---

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `CDP connection failed after 5 attempts` | Chrome not running or CDP port not open | `pkill tradingview`; relaunch Chrome with `--remote-debugging-port=9222`; run `~/start_oscar.sh` |
| `No TradingView chart target found` | TradingView tab not open in the debug Chrome | Navigate to `tradingview.com/chart` in the CDP Chrome instance |
| `curl: Could not resolve host` / npm install fails | DNS overwritten by WSL2 | `sudo chattr +i /etc/resolv.conf`; verify with `cat /etc/resolv.conf` |
| quote_get returns wrong symbol after timeframe switch | Chart drifted to a different pair | Call `quote_get` twice — once immediately after `chart_set_symbol`, again after the timeframe switch; if symbol differs, call `chart_set_symbol` again |
| Volume = 0 on crypto | TradingView defaulted to CFD/synthetic feed | Ensure symbol uses `BYBIT:` prefix |
| Oscar sends no reply, 720s timeout | TradingView not responding to CDP | `curl -s http://127.0.0.1:9222/json/version`; if blank, restart Chrome |
| Two Oscar instances running | Listener started twice | `pkill -f oscar_listen.sh`; restart once |
| Zones not detected | Too few bars loaded | Increase `bar_count` parameter; default is 300 |

---

## Development Guide

### Add a new MCP tool

1. Open the relevant file in `src/tools/`
2. Inside `export function register*Tools(server)`, add:
   ```js
   server.tool('tool_name', 'Description', {
     param: z.string().describe('what it does'),
   }, async ({ param }) => {
     try {
       return jsonResult({ success: true, ... });
     } catch (err) {
       return jsonResult({ success: false, error: err.message }, true);
     }
   });
   ```
3. Restart MCP server; add to this CLAUDE.md

### Change R:R threshold

Edit `min_rr_ratio` in `rules.json`. Restart MCP server. `validateRR()` in `src/core/rules.js` reads this value.

### Add pairs to scan

Edit `PAIRS` array in `~/oscar_scan.sh`. Bare symbols — `resolveSymbol()` adds `BYBIT:` automatically.

### Add no-trade dates

Append `"YYYY-MM-DD"` to `no_trade_dates` in `rules.json`. Restart MCP server.

---

## Git

**Remote:** `https://github.com/daniel24212/tradingview-mcp.git`  
**Branch:** `main`

```bash
cd ~/tradingview-mcp
git add -A
git commit -m "describe change"
git push origin main
```

**Never commit:** `~/.oscar_telegram.env`, `~/oscar_listen.sh`, `~/oscar_notify.sh`, `~/start_oscar.sh`, `screenshots/`

The `~/` shell scripts call into this repo but are managed separately — they are not versioned here.
