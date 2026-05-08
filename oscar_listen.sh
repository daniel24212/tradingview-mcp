#!/bin/bash
source ~/.oscar_telegram.env
CLAUDE=$(which claude)

# ── Lock: only one instance allowed ──────────────────────────────────────────
LOCKFILE="/tmp/oscar_listen.lock"
if [ -f "$LOCKFILE" ]; then
  PID=$(cat "$LOCKFILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Oscar is already running (PID $PID). Exiting."
    exit 1
  fi
fi
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE; exit" INT TERM EXIT

# ── Clear backlog ─────────────────────────────────────────────────────────────
OFFSET=0
echo "Oscar is listening..."
INIT=$(curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=-1")
LAST_ID=$(echo $INIT | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',[]); print(r[-1]['update_id']+1 if r else 0)" 2>/dev/null)
if [ ! -z "$LAST_ID" ] && [ "$LAST_ID" != "0" ]; then
  OFFSET=$LAST_ID
  echo "Cleared backlog. Starting from update $OFFSET"
fi

# ── Main loop ─────────────────────────────────────────────────────────────────
while true; do
  RESPONSE=$(curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${OFFSET}&timeout=10")
  MESSAGES=$(echo $RESPONSE | python3 -c "
import sys, json
data = json.load(sys.stdin)
if not data.get('ok'):
    sys.exit(1)
for u in data.get('result', []):
    msg = u.get('message', {})
    update_id = u.get('update_id', 0)
    if msg.get('text'):
        print(f'{update_id}|{msg[\"text\"]}')
" 2>/dev/null)

  while IFS='|' read -r UPDATE_ID TEXT; do
    if [ ! -z "$TEXT" ] && [ ! -z "$UPDATE_ID" ]; then
      echo "Received: $TEXT"
      OFFSET=$((UPDATE_ID + 1))

      # Send ONE analyzing message only
      ~/oscar_notify.sh "⏳ Oscar is analyzing $TEXT... (4-6 mins)"

      SENTIMENT=$(~/market_sentiment.sh 2>/dev/null || echo "Sentiment unavailable")

      PROMPT_FILE=$(mktemp /tmp/oscar_XXXXXX.txt)
      cat > "$PROMPT_FILE" << PROMPT
You are Oscar, a professional crypto trading analyst. Do NOT greet or ask questions. Start the analysis immediately using the TradingView MCP tools.

PAIR: $TEXT
MARKET SENTIMENT: $SENTIMENT

## STRICT RULES — READ BEFORE DOING ANYTHING
1. NEVER use training memory for prices, entries, SL, or TP. ALL prices must come from live tool calls.
2. ALWAYS call chart_set_symbol first, then quote_get to confirm the live price.
3. If the live price from quote_get differs from what you expect — use the LIVE price only.
4. Minimum R:R is 1:3. Any TP1 below 1:3 is INVALID. Do not output it.
5. SL must come from rules_suggest_sl — never place SL manually.
6. If rules_check_trade returns BLOCKED — do not generate a signal. Explain why.

## MANDATORY WORKFLOW — follow in exact order:

STEP 1 — Load symbol and get live price
- Call chart_set_symbol with the pair
- Call quote_get — this is the ONLY valid current price. Write it down.

STEP 2 — Check trade conditions
- Call rules_no_trade_check — if BLOCKED stop here and report why
- Call rules_show — confirm active rules (min R:R, timeframes, etc.)

STEP 3 — Multi-timeframe analysis
- Call rules_mtf_analysis with the symbol
- This automatically cycles 1D → 4H → 1H → 15M
- It checks RSI(14), EMA(50/200), MACD(12,26,9), Volume, trendlines on each timeframe
- Wait for the result: STRONG BUY / BUY / WAIT / SELL / STRONG SELL

STEP 4 — If signal is BUY or STRONG BUY:
- Call rules_suggest_sl with direction=buy to get zone-based SL
- Entry = current price from quote_get or nearest demand zone high
- TP1 = entry + (3 × risk), TP2 = entry + (6 × risk)

STEP 5 — If signal is SELL or STRONG SELL:
- Call rules_suggest_sl with direction=sell to get zone-based SL
- Entry = current price from quote_get or nearest supply zone low
- TP1 = entry - (3 × risk), TP2 = entry - (6 × risk)

STEP 6 — Validate the trade
- Call rules_check_trade with entry, stop (from rules_suggest_sl), target (TP1)
- If BLOCKED — skip the trade and explain
- If CAUTION — include the warning in the signal

STEP 7 — Output the signal
Format exactly like this:
📊 [SYMBOL] — Oscar Signal Report
Date: [today] | Live Price: [from quote_get]
Timeframes: 1D → 4H → 1H → 15M
Sentiment: [sentiment]
Confluence: [score]/10

Signal: [BUY/SELL/WAIT]
Entry: [price]
TP1: [price] (R:R 1:3)
TP2: [price] (R:R 1:6)
SL: [price from rules_suggest_sl]
Invalidation: [level]
Zone: [demand/supply zone details]

STEP 8 — Log the trade
- Call trade_log with all signal details
PROMPT

      REPLY=$(cd ~/tradingview-mcp && timeout 720 $CLAUDE -p "$(cat $PROMPT_FILE)" --allowedTools "chart_set_symbol,quote_get,rules_no_trade_check,rules_show,rules_mtf_analysis,rules_suggest_sl,rules_check_trade,rules_get_zones,rules_get_bias,trade_log,data_get_ohlcv,chart_set_timeframe" 2>/dev/null)
      rm -f "$PROMPT_FILE"

      if [ -z "$REPLY" ]; then
        REPLY="❌ Oscar timed out or encountered an error. Please try again."
      fi

      ~/oscar_notify.sh "$REPLY"
    fi
  done <<< "$MESSAGES"
  sleep 2
done
