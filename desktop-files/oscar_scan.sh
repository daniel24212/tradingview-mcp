#!/bin/bash
source ~/.oscar_telegram.env
CLAUDE=$(which claude)

PAIRS=("BTCUSDT" "ETHUSDT" "SOLUSDT" "BNBUSDT" "XRPUSDT" "ADAUSDT" "DOGEUSDT" "AVAXUSDT" "LINKUSDT" "DOTUSDT")
RESULTS_DIR=$(mktemp -d /tmp/oscar_scan_XXXXXX)

~/oscar_notify.sh "🔍 Oscar scanning ${#PAIRS[@]} pairs for long setups... (~6-7 mins)"

# --- Scan each pair in parallel ---
scan_pair() {
  local PAIR=$1
  local OUTFILE="$RESULTS_DIR/$PAIR.txt"

  PROMPT="You are Oscar, a crypto trading analyst. Scan $PAIR for a long trade setup. Do not greet or explain — just execute and output structured data.

STEPS:
1. Call chart_set_symbol to load $PAIR. Call quote_get to confirm.
2. Call chart_set_timeframe interval=240 then data_get_ohlcv (4H)
3. Call chart_set_timeframe interval=60 then data_get_ohlcv (1H)
4. Call chart_set_timeframe interval=30 then data_get_ohlcv (30M)
5. Identify key demand and supply zones.
6. Determine if a LONG setup exists based on: bullish 4H structure, price at or near demand, 1H/30M confirmation.
7. Check if a valid SL demand zone exists: Fresh (max 1 touch), Strong impulse away, Visible on 1H or 4H, Clean and tight.

OUTPUT — respond ONLY in this exact format, nothing else:
PAIR: $PAIR
BIAS: LONG or NO_SETUP
SCORE: (number 1-10, 10 = strongest setup)
ENTRY: (price)
TP1: (price)
TP2: (price)
SL: (price)
SL_ZONE: (zone range e.g. 77140-77193)
SL_ZONE_STRENGTH: (1-3 words: Fresh/Tested/Weak)
REASON: (one line summary of why this is a long setup or why skipped)"

  REPLY=$(cd ~/tradingview-mcp && timeout 600 $CLAUDE -p "$PROMPT" 2>/dev/null)
  echo "$REPLY" > "$OUTFILE"
  echo "✓ Done: $PAIR"
}

export -f scan_pair
export RESULTS_DIR CLAUDE

# Run all pairs in parallel
for PAIR in "${PAIRS[@]}"; do
  scan_pair "$PAIR" &
done

# Wait for all background jobs
wait
echo "All pairs scanned."

# --- Parse results ---
declare -A SCORES
declare -A DATA

for PAIR in "${PAIRS[@]}"; do
  OUTFILE="$RESULTS_DIR/$PAIR.txt"
  if [ ! -f "$OUTFILE" ]; then continue; fi

  BIAS=$(grep "^BIAS:" "$OUTFILE" | cut -d' ' -f2)
  SCORE=$(grep "^SCORE:" "$OUTFILE" | grep -o '[0-9]*')

  if [ "$BIAS" = "LONG" ] && [ ! -z "$SCORE" ]; then
    SCORES[$PAIR]=$SCORE
    DATA[$PAIR]=$(cat "$OUTFILE")
  fi
done

# Sort by score descending, take top 3
TOP3=$(for PAIR in "${!SCORES[@]}"; do
  echo "${SCORES[$PAIR]} $PAIR"
done | sort -rn | head -3)

if [ -z "$TOP3" ]; then
  ~/oscar_notify.sh "⛔ Oscar Scan Complete — No valid long setups found across all 10 pairs. Market structure not favourable for longs right now."
  rm -rf "$RESULTS_DIR"
  exit 0
fi

# --- Build summary message ---
DATE=$(date "+%b %d, %Y %I:%M %p")
SUMMARY="🔍 *Oscar Scan — $DATE*
━━━━━━━━━━━━━━━━━━━━━
Top Long Setups Found:
"

RANK=1
MEDALS=("🥇" "🥈" "🥉")
TOP_PAIRS=()

while IFS=' ' read -r SCORE PAIR; do
  MEDAL="${MEDALS[$((RANK-1))]}"
  ENTRY=$(grep "^ENTRY:" "$RESULTS_DIR/$PAIR.txt" | cut -d' ' -f2)
  TP1=$(grep "^TP1:" "$RESULTS_DIR/$PAIR.txt" | cut -d' ' -f2)
  SL=$(grep "^SL:" "$RESULTS_DIR/$PAIR.txt" | cut -d' ' -f2)
  REASON=$(grep "^REASON:" "$RESULTS_DIR/$PAIR.txt" | cut -d':' -f2-)
  SUMMARY="$SUMMARY
$MEDAL *$PAIR* — Score $SCORE/10
  Entry: $ENTRY | TP1: $TP1 | SL: $SL
  $REASON"
  TOP_PAIRS+=("$PAIR")
  RANK=$((RANK+1))
done <<< "$TOP3"

SUMMARY="$SUMMARY
━━━━━━━━━━━━━━━━━━━━━
Full signals follow below 👇"

~/oscar_notify.sh "$SUMMARY"
sleep 1

# --- Send full signal for each top pair ---
for PAIR in "${TOP_PAIRS[@]}"; do
  FULL=$(cat "$RESULTS_DIR/$PAIR.txt")
  ~/oscar_notify.sh "📊 *Full Signal — $PAIR*

$FULL"
  sleep 1
done

rm -rf "$RESULTS_DIR"
echo "Scan complete."
