#!/usr/bin/env sh
set -eu

SERVICE_NAME="${SERVICE_NAME:-cpa-key-hub}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

$SUDO systemctl stop "$SERVICE_NAME"
$SUDO systemctl status "$SERVICE_NAME" --no-pager || true
