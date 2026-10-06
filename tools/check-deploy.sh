#!/usr/bin/env bash
# Проверка живого деплоя Панель 36 без логов и доступа к хосту.
# Запуск: ./tools/check-deploy.sh [baseURL]   (по умолчанию http://localhost:8080)
set -u

BASE="${1:-http://localhost:8080}"
fail=0
ok()   { printf '  ✅ %s\n' "$1"; }
bad()  { printf '  ❌ %s\n' "$1"; fail=1; }
hdr() { curl -s -m 5 -D - -o /dev/null "${BASE}${1:-}" 2>/dev/null; }

echo "Проверка деплоя: $BASE"

# 1) Живой сайт
code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$BASE/")
[ "$code" = 200 ] && ok "главная отвечает (200)" || { bad "главная: $code вместо 200 — контейнер не запущен?"; }

# 2) Заголовки безопасности (главный признак свежего nginx-конфига)
h=$(hdr GET /)
case "$h" in
  *Content-Security-Policy:*frame-ancestors*) ok "CSP заголовком, включая frame-ancestors" ;;
  *Content-Security-Policy:*) bad "CSP есть, но без frame-ancestors — частично старый конфиг" ;;
  *) bad "НЕТ CSP-заголовка — контейнер собран из старого Dockerfile. Нужен: git pull && docker compose up -d --build" ;;
esac
echo "$h" | grep -qi '^X-Content-Type-Options: *nosniff' && ok "X-Content-Type-Options: nosniff" || bad "нет nosniff"
echo "$h" | grep -qi '^Referrer-Policy: *no-referrer' && ok "Referrer-Policy: no-referrer" || bad "нет Referrer-Policy"

# 3) SPA fallback (deep links)
for p in /app /app/editor /demo/project; do
  c=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$BASE$p")
  [ "$c" = 200 ] && ok "deep link $p → 200" || bad "deep link $p → $c"
done

# 4) PWA и статика
for p in /manifest.webmanifest /favicon.ico /offline.html /sw.js; do
  c=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$BASE$p")
  [ "$c" = 200 ] && ok "$p → 200" || bad "$p → $c"
done
model=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$BASE/models/city9-mcb-2p.glb")
[ "$model" = 200 ] && ok "3D-модель → 200" || bad "3D-модель → $model"

# 5) Кэш-политика статики
ah=$(hdr "$(curl -s -m 5 "$BASE/" | grep -oE '/assets/index-[^"]+\.js' | head -1)")
echo "$ah" | grep -qi 'immutable' && ok "ассеты с immutable-кэшем" || bad "у ассетов нет immutable-кэша"
sh=$(hdr /sw.js)
echo "$sh" | grep -qi '^Cache-Control: *no-cache' && ok "sw.js без кэша" || bad "sw.js кэшируется"

# 6) CSP meta в HTML (контентная защита сборки)
curl -s -m 5 "$BASE/" | grep -q 'http-equiv="Content-Security-Policy"' && ok "CSP meta в HTML" || bad "нет CSP meta в HTML"

echo
if [ "$fail" = 0 ]; then
  echo "ИТОГ: всё зелёное — деплой актуален."
else
  echo "ИТОГ: есть проблемы (❌ выше). Если это заголовки — пересоберите: git pull && docker compose up -d --build"
fi
exit $fail
