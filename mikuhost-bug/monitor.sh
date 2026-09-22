#!/bin/bash
LOG=/root/.pm2/logs/mikuhost-dv-out.log
OUT=/root/mikuhost-bug/monitor_global.log
START_LINE=$(wc -l < "$LOG")
echo "MONITOR START $(date '+%Y-%m-%d %H:%M:%S') baseline_line=$START_LINE" > "$OUT"
for i in $(seq 1 30); do
  sleep 60
  NEW=$(tail -n +$((START_LINE+1)) "$LOG")
  CLOSES=$(echo "$NEW" | grep -c "Connection closed" || true)
  RECONN=$(echo "$NEW" | grep -c "Reconnecting" || true)
  CONN=$(echo "$NEW" | grep -c "Connected. Type:" || true)
  RESTORED=$(echo "$NEW" | grep -c "dipulihkan" || true)
  PING=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:2276/ping)
  echo "$(date '+%H:%M:%S') ping=$PING close=$CLOSES reconnect=$RECONN connected=$CONN restored=$RESTORED" >> "$OUT"
done
echo "MONITOR DONE $(date '+%Y-%m-%d %H:%M:%S')" >> "$OUT"
