#!/bin/bash
set -e
npm run build
host=slayer.marioslab.io
host_dir=/home/badlogic/kreiskybot.mariozechner.at

# Create .env file locally in docker directory
cat > docker/.env << 'EOF'
KREISKYBOT_CONFIG=$KREISKYBOT_CONFIG
KREISKYBOT_OPENAI_KEY=$KREISKYBOT_OPENAI_KEY
EOF

rsync -avz --include 'build/node_modules/**' --exclude node_modules --exclude .git --exclude data --exclude docker/data ./ $host:$host_dir

if [ "$1" == "server" ]; then
    echo "Publishing client & server"
    ssh -t $host "cd $host_dir && ./docker/control.sh stop && ./docker/control.sh start && ./docker/control.sh logs"
else
    echo "Publishing client only"
fi