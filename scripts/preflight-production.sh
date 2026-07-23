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
ERRORS=0

warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*"; ERRORS=$((ERRORS + 1)); }
ok() { echo "✅ $*"; }

detect_public_ip() {
  curl -4 -sf --max-time 3 https://ifconfig.me/ip 2>/dev/null \
    || curl -4 -sf --max-time 3 https://api.ipify.org 2>/dev/null \
    || true
}

if [ -n "${SERVER_IP:-}" ]; then
  EXPECTED_IP="$SERVER_IP"
else
  EXPECTED_IP="$(detect_public_ip)"
fi

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

if [ -z "${EXPECTED_IP}" ]; then
  fail "SERVER_IP non défini dans .env et IP publique indétectable"
else
  RESOLVED=$(dig +short "$DOMAIN" A 2>/dev/null | grep -E '^[0-9.]+$' | tail -1 || true)
  if [ "$RESOLVED" = "$EXPECTED_IP" ]; then
    ok "DNS ${DOMAIN} → ${RESOLVED}"
  else
    fail "DNS incorrect : ${DOMAIN} → ${RESOLVED:-vide} (attendu ${EXPECTED_IP})"
    echo "   → Mettez à jour le DNS A, ou SERVER_IP dans .env si l’IP du serveur a changé"
  fi
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
    # ufw status : "80" ou "80/tcp" selon version / règles
    echo "$UFW_STATUS" | grep -qE '(^|[[:space:]])80(/tcp)?[[:space:]].*ALLOW' \
      && ok "UFW : port 80 autorisé" \
      || fail "UFW : port 80 non autorisé — ufw allow 80/tcp"
    echo "$UFW_STATUS" | grep -qE '(^|[[:space:]])443(/tcp)?[[:space:]].*ALLOW' \
      && ok "UFW : port 443 autorisé" \
      || fail "UFW : port 443 non autorisé — ufw allow 443/tcp"
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
