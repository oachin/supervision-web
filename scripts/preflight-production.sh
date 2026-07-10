#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

if [ -f .env ]; then load_env .env; fi
if [ -f .env.secrets ]; then load_env .env.secrets; fi

DOMAIN="${DOMAIN:-supervision-web-01.havetdigital.app}"
EXPECTED_IP="${SERVER_IP:-217.182.43.234}"
ERRORS=0

warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*"; ERRORS=$((ERRORS + 1)); }
ok() { echo "✅ $*"; }

echo "=== Pré-vol production — ${DOMAIN} ==="
echo ""

if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  ok "Docker + Compose installés"
else
  fail "Docker ou Compose manquant"
fi

if [ -f .env ] && [ -f .env.secrets ]; then
  ok "Fichiers .env et .env.secrets présents"
else
  fail "Créez .env et .env.secrets (voir .env.example et .env.secrets.example)"
fi

RESOLVED=$(dig +short "$DOMAIN" 2>/dev/null | tail -1 || true)
if [ "$RESOLVED" = "$EXPECTED_IP" ]; then
  ok "DNS ${DOMAIN} → ${RESOLVED}"
else
  fail "DNS incorrect : ${DOMAIN} → ${RESOLVED:-vide} (attendu ${EXPECTED_IP})"
fi

if ss -tln 2>/dev/null | grep -q ':80 '; then
  ok "Port 80 en écoute localement"
else
  warn "Port 80 non actif"
fi

if curl -sf --max-time 3 "http://127.0.0.1/" >/dev/null 2>&1; then
  ok "Nginx répond sur http://127.0.0.1/"
else
  fail "Nginx ne répond pas sur le port 80 local — vérifiez : docker compose logs nginx"
fi

if command -v ufw &>/dev/null; then
  UFW_STATUS=$(ufw status 2>/dev/null || true)
  if echo "$UFW_STATUS" | grep -q "Status: active"; then
    echo "$UFW_STATUS" | grep -qE '80/tcp.*ALLOW' && ok "UFW : port 80 autorisé" || fail "UFW : port 80 non autorisé"
    echo "$UFW_STATUS" | grep -qE '443/tcp.*ALLOW|443.*ALLOW' && ok "UFW : port 443 autorisé" || fail "UFW : port 443 non autorisé"
  else
    ok "UFW inactif"
  fi
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ ${ERRORS} problème(s) à corriger"
  exit 1
fi

echo "✅ Pré-vol OK — lancez : bash scripts/init-letsencrypt.sh"
