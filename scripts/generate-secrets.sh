#!/usr/bin/env bash
set -euo pipefail

echo "=== Génération des secrets Havet Supervision ==="
echo ""
echo "Copiez dans .env.secrets :"
echo ""
PG_PASS=$(openssl rand -base64 24 | tr -d '/+=$!' | head -c 32)
REDIS_PASS=$(openssl rand -base64 24 | tr -d '/+=$!' | head -c 32)
echo "POSTGRES_PASSWORD=${PG_PASS}"
echo "REDIS_PASSWORD=${REDIS_PASS}"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "AGENT_API_KEY_SALT=$(openssl rand -hex 16)"
echo "ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=$!' | head -c 24)"
echo ""
echo "DATABASE_URL=postgresql://supervision:${PG_PASS}@postgres:5432/supervision"
echo "REDIS_URL=redis://:${REDIS_PASS}@redis:6379"
echo ""
echo "Fichiers :"
echo "  .env         → DOMAIN, CERTBOT_EMAIL, CORS_ORIGIN (cp .env.example .env)"
echo "  .env.secrets → mots de passe ci-dessus (cp .env.secrets.example .env.secrets)"
