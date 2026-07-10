#!/usr/bin/env bash
set -euo pipefail

# Havet Supervision Agent — profil __PROFILE__
# API: __API_URL__

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Exécutez en root : wget -qO- \"__INSTALL_URL__\" | sudo bash"
  exit 1
fi

API_URL="__API_URL__"
AGENT_KEY="__AGENT_KEY__"
PROFILE="__PROFILE__"
INSTALL_DIR="/opt/havet-supervision-agent"
SERVICE_NAME="havet-supervision-agent"
DOWNLOAD_URL="${API_URL}/agent/download/linux-amd64?key=${AGENT_KEY}"

echo "=== Havet Supervision Agent (${PROFILE}) ==="

if ! command -v systemctl &>/dev/null; then
  echo "systemctl requis (systemd)"
  exit 1
fi
if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
  echo "curl ou wget requis"
  exit 1
fi

mkdir -p "$INSTALL_DIR"

if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
  echo "→ Arrêt de l'agent existant..."
  systemctl stop "${SERVICE_NAME}"
fi

TMP_AGENT="${INSTALL_DIR}/agent.new.$$"
echo "→ Téléchargement de l'agent..."
if command -v curl &>/dev/null; then
  curl -fsSL "$DOWNLOAD_URL" -o "$TMP_AGENT"
else
  wget -qO "$TMP_AGENT" "$DOWNLOAD_URL"
fi
chmod +x "$TMP_AGENT"
mv -f "$TMP_AGENT" "${INSTALL_DIR}/agent"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Havet Supervision Agent (${PROFILE})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/agent
Environment=SUPERVISION_API_URL=${API_URL}
Environment=SUPERVISION_AGENT_KEY=${AGENT_KEY}
Environment=SUPERVISION_PROFILE=${PROFILE}
Environment=SUPERVISION_INTERVAL=60
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo ""
echo "✅ Agent installé et démarré (profil: ${PROFILE})"
echo "   Status : systemctl status ${SERVICE_NAME}"
echo "   Logs   : journalctl -u ${SERVICE_NAME} -f"
