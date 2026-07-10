#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

cd "$PROJECT_DIR"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

load_env .env

DOMAIN="${DOMAIN:?DOMAIN required}"
EMAIL="${CERTBOT_EMAIL:?CERTBOT_EMAIL required}"
staging="${1:-0}"

if [ "$staging" != "0" ]; then
  staging_arg="--staging"
  echo "⚠️  Mode staging Let's Encrypt (certificats de test)"
else
  staging_arg=""
fi

echo "=== Initialisation Let's Encrypt pour ${DOMAIN} ==="

if docker volume ls -q | grep -q certbot_conf; then
  VOL=$(docker volume ls -q | grep certbot_conf | head -1)
  if docker run --rm -v "${VOL}:/etc/letsencrypt" alpine test -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" 2>/dev/null; then
    echo "✅ Certificat déjà présent pour ${DOMAIN}"
    exit 0
  fi
fi

echo "→ Construction des images..."
$COMPOSE build

echo "→ Démarrage PostgreSQL, Redis, Backend, Frontend..."
$COMPOSE up -d postgres redis backend frontend

echo "→ Attente des services..."
sleep 15

echo "→ Démarrage Nginx (HTTP uniquement, validation ACME)..."
NGINX_TEMPLATE=/etc/nginx/templates/nginx-init.conf.template $COMPOSE up -d --force-recreate nginx

echo "→ Attente de Nginx..."
sleep 5

if ! docker compose -f docker-compose.yml -f docker-compose.prod.yml ps nginx 2>/dev/null | grep -q "Up"; then
  echo "❌ Le conteneur Nginx n'est pas démarré. Logs :"
  $COMPOSE logs --tail 30 nginx
  exit 1
fi

if ! curl -sf --max-time 5 "http://127.0.0.1/" >/dev/null; then
  echo "❌ Nginx ne répond pas sur le port 80 local. Logs :"
  $COMPOSE logs --tail 30 nginx
  exit 1
fi

echo "→ Vérification préalable (DNS, firewall, .env)..."
bash scripts/preflight-production.sh || {
  echo ""
  echo "Corrigez les problèmes ci-dessus puis relancez : bash scripts/init-letsencrypt.sh"
  exit 1
}

echo "→ Demande du certificat Let's Encrypt..."
$COMPOSE run --rm --entrypoint certbot certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  $staging_arg \
  -d "$DOMAIN"

echo "→ Activation HTTPS..."
NGINX_TEMPLATE=/etc/nginx/templates/nginx.conf.template $COMPOSE up -d --force-recreate nginx certbot

echo ""
echo "✅ Certificat Let's Encrypt obtenu pour https://${DOMAIN}"
