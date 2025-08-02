#!/bin/bash
set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     🚀 OurSaas Production Deployment                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
echo "📊 Server RAM: ${TOTAL_RAM}MB"

if [ "$TOTAL_RAM" -lt 2048 ]; then
    echo "⚠️  Low memory detected (${TOTAL_RAM}MB). Checking swap..."
    SWAP_SIZE=$(free -m | awk '/^Swap:/{print $2}')
    if [ "$SWAP_SIZE" -lt 1024 ]; then
        echo "📦 Creating 2GB swap file for build process..."
        if [ ! -f /swapfile ]; then
            sudo fallocate -l 2G /swapfile
            sudo chmod 600 /swapfile
            sudo mkswap /swapfile
            sudo swapon /swapfile
            echo "   ✅ Swap enabled (2GB)"
        else
            if ! swapon --show | grep -q "/swapfile"; then
                sudo swapon /swapfile
                echo "   ✅ Existing swap file activated"
            else
                echo "   ✅ Swap already active"
            fi
        fi
    else
        echo "   ✅ Sufficient swap available (${SWAP_SIZE}MB)"
    fi
fi

echo ""
echo "📦 Code already synced from GitHub Actions — skipping git pull."

echo ""
echo "📦 Installing dependencies..."
npm install --production=false

echo ""
echo "🔧 Building application..."
export NODE_OPTIONS="--max-old-space-size=1536"
npm run build

echo ""
echo "🗄️  Syncing database schema..."
npm run db:push --force
echo "   ✅ Database schema synced"

echo ""
echo "🚀 Restarting application with PM2..."
if pm2 describe oursaas > /dev/null 2>&1; then
    pm2 restart oursaas
    echo "   ✅ PM2 process restarted"
else
    pm2 start ecosystem.config.cjs
    echo "   ✅ PM2 process started"
fi

pm2 save

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║     ✅ Deployment completed successfully!                   ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Useful commands:"
echo "  pm2 logs oursaas    — View application logs"
echo "  pm2 status           — Check process status"
echo "  pm2 restart oursaas — Restart application"
echo ""

exit 0
