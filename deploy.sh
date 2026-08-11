#!/bin/bash
# CBOP Deploy Script — switches to production mode, builds, and restarts
# Usage: ./deploy.sh
# After deploy, cbop.etherence.com serves the optimized production build.
# To go back to dev mode (hot-reload): ./dev.sh

set -e

echo "🔨 Building CBOP..."
npm run build

echo "🔄 Switching service to production mode..."
sudo tee /etc/systemd/system/cbop.service > /dev/null << 'EOF'
[Unit]
Description=CBOP v2 — Internal Business Platform
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=nigga
WorkingDirectory=/home/nigga/CBOP
ExecStart=/usr/bin/npm start
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

echo "✅ CBOP is live at https://cbop.etherence.com"
