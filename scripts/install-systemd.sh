#!/usr/bin/env sh
set -eu

SERVICE_NAME="${SERVICE_NAME:-cpa-key-hub}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="${APP_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
RUN_AS_USER="${RUN_AS_USER:-$(id -un)}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$APP_DIR/.env.example" ]; then
    cp "$APP_DIR/.env.example" "$ENV_FILE"
  fi
  echo "Created $ENV_FILE. Edit it before installing the systemd service."
  exit 1
fi

if [ -z "${NODE_BIN:-}" ]; then
  NODE_BIN="$(command -v node || true)"
fi

if [ -z "$NODE_BIN" ]; then
  echo "node not found. Install Node.js or set NODE_BIN=/absolute/path/to/node."
  exit 1
fi

UNIT_PATH="/etc/systemd/system/$SERVICE_NAME.service"

$SUDO tee "$UNIT_PATH" >/dev/null <<EOF
[Unit]
Description=CPA Key Hub
After=network.target

[Service]
Type=simple
User=$RUN_AS_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now "$SERVICE_NAME"
$SUDO systemctl status "$SERVICE_NAME" --no-pager
