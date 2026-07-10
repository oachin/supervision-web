#!/usr/bin/env bash
set -euo pipefail

echo "=== Génération des secrets Havet Supervision ==="
echo ""
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "AGENT_API_KEY_SALT=$(openssl rand -hex 16)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=$!' | head -c 32)"
echo "REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=$!' | head -c 32)"
echo ""
echo "Copiez ces valeurs dans votre fichier .env"
echo ""
echo "Important : mettez les mots de passe entre guillemets simples dans .env"
echo "  ADMIN_PASSWORD='votre_mot_de_passe'"
echo "  (obligatoire si le mot de passe contient \$ ou !)"
