#!/usr/bin/env bash
# Rauchtests gegen eine laufende Installation (nach `docker compose up -d`).
#
#   PCS_URL=https://scanner.example.org ./scripts/deploy-smoke.sh
#   PCS_INSECURE=1 PCS_URL=https://localhost:8443 ./scripts/deploy-smoke.sh   # eigene CA
#
# Prueft die Dinge, die im Deployment schiefgehen koennen: TLS, Routing
# (PWA vs. API), Sicherheits-Header, HTTPS-Cookies, Registrierung/Anmeldung
# und die Referenzbilder. Legt dafuer ein Testkonto an (siehe Ende der Ausgabe).

set -uo pipefail

BASE="${PCS_URL:-https://localhost}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

CURL=(curl -sS -m 20 -b "$JAR" -c "$JAR")
if [ "${PCS_INSECURE:-0}" = "1" ]; then
  CURL+=(-k)
fi

pass=0
fail=0
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail + 1)); }
is() { if [ "$2" = "1" ]; then ok "$1"; else no "$1"; fi; }

HTTP_CODE=""
HTTP_BODY=""

http() { # methode pfad [json]
  local method="$1" path="$2" data="${3:-}" out
  if [ -n "$data" ]; then
    out=$("${CURL[@]}" -X "$method" -H "content-type: application/json" -d "$data" -w $'\n%{http_code}' "$BASE$path")
  else
    out=$("${CURL[@]}" -X "$method" -w $'\n%{http_code}' "$BASE$path")
  fi
  HTTP_CODE="${out##*$'\n'}"
  HTTP_BODY="${out%$'\n'*}"
}

# Wie http, verwirft aber den Rumpf (fuer Binaerantworten wie Bilder)
http_status() {
  HTTP_CODE=$("${CURL[@]}" -X "$1" -o /dev/null -w '%{http_code}' "$BASE$2")
  HTTP_BODY=""
}

echo "Ziel: $BASE"
echo

echo "TLS und Sicherheits-Header"
http GET /
is "Startseite liefert 200 (TLS ok)" "$([ "$HTTP_CODE" = "200" ] && echo 1 || echo 0)"
is "Startseite ist die PWA" "$(printf '%s' "$HTTP_BODY" | grep -q 'Pokémon-Karten-Scanner' && echo 1 || echo 0)"
is "Manifest ist verlinkt" "$(printf '%s' "$HTTP_BODY" | grep -q 'manifest.webmanifest' && echo 1 || echo 0)"
headers=$("${CURL[@]}" -D - -o /dev/null "$BASE/")
is "HSTS-Header gesetzt" "$(printf '%s' "$headers" | grep -qi '^strict-transport-security:' && echo 1 || echo 0)"
is "X-Content-Type-Options gesetzt" "$(printf '%s' "$headers" | grep -qi '^x-content-type-options: *nosniff' && echo 1 || echo 0)"
is "Content-Security-Policy gesetzt" "$(printf '%s' "$headers" | grep -qi '^content-security-policy:' && echo 1 || echo 0)"
is "CSP verbietet object-src/frame-ancestors" \
  "$(printf '%s' "$headers" | grep -qi "^content-security-policy:.*object-src 'none'" && \
     printf '%s' "$headers" | grep -qi "^content-security-policy:.*frame-ancestors 'none'" && echo 1 || echo 0)"
is "Permissions-Policy erlaubt nur eigene Kamera" \
  "$(printf '%s' "$headers" | grep -qi '^permissions-policy:.*camera=(self)' && echo 1 || echo 0)"
is "Kein Server-Header" "$(printf '%s' "$headers" | grep -qi '^server:' && echo 0 || echo 1)"

echo
echo "PWA-Dateien"
http GET /manifest.webmanifest
is "manifest.webmanifest 200" "$([ "$HTTP_CODE" = "200" ] && echo 1 || echo 0)"
http GET /sw.js
is "Service Worker 200" "$([ "$HTTP_CODE" = "200" ] && echo 1 || echo 0)"

echo
echo "Routing (PWA vs. API)"
http GET /verlauf
is "SPA-Route /verlauf liefert die App (200)" "$([ "$HTTP_CODE" = "200" ] && echo 1 || echo 0)"
is "SPA-Fallback liefert index.html" "$(printf '%s' "$HTTP_BODY" | grep -q 'Pokémon-Karten-Scanner' && echo 1 || echo 0)"
http GET /health
is "API /health ueber den Proxy 200" "$([ "$HTTP_CODE" = "200" ] && echo 1 || echo 0)"
is "Antwort ist JSON der API" "$(printf '%s' "$HTTP_BODY" | grep -q '"status"' && echo 1 || echo 0)"
http GET /cards/search?q=Glurak
is "Kartensuche 200" "$([ "$HTTP_CODE" = "200" ] && echo 1 || echo 0)"
is "Suche findet base1-4 (Glurak)" "$(printf '%s' "$HTTP_BODY" | grep -q 'base1-4' && echo 1 || echo 0)"
http_status GET /cards/base1-4/image
is "Referenzbild 200" "$([ "$HTTP_CODE" = "200" ] && echo 1 || echo 0)"
http_status GET /cards/gibt-es-nicht/image
is "Unbekannte Karte liefert 404 (keine SPA)" "$([ "$HTTP_CODE" = "404" ] && echo 1 || echo 0)"

echo
echo "Konten und Cookies"
EMAIL="smoke-$(date +%s)@example.invalid"
# Zufaelliges Passwort: bleibt das Testkonto auf dem Server liegen, ist es nutzlos.
PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
reg_headers=$("${CURL[@]}" -D - -o /dev/null -X POST -H "content-type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"Smoke\"}" \
  "$BASE/auth/register")
is "Registrierung 201" "$(printf '%s' "$reg_headers" | grep -qi '^HTTP/.* 201' && echo 1 || echo 0)"
# Im Betrieb traegt das Cookie das "__Host-"-Praefix (nur an die sichere Herkunft).
is "Sitzungscookie HttpOnly" "$(printf '%s' "$reg_headers" | grep -qiE '^set-cookie: (__Host-)?pcs_session=[^;]*;.*HttpOnly' && echo 1 || echo 0)"
is "Sitzungscookie Secure (HTTPS)" "$(printf '%s' "$reg_headers" | grep -qiE '^set-cookie: (__Host-)?pcs_session=[^;]*;.*Secure' && echo 1 || echo 0)"
is "Sitzungscookie SameSite=Lax" "$(printf '%s' "$reg_headers" | grep -qiE '^set-cookie: (__Host-)?pcs_session=[^;]*;.*SameSite=Lax' && echo 1 || echo 0)"
is "Sitzungscookie hat Path=/" "$(printf '%s' "$reg_headers" | grep -qiE '^set-cookie: (__Host-)?pcs_session=[^;]*;.*Path=/' && echo 1 || echo 0)"
auth_headers=$("${CURL[@]}" -D - -o /dev/null "$BASE/auth/me")
is "Auth-Antworten werden nicht gecacht" "$(printf '%s' "$auth_headers" | grep -qi '^cache-control: *no-store' && echo 1 || echo 0)"
http GET /auth/me
is "/auth/me ist angemeldet (200)" "$([ "$HTTP_CODE" = "200" ] && echo 1 || echo 0)"
is "Anonymes Cookie wird gesetzt" "$(grep -q 'pcs_anon' "$JAR" && echo 1 || echo 0)"
http GET /collection
is "Sammlung 200" "$([ "$HTTP_CODE" = "200" ] && echo 1 || echo 0)"
http POST /auth/logout
is "Abmelden 204" "$([ "$HTTP_CODE" = "204" ] && echo 1 || echo 0)"
http GET /auth/me
is "Nach dem Abmelden abgemeldet (user null)" "$(printf '%s' "$HTTP_BODY" | grep -q '"user":null' && echo 1 || echo 0)"

echo
echo "Ergebnis: $pass bestanden, $fail fehlgeschlagen"
if [ "$fail" -gt 0 ]; then
  echo
  echo "Hinweise: 'docker compose --env-file .env.production logs proxy api' pruefen."
fi
echo
echo "Testkonto angelegt: $EMAIL"
echo "Entfernen (auf dem Server im Projektverzeichnis):"
echo "  docker compose --env-file .env.production exec -T db \\"
echo "    sh -c \"psql -U \\\$POSTGRES_USER -d \\\$POSTGRES_DB -c \\\"delete from users where email='$EMAIL';\\\"\""

[ "$fail" -eq 0 ]
