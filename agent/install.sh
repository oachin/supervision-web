#!/usr/bin/env bash
set -euo pipefail

API_URL="${SUPERVISION_API_URL:?SUPERVISION_API_URL required}"
AGENT_KEY="${SUPERVISION_AGENT_KEY:?SUPERVISION_AGENT_KEY required}"
PROFILE="${SUPERVISION_PROFILE:-linux}"
INTERVAL="${SUPERVISION_INTERVAL:-60}"
INSTALL_DIR="/opt/havet-supervision-agent"
SERVICE_NAME="havet-supervision-agent"
DOWNLOAD_URL="${API_URL%/}/agent/download/linux-amd64?key=${AGENT_KEY}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Exécutez en root"
  exit 1
fi

echo "=== Havet Supervision Agent (${PROFILE}) ==="
mkdir -p "$INSTALL_DIR"

if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
  systemctl stop "${SERVICE_NAME}"
fi

TMP_AGENT="${INSTALL_DIR}/agent.new.$$"
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
Environment=SUPERVISION_INTERVAL=${INTERVAL}
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
echo "✅ Agent installé"
