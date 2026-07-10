#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

echo "=== Havet Supervision - Déploiement local ==="

if [ ! -f .env ]; then
  cp .env.example .env
fi
if [ ! -f .env.secrets ]; then
  cp .env.secrets.example .env.secrets
  echo "⚠️  Remplissez .env.secrets : bash scripts/generate-secrets.sh"
  exit 1
fi

load_env .env
load_env .env.secrets

for var in JWT_SECRET POSTGRES_PASSWORD REDIS_PASSWORD ADMIN_PASSWORD DATABASE_URL REDIS_URL; do
  if [ -z "${!var:-}" ]; then
    echo "❌ Variable $var non définie dans .env.secrets"
    exit 1
  fi
done

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"

echo "Construction des images Docker..."
$COMPOSE build

echo "Démarrage des services..."
$COMPOSE up -d

echo ""
echo "✅ Havet Supervision déployé (local) !"
echo "   Frontend : http://localhost:${FRONTEND_PORT:-3000}"
echo "   API      : http://localhost:${BACKEND_PORT:-4000}/api"
