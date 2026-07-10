#!/bin/sh
set -eu

DOMAIN="${DOMAIN:?DOMAIN required}"
TEMPLATE="${NGINX_TEMPLATE:-/etc/nginx/templates/nginx.conf.template}"
OUTPUT="/etc/nginx/nginx.conf"

sed "s/\${DOMAIN}/${DOMAIN}/g" "$TEMPLATE" > "$OUTPUT"
exec nginx -g 'daemon off;'
