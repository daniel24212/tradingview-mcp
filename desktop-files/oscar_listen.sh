#!/bin/bash
source ~/.oscar_telegram.env
CLAUDE=$(which claude)
OFFSET=0
echo "Oscar is listening..."

# Clear any pending backlog messages on startup
INIT=$(curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=-1")
LAST_ID=$(echo $INIT | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',[]); print(r[-1]['update_id']+1 if r else 0)" 2>/dev/null)
if [ ! -z "$LAST_ID" ] && [ "$LAST_ID" != "0" ]; then
  OFFSET=$LAST_ID
  echo "Cleared backlog. Starting from update $OFFSET"
fi

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
      SENTIMENT=$(~/market_sentiment.sh)
      ~/oscar_notify.sh "⏳ Oscar is analyzing... (deep 4H→1H→30M→15M scan, please allow 4-6 mins)"
      REPLY=$(cd ~/tradingview-mcp && timeout 720 $CLAUDE -p "You are Oscar, a crypto trading analyst. Do NOT greet or ask questions — immediately execute the analysis steps below.

PAIR TO ANALYZE: $TEXT
MARKET SENTIMENT: $SENTIMENT

STEP 1 — Set the chart symbol:
Call chart_set_symbol with the requested pair. Confirm it loaded correctly.

STEP 2 — Read each timeframe using these exact tools:
- Call chart_set_timeframe with interval '240' (4H), then call data_get_ohlcv to read price data
- Call chart_set_timeframe with interval '60' (1H), then call data_get_ohlcv to read price data
- Call chart_set_timeframe with interval '30' (30M), then call data_get_ohlcv to read price data
- Call chart_set_timeframe with interval '15' (15M), then call data_get_ohlcv to read price data
After each timeframe switch, call quote_get to confirm the symbol is still correct. If it has shifted to a different pair, call chart_set_symbol again and re-read that timeframe.

STEP 3 — Identify supply and demand zones from the data collected.

STEP 4 — Determine bias (BUY or SELL) based on multi-timeframe structure.

STEP 5 — Select the SL zone. The SL zone MUST meet ALL of these:
1. FRESH — tested once or never
2. STRONG IMPULSE AWAY — price left aggressively
3. HTF VISIBILITY — visible on 1H or 4H
4. CLEAN AND TIGHT — minimal wicks inside
For BUY: SL goes just below the strongest qualifying demand zone.
For SELL: SL goes just above the strongest qualifying supply zone.
If NO zone qualifies, respond: ⛔ No valid SL zone — trade skipped.

STEP 6 — Output the signal in this format:
📊 Symbol | Date | Current Price
📈 Bias
🎯 Entry
✅ TP1 (min 1:3 RR)
✅ TP2
❌ SL — with zone name and why it qualifies
⚠️ Invalidation
🔢 Confluence Score /10" 2>/dev/null)

      if [ -z "$REPLY" ]; then
        REPLY="❌ Oscar timed out. Please try again."
      fi
      ~/oscar_notify.sh "$REPLY"
    fi
  done <<< "$MESSAGES"
  sleep 2
done
