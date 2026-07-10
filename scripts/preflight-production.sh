#!/usr/bin/env bash
set -euo pipefail

# Vérifications avant déploiement production
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

if [ -f .env ]; then
  load_env .env
fi

DOMAIN="${DOMAIN:-supervision-web-01.havetdigital.app}"
EXPECTED_IP="${SERVER_IP:-217.182.43.234}"
ERRORS=0

warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*"; ERRORS=$((ERRORS + 1)); }
ok() { echo "✅ $*"; }

echo "=== Pré-vol production — ${DOMAIN} ==="
echo ""

# Docker
if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  ok "Docker + Compose installés"
else
  fail "Docker ou Compose manquant"
fi

# .env et caractères $
if [ -f .env ]; then
  if grep -E '^[A-Z_]+=.*[^'"'"']\$[a-zA-Z]' .env >/dev/null 2>&1; then
    fail "Le .env contient des \$ non échappés (ex: \$y dans un mot de passe)"
    echo "   → Mettez les valeurs entre guillemets simples : ADMIN_PASSWORD='Mon\$MotDePasse'"
    echo "   → Ou remplacez \$ par \$\$ pour Docker Compose"
  else
    ok "Fichier .env présent"
  fi
else
  fail "Fichier .env manquant (cp .env.example .env)"
fi

# DNS
RESOLVED=$(dig +short "$DOMAIN" 2>/dev/null | tail -1 || true)
if [ "$RESOLVED" = "$EXPECTED_IP" ]; then
  ok "DNS ${DOMAIN} → ${RESOLVED}"
else
  fail "DNS incorrect : ${DOMAIN} → ${RESOLVED:-vide} (attendu ${EXPECTED_IP})"
fi

# Port 80 local
if ss -tln 2>/dev/null | grep -q ':80 '; then
  ok "Port 80 en écoute localement"
else
  warn "Port 80 non actif — démarrez Nginx ou relancez init-letsencrypt"
fi

# Test HTTP local si nginx tourne
if curl -sf --max-time 3 "http://127.0.0.1/" >/dev/null 2>&1; then
  ok "Nginx répond sur http://127.0.0.1/"
else
  warn "Nginx ne répond pas encore sur le port 80 local"
fi

# Firewall UFW
if command -v ufw &>/dev/null; then
  UFW_STATUS=$(ufw status 2>/dev/null || true)
  if echo "$UFW_STATUS" | grep -q "Status: active"; then
    if echo "$UFW_STATUS" | grep -qE '80/tcp.*ALLOW'; then
      ok "UFW : port 80 autorisé"
    else
      fail "UFW actif mais port 80 non autorisé — exécutez : ufw allow 80/tcp && ufw allow 443/tcp"
    fi
    if echo "$UFW_STATUS" | grep -qE '443/tcp.*ALLOW'; then
      ok "UFW : port 443 autorisé"
    else
      fail "UFW actif mais port 443 non autorisé"
    fi
  else
    ok "UFW inactif (pas de blocage local)"
  fi
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ ${ERRORS} problème(s) à corriger avant Let's Encrypt"
  exit 1
fi

echo "✅ Pré-vol OK — vous pouvez lancer : bash scripts/init-letsencrypt.sh"
