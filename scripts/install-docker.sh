#!/usr/bin/env bash
set -euo pipefail

# Installation Docker Engine + Compose plugin (Ubuntu/Debian)
# Usage: sudo bash scripts/install-docker.sh

if [[ $EUID -ne 0 ]]; then
  echo "Exécutez en root : sudo bash scripts/install-docker.sh"
  exit 1
fi

echo "=== Installation Docker (dépôt officiel) ==="

apt-get update
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-$UBUNTU_CODENAME}")"

if [ -z "$CODENAME" ]; then
  echo "❌ Impossible de détecter la version Ubuntu"
  exit 1
fi

echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

echo ""
echo "✅ Docker installé"
docker --version
docker compose version
