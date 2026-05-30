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
You are Oscar, a professional crypto trading assistant. Follow these steps EXACTLY. Do not deviate.

PAIR: $TEXT
SENTIMENT: $SENTIMENT

STEP 1 — Load chart and get live price
- Call chart_set_symbol with BYBIT:{PAIR} prefix
- Call quote_get — this is the ONLY valid price source
- Call quote_get again after 5 seconds — use the stable reading

STEP 2 — Check trade window
- Call rules_no_trade_check — if blocked, output "⛔ BLOCKED: [reason]" and stop

STEP 3 — Run MTF analysis
- Call rules_mtf_analysis with the symbol
- READ the response carefully:
  - If gate_blocked is true → output EXACTLY this one line and STOP:
    "⏳ WAIT — Confluence [confluence_score] below minimum (8/10). No trade."
  - Do NOT output anything else. No scorecard. No entry. No SL. No TP. No options.
  - If gate_blocked is false → continue to STEP 4

STEP 4 — Get stop loss (only if gate passed)
- Call rules_suggest_sl with direction matching the verdict

STEP 5 — Validate trade
- Call rules_check_trade with entry, stop, TP1
- If BLOCKED → output "⛔ R:R BLOCKED: [reason]" and stop

STEP 6 — Output signal (only if all gates passed)
Format exactly:
📊 [SYMBOL] | $[price] live
📈 Bias: [verdict] — [advice]
⏳ Trigger: [entry condition]
🎯 Entry: $[price]
❌ SL: $[price] → Risk: $[amount]
✅ TP1: $[price] ([level name]) → R:R 1:[ratio]
✅ TP2: $[price] ([level name]) → R:R 1:[ratio]
⚠️ Invalidation: [condition]
🔢 Confluence: [score]/10

STEP 7 — Log the trade
- Call trade_log with all signal details
PROMPT

      REPLY=$(cd ~/tradingview-mcp && timeout 720 $CLAUDE -p "$(cat $PROMPT_FILE)" --allowedTools "chart_set_symbol,quote_get,rules_no_trade_check,rules_show,rules_mtf_analysis,rules_suggest_sl,rules_check_trade,rules_get_zones,trade_log" 2>/dev/null)
      rm -f "$PROMPT_FILE"

      if [ -z "$REPLY" ]; then
        REPLY="❌ Oscar timed out or encountered an error. Please try again."
      fi

      ~/oscar_notify.sh "$REPLY"

      # ── Auto-recheck if WAIT signal ──────────────────────────────────────
      echo "[DEBUG $(date)] REPLY snippet: $(echo "$REPLY" | head -5)" >> /tmp/oscar_debug.log
      if echo "$REPLY" | grep -qiE "signal.*WAIT|NO TRADE|confluence.*0|WAIT.*No valid|Verdict.*WAIT|STILL WAIT|no signal|⏳ WAIT"; then
        echo "[DEBUG $(date)] WAIT pattern MATCHED — spawning recheck" >> /tmp/oscar_debug.log
        RECHECK_SYMBOL="$SYMBOL"
        RECHECK_IS_DAYTRADE="$IS_DAYTRADE"
        (
          MAX_RETRIES=3
          RETRY=0
          while [ $RETRY -lt $MAX_RETRIES ]; do
            RETRY=$((RETRY + 1))
            echo "[DEBUG $(date)] Recheck attempt $RETRY starting..." >> /tmp/oscar_debug.log
            WAIT_MINS=5
            ~/oscar_notify.sh "⏰ WAIT signal detected. Oscar will recheck $RECHECK_SYMBOL in ${WAIT_MINS} mins (attempt $RETRY/$MAX_RETRIES)..."
            sleep $((WAIT_MINS * 60))
            ~/oscar_notify.sh "🔄 Rechecking $RECHECK_SYMBOL now..."
            RECHK_FILE=$(mktemp /tmp/oscar_rechk_XXXXXX.txt)
            cat > "$RECHK_FILE" << RPROMPT
You are Oscar. Recheck $RECHECK_SYMBOL. Call chart_set_symbol, then quote_get twice 5 seconds apart. Call rules_mtf_analysis. If gate_blocked is true output exactly: "⏳ STILL WAIT — Confluence [score]/10 below minimum (8/10). No trade." and nothing else. If gate_blocked is false, call rules_suggest_sl, rules_check_trade, then output the full signal in the standard format.
RPROMPT
            RECHK_REPLY=$(cd ~/tradingview-mcp && timeout 720 $CLAUDE -p "$(cat $RECHK_FILE)" --allowedTools "chart_set_symbol,quote_get,rules_no_trade_check,rules_mtf_analysis,rules_suggest_sl,rules_check_trade,trade_log" 2>/dev/null)
            rm -f "$RECHK_FILE"
            if [ -z "$RECHK_REPLY" ]; then
              RECHK_REPLY="❌ Recheck timed out."
            fi
            ~/oscar_notify.sh "$RECHK_REPLY"
            # Stop retrying if signal found
            if echo "$RECHK_REPLY" | grep -qiE "signal.*BUY|signal.*SELL|STRONG BUY|STRONG SELL"; then
              break
            fi
          done
          if [ $RETRY -eq $MAX_RETRIES ]; then
            ~/oscar_notify.sh "⏹️ $RECHECK_SYMBOL still no trade after $MAX_RETRIES rechecks. Monitoring stopped."
          fi
        ) &
      fi
    fi
  done <<< "$MESSAGES"
  sleep 2
done
