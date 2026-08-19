#!/bin/bash
# Smoke test da imagem nexo:test — roda inteiro numa sessao so do WSL
set -u
cd /mnt/g/amazon-fba-platform
docker rm -f nexo-test >/dev/null 2>&1
docker run -d --name nexo-test --env-file .env.local -e DATA_DIR=/tmp/nexo-data -p 3333:3000 nexo:test >/dev/null || { echo "RUN FALHOU"; exit 1; }
sleep 5
echo "== status =="
docker ps -a --filter name=nexo-test --format '{{.Status}}'
IP=$(docker inspect nexo-test --format '{{ .NetworkSettings.Networks.bridge.IPAddress }}')
echo "== ip: $IP =="
echo "health via IP:        $(curl -s -o /dev/null -w '%{http_code}' -m 8 http://$IP:3000/api/health)"
echo "health via localhost: $(curl -s -o /dev/null -w '%{http_code}' -m 8 http://localhost:3333/api/health)"
echo "== corpo do health =="
curl -s -m 8 "http://$IP:3000/api/health"
echo
docker rm -f nexo-test >/dev/null 2>&1
