#!/bin/bash
source ~/.oscar_telegram.env

MESSAGE="$1"
MAX=4000

# Sanitize message for Telegram Markdown v1:
# Escape backticks and remove unmatched bold/italic markers that break parsing.
# We keep * for bold and ` for code only if properly paired — safest: strip parse_mode
# and send as plain text with a light clean-up.
sanitize() {
  local msg="$1"
  # Strip all markdown special characters that break Telegram
  msg=$(echo "$msg" | sed 's/```[^`]*```/---/g')
  msg=$(echo "$msg" | sed "s/\`//g")
  msg=$(echo "$msg" | sed 's/\*//g')
  msg=$(echo "$msg" | sed 's/_//g')
  msg=$(echo "$msg" | sed 's/\[//g')
  msg=$(echo "$msg" | sed 's/\]//g')
  msg=$(echo "$msg" | sed 's/(http[^)]*)//g')
  echo "$msg"
}

send_chunk() {
  local text
  text=$(sanitize "$1")
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    --data-urlencode "text=${text}" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    
}

if [ ${#MESSAGE} -le $MAX ]; then
  send_chunk "$MESSAGE"
else
  while [ ${#MESSAGE} -gt 0 ]; do
    CHUNK="${MESSAGE:0:$MAX}"
    MESSAGE="${MESSAGE:$MAX}"
    send_chunk "$CHUNK"
    sleep 0.5
  done
fi
