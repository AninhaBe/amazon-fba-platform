#!/bin/bash
export PATH=/root/.fly/bin:$PATH
for D in nexoaihub.com.br www.nexoaihub.com.br; do
  echo "===== $D ====="
  fly certs add "$D" --app nexo 2>&1 | tail -20
  echo
done
echo "===== IPs do app ====="
fly ips list --app nexo 2>&1 | tail -6
