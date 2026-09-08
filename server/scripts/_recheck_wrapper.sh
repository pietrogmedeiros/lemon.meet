#!/usr/bin/env bash
LOG="$HOME/Downloads/lemon.meet/server/incident-recheck.log"
sleep 18000   # 5 horas
cd "$HOME/Downloads/lemon.meet/server" || exit 1
OUT="$(node scripts/incident-recheck.mjs 2>&1)"
printf '%s\n%s\n\n' "$(date)" "$OUT" >> "$LOG"
if printf '%s' "$OUT" | grep -q 'PASS'; then
  osascript -e 'display notification "Bots OK, sem regressão desde o deploy." with title "Lemon ✅ Recheck 5h"' 2>/dev/null
else
  osascript -e 'display notification "ATENÇÃO: possível regressão nos bots — ver incident-recheck.log" with title "Lemon ⚠️ Recheck 5h"' 2>/dev/null
fi
printf '%s\n' "$OUT"
