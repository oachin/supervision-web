#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

echo "=== Havet Supervision - Déploiement local ==="

if [ ! -f .env ]; then
  echo "Fichier .env manquant. Copie depuis .env.example..."
  cp .env.example .env
  echo ""
  echo "⚠️  Générez les secrets avec: bash scripts/generate-secrets.sh"
  echo "    Puis éditez .env avec vos valeurs."
  exit 1
fi

load_env .env

for var in JWT_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY AGENT_API_KEY_SALT POSTGRES_PASSWORD REDIS_PASSWORD ADMIN_PASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "❌ Variable $var non définie dans .env"
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
echo ""
echo "   Frontend : http://localhost:${FRONTEND_PORT:-3000}"
echo "   API      : http://localhost:${BACKEND_PORT:-4000}/api"
echo "   Admin    : ${ADMIN_EMAIL:-admin@localhost}"
