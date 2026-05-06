#!/bin/bash
echo "=== Oscar Startup $(date) ==="

# Kill any existing instances
pkill -f "oscar_listen.sh" 2>/dev/null
sleep 1

# ── 1. Start virtual display (Xvfb) if not running ──────────────────────────
if ! pgrep -x Xvfb > /dev/null; then
  echo "🖥️  Starting virtual display..."
  Xvfb :99 -screen 0 1280x1024x24 &
  sleep 2
  echo "✅ Virtual display started"
else
  echo "✅ Virtual display already running"
fi
export DISPLAY=:99

# ── 2. Start Chrome headlessly if not running ────────────────────────────────
if ! pgrep -f "google-chrome" > /dev/null; then
  echo "🌐 Starting Chrome with TradingView..."
  pkill -f tradingview 2>/dev/null
  sleep 1
  DISPLAY=:99 google-chrome \
    --no-sandbox \
    --disable-gpu \
    --enable-unsafe-swiftshader \
    --remote-debugging-port=9222 \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir=/home/cts/.chrome-oscar \
    "https://www.tradingview.com/chart/?symbol=BYBIT:BTCUSDT" &
  echo "⏳ Waiting for TradingView to load (30s)..."
  sleep 30
  TABS=$(curl -s http://localhost:9222/json/list | python3 -c "import json,sys; tabs=json.load(sys.stdin); print(len([t for t in tabs if 'tradingview' in t.get('url','')]))" 2>/dev/null)
  if [ "$TABS" -eq 0 ] 2>/dev/null; then
    curl -s -X PUT "http://localhost:9222/json/new?https://www.tradingview.com/chart/?symbol=BYBIT:BTCUSDT" > /dev/null
    sleep 15
  fi
  echo "✅ Chrome started with TradingView"
else
  echo "✅ Chrome already running"
fi

# ── 3. Verify CDP ─────────────────────────────────────────────────────────────
CDP=$(curl -s http://localhost:9222/json/version 2>/dev/null)
if [ -z "$CDP" ]; then
  echo "❌ CDP not reachable — Chrome failed to start"
  exit 1
fi
echo "✅ CDP connected: $(echo $CDP | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("Browser","unknown"))' 2>/dev/null)"

# ── 4. Verify rules.json ──────────────────────────────────────────────────────
if [ ! -f ~/tradingview-mcp/rules.json ]; then
  echo "❌ rules.json missing"
  exit 1
fi
MIN_RR=$(python3 -c "import json; print(json.load(open('/home/cts/tradingview-mcp/rules.json'))['risk_rules']['min_rr_ratio'])" 2>/dev/null)
echo "✅ rules.json loaded — min R:R: $MIN_RR"

# ── 5. Start MCP server if not running ───────────────────────────────────────
MCP_PID=$(pgrep -f "node src/server.js" | head -1)
if [ -z "$MCP_PID" ]; then
  echo "⚠️  MCP server not running — starting it..."
  cd ~/tradingview-mcp && npm start &
  sleep 3
  echo "✅ MCP server started"
else
  echo "✅ MCP server running (PID $MCP_PID)"
fi

# ── 6. Start Oscar listener ───────────────────────────────────────────────────
echo "🚀 Starting Oscar listener..."
~/oscar_listen.sh &
sleep 1
PID=$(pgrep -f "oscar_listen.sh" | head -1)
echo "✅ Oscar listening (PID $PID)"
echo "=== Oscar is ready ==="
