#!/bin/bash
set -e
npm run build
host=slayer.marioslab.io
host_dir=/home/badlogic/kreiskybot.mariozechner.at

rsync -avz --include 'build/node_modules/**' --exclude node_modules --exclude .git --exclude data --exclude docker/data ./ $host:$host_dir

if [ "$1" == "server" ]; then
    echo "Publishing client & server"
    ssh -t $host "export KREISKYBOT_CONFIG='$KREISKYBOT_CONFIG' && export KREISKYBOT_OPENAI_KEY=${KREISKYBOT_OPENAI_KEY} && cd $host_dir && ./docker/control.sh stop && ./docker/control.sh start && ./docker/control.sh logs"
else
    echo "Publishing client only"
fi