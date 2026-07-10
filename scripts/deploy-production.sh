#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

cd "$PROJECT_DIR"

echo "=== Havet Supervision — Déploiement production ==="
echo ""

if [ ! -f .env ]; then
  echo "Fichier .env manquant. Copie depuis .env.example..."
  cp .env.example .env
  echo ""
  echo "⚠️  Générez les secrets : bash scripts/generate-secrets.sh"
  echo "    Puis éditez .env (ADMIN_PASSWORD, CERTBOT_EMAIL, etc.)"
  exit 1
fi

set -a
source .env
set +a

DOMAIN="${DOMAIN:-supervision-web-01.havetdigital.app}"

for var in JWT_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY AGENT_API_KEY_SALT POSTGRES_PASSWORD REDIS_PASSWORD ADMIN_PASSWORD DOMAIN CERTBOT_EMAIL; do
  if [ -z "${!var:-}" ]; then
    echo "❌ Variable $var non définie dans .env"
    exit 1
  fi
done

if ! command -v docker &>/dev/null; then
  echo "❌ Docker requis"
  exit 1
fi

echo "Domaine  : https://${DOMAIN}"
echo "Serveur  : 217.182.43.234"
echo ""

echo "→ Construction des images..."
$COMPOSE build

NEED_CERT=true
if docker volume ls -q | grep -q certbot_conf; then
  VOL=$(docker volume ls -q | grep certbot_conf | head -1)
  if docker run --rm -v "${VOL}:/etc/letsencrypt" alpine test -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" 2>/dev/null; then
    NEED_CERT=false
  fi
fi

if [ "$NEED_CERT" = true ]; then
  echo "→ Obtention du certificat Let's Encrypt..."
  bash scripts/init-letsencrypt.sh
else
  echo "✅ Certificat SSL existant"
  echo "→ Démarrage des services..."
  NGINX_TEMPLATE=/etc/nginx/templates/nginx.conf.template $COMPOSE up -d
fi

echo ""
echo "✅ Havet Supervision déployé !"
echo ""
echo "   URL   : https://${DOMAIN}"
echo "   API   : https://${DOMAIN}/api"
echo "   Admin : ${ADMIN_EMAIL}"
echo ""
echo "   Agent : SUPERVISION_API_URL=https://${DOMAIN}/api SUPERVISION_AGENT_KEY=sv_... bash agent/install.sh"
echo ""
echo "Commandes :"
echo "   Logs    : $COMPOSE logs -f"
echo "   Status  : $COMPOSE ps"
echo "   Màj     : git pull && $COMPOSE build && $COMPOSE up -d"
