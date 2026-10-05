#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo 'Run this installer as root on the staging VM.' >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 python3
systemctl enable --now docker
cd /opt/tandem/tandem-app/deploy/staging
chmod 700 .
python3 refresh-runtime.py
docker compose config --quiet
docker compose build
install -m 644 tandem-staging.service /etc/systemd/system/tandem-staging.service
systemctl daemon-reload
systemctl enable --now tandem-staging
systemctl is-active tandem-staging
