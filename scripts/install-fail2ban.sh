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
touch "${LOG_DIR}/access.log" "${LOG_DIR}/error.log"
chmod 644 "${LOG_DIR}/access.log" "${LOG_DIR}/error.log"

cp "${PROJECT_DIR}/deploy/fail2ban/filter.d/nginx-supervision-login.conf" "$FILTER_DEST"

sed "s|__SUPERVISION_LOG_PATH__|${LOG_DIR}|g" \
  "${PROJECT_DIR}/deploy/fail2ban/jail.d/supervision.local" > "$JAIL_DEST"

# IP de confiance — ne pas bannir (admin SSH + IP publique du serveur pour health checks locaux)
TRUSTED_SSH_IP="${TRUSTED_SSH_IP:-78.196.77.190}"
SERVER_PUBLIC_IP="${SERVER_PUBLIC_IP:-$(curl -sf --max-time 3 ifconfig.me 2>/dev/null || true)}"
IGNORE_IPS="127.0.0.1/8 ::1"
[ -n "$TRUSTED_SSH_IP" ] && IGNORE_IPS="${IGNORE_IPS} ${TRUSTED_SSH_IP}"
[ -n "$SERVER_PUBLIC_IP" ] && IGNORE_IPS="${IGNORE_IPS} ${SERVER_PUBLIC_IP}"
sed -i "s|^ignoreip = 127.0.0.1/8 ::1|ignoreip = ${IGNORE_IPS}|" "$JAIL_DEST"
echo "IP ignorées (ignoreip) : ${IGNORE_IPS}"

systemctl enable fail2ban
systemctl restart fail2ban
sleep 2

echo ""
echo "✅ fail2ban actif"
echo "   Jails : sshd, nginx-supervision-login, nginx-limit-req"
echo "   Logs Nginx : ${LOG_DIR}"
echo ""
echo "Vérification : fail2ban-client status"
fail2ban-client status
