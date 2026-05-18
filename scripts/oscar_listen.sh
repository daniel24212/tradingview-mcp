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
- Call chart_set_symbol with the pair — ALWAYS use BYBIT: prefix (e.g. BYBIT:BTCUSDT.P, BYBIT:SOLUSDT). Never pass a bare symbol without the exchange prefix
- Call quote_get — write down the price (reading 1)
- Wait 5 seconds, then call quote_get again (reading 2)
- If reading 1 and reading 2 differ by more than 1%, wait 10 more seconds and call quote_get a third time (reading 3) — chart may still be loading
- Use the most stable/consistent reading as the LIVE PRICE. Write it down.

STEP 2 — Check trade conditions
- Call rules_no_trade_check — if BLOCKED stop here and report why
- Call rules_show — confirm active rules (min R:R, timeframes, etc.)

STEP 3 — Multi-timeframe analysis
- Call rules_mtf_analysis with the symbol
- This automatically cycles 1D → 4H → 1H → 15M
- It checks RSI(14), EMA(50/200), MACD(12,26,9), Volume, trendlines on each timeframe
- Wait for the result: STRONG BUY / BUY / WAIT / SELL / STRONG SELL

STEP 3.5 — Advanced Market Context (trading-signals skill)
Using the OHLCV data already loaded, perform these analyses and include results in your final output:

A) MARKOV REGIME — Classify current market state (always first):
   - Bull Quiet / Bull Volatile / Bear Quiet / Bear Volatile / Ranging / Crisis / Recovery
   - This determines methodology weights for the analysis below

B) WYCKOFF PHASE — Identify institutional footprint:
   - Accumulation (Spring/Test) / Markup / Distribution (UTAD/SOW) / Markdown
   - Check volume behaviour: is smart money buying weakness or selling strength?

C) ELLIOTT WAVE — Identify current wave position:
   - Which wave are we in? (1-5 impulse or A-B-C correction)
   - Are we near wave 3 (highest probability entry) or wave 5 (exhaustion — avoid longs)?

D) FIBONACCI — Calculate key levels from last major swing:
   - Identify swing high and swing low from last significant move
   - Key retracement levels: 0.382, 0.5, 0.618, 0.786
   - Extension targets: 1.272, 1.414, 1.618
   - Do current price and TP levels align with Fib zones?

E) REGIME-WEIGHTED CONFLUENCE — Adjust signal confidence:
   - Trending regime: weight Elliott Wave + Turtle heavily (0.30 each)
   - Ranging regime: weight Fibonacci + Wyckoff heavily (0.30 each)
   - Crisis/volatile: require 4/4 TF confluence minimum before firing signal

Include a summary line: "Advanced Context: [Regime] | [Wyckoff Phase] | [Elliott Wave] | Fib support at [level] / resistance at [level]"

F) SENTIMENT — Using sentiment-signals reference:
   - State current Fear & Greed score and zone (Extreme Fear/Fear/Neutral/Greed/Extreme Greed)
   - Extreme Fear (<25): contrarian BUY bias — smart money accumulates when retail panics
   - Extreme Greed (>75): contrarian SELL bias — distribution likely in progress
   - Does sentiment confirm or contradict the technical setup? Flag any divergence
   - Add to summary: "Sentiment: [score]/100 [zone] — [confirms/contradicts] technical bias"

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
TP1: [price] -- RR 1 to 3
TP2: [price] -- RR 1 to 6
(For day trades use: TP1 RR 1 to 1.5, TP2 RR 1 to 3)
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
            WAIT_MINS=10
            ~/oscar_notify.sh "⏰ WAIT signal detected. Oscar will recheck $RECHECK_SYMBOL in ${WAIT_MINS} mins (attempt $RETRY/$MAX_RETRIES)..."
            sleep $((WAIT_MINS * 60))
            ~/oscar_notify.sh "🔄 Rechecking $RECHECK_SYMBOL now..."
            RECHK_FILE=$(mktemp /tmp/oscar_rechk_XXXXXX.txt)
            cat > "$RECHK_FILE" << RPROMPT
You are Oscar. Recheck $RECHECK_SYMBOL for a trade signal. IMPORTANT: Fetch the live price twice with a 5-second gap. If the two readings differ by more than 1%, wait 10 more seconds and fetch again — chart may still be loading. Only analyse once price is stable. Use the same MTF workflow. If signal is still WAIT say "STILL WAIT". If BUY or SELL found, give the full signal with entry, TP1, TP2, SL.
RPROMPT
            RECHK_REPLY=$(cd ~/tradingview-mcp && timeout 720 $CLAUDE -p "$(cat $RECHK_FILE)" --allowedTools "chart_set_symbol,quote_get,rules_no_trade_check,rules_mtf_analysis,rules_suggest_sl,rules_check_trade,trade_log,data_get_ohlcv,chart_set_timeframe" 2>/dev/null)
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
