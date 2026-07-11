#!/usr/bin/env bash
set -euo pipefail

# Installe et configure fail2ban pour SSH + Nginx (logs Docker supervision-web)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${PROJECT_DIR}/logs/nginx"
JAIL_DEST="/etc/fail2ban/jail.d/supervision.local"
FILTER_DEST="/etc/fail2ban/filter.d/nginx-supervision-login.conf"

if [ "$(id -u)" -ne 0 ]; then
  echo "Exécutez avec sudo : sudo bash scripts/install-fail2ban.sh"
  exit 1
fi

echo "=== Installation fail2ban — Havet Supervision ==="

apt-get update -qq
apt-get install -y fail2ban

mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"

cp "${PROJECT_DIR}/deploy/fail2ban/filter.d/nginx-supervision-login.conf" "$FILTER_DEST"

sed "s|__SUPERVISION_LOG_PATH__|${LOG_DIR}|g" \
  "${PROJECT_DIR}/deploy/fail2ban/jail.d/supervision.local" > "$JAIL_DEST"

# IP SSH autorisée dans UFW — ne pas bannir (évite lockout admin)
TRUSTED_SSH_IP="${TRUSTED_SSH_IP:-78.196.77.190}"
if [ -n "$TRUSTED_SSH_IP" ]; then
  if ! grep -q "ignoreip.*${TRUSTED_SSH_IP}" "$JAIL_DEST"; then
    sed -i "s|^ignoreip = 127.0.0.1/8 ::1|ignoreip = 127.0.0.1/8 ::1 ${TRUSTED_SSH_IP}|" "$JAIL_DEST"
  fi
  echo "IP de confiance (ignoreip) : ${TRUSTED_SSH_IP}"
fi

systemctl enable fail2ban
systemctl restart fail2ban

echo ""
echo "✅ fail2ban actif"
echo "   Jails : sshd, nginx-supervision-login, nginx-limit-req"
echo "   Logs Nginx : ${LOG_DIR}"
echo ""
echo "Vérification : fail2ban-client status"
fail2ban-client status
