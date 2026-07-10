#!/usr/bin/env bash
set -euo pipefail

API_URL="${SUPERVISION_API_URL:-http://localhost:4000/api}"
AGENT_KEY="${SUPERVISION_AGENT_KEY:?SUPERVISION_AGENT_KEY required}"
INTERVAL="${SUPERVISION_INTERVAL:-60}"
INSTALL_DIR="/opt/havet-supervision-agent"
SERVICE_NAME="havet-supervision-agent"

if [[ $EUID -ne 0 ]]; then
  echo "Ce script doit être exécuté en root"
  exit 1
fi

echo "=== Installation Havet Supervision Agent ==="

mkdir -p "$INSTALL_DIR"

if command -v go &>/dev/null; then
  echo "Compilation de l'agent..."
  cd "$(dirname "$0")/.."
  GOOS=linux GOARCH=amd64 go build -o "$INSTALL_DIR/agent" ./agent/
else
  echo "Go non trouvé. Téléchargez le binaire pré-compilé ou installez Go."
  exit 1
fi

cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Havet Supervision Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/agent
Environment=SUPERVISION_API_URL=${API_URL}
Environment=SUPERVISION_AGENT_KEY=${AGENT_KEY}
Environment=SUPERVISION_INTERVAL=${INTERVAL}
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}

echo "Agent installé et démarré."
echo "Status: systemctl status ${SERVICE_NAME}"
