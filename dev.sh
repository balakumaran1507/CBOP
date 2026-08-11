#!/bin/bash
# CBOP Dev Script — switches to dev mode with hot-reload
# Usage: ./dev.sh
# Changes to any .tsx/.ts file appear at cbop.etherence.com within ~1s automatically.
# To go back to production mode: ./deploy.sh

set -e

echo "🔄 Switching service to dev mode (hot-reload)..."
sudo tee /etc/systemd/system/cbop.service > /dev/null << 'EOF'
[Unit]
Description=CBOP v2 — Internal Business Platform
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=nigga
WorkingDirectory=/home/nigga/CBOP
ExecStart=/usr/bin/npm run dev
Restart=always
RestartSec=5
EnvironmentFile=/home/nigga/CBOP/.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cbop

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl restart cbop

echo "✅ Dev mode active — changes to files auto-reload at https://cbop.etherence.com"
