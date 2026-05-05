#!/usr/bin/env bash
# Verify WSL2 → Chrome CDP connection. If unreachable, prints fix steps.

HOST="172.31.0.1"
PORT="9222"

echo "Checking CDP at $HOST:$PORT..."

result=$(curl -s --max-time 5 "http://$HOST:$PORT/json/version" 2>&1)
code=$?

if [ $code -eq 0 ]; then
  echo "Connected:"
  echo "$result" | grep -E '"Browser"|"Protocol-Version"'
  exit 0
fi

echo "Failed (curl exit $code). Running diagnostics..."

# Check basic connectivity
if ping -c 1 -W 1 "$HOST" &>/dev/null; then
  echo "  Ping: OK — portproxy may be missing or stale."
  echo ""
  echo "  Fix (admin PowerShell on Windows):"
  echo "    netsh interface portproxy delete v4tov4 listenport=9222 listenaddress=$HOST"
  echo "    netsh interface portproxy add v4tov4 listenaddress=$HOST listenport=9222 connectaddress=127.0.0.1 connectport=9222"
else
  echo "  Ping: FAIL — Windows Firewall is blocking WSL2."
  echo ""
  echo "  Fix (admin PowerShell on Windows):"
  echo "    netsh advfirewall firewall add rule name=\"WSL2 Allow All\" dir=in action=allow remoteip=172.16.0.0/12 protocol=any"
  echo "    netsh interface portproxy add v4tov4 listenaddress=$HOST listenport=9222 connectaddress=127.0.0.1 connectport=9222"
fi

echo ""
echo "  Chrome launch command (Windows):"
echo "    & \"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --remote-debugging-port=9222 --user-data-dir=\"C:\\ChromeDebug\" --app=https://www.tradingview.com"
exit 1
