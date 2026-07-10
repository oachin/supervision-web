#!/bin/sh
set -eu

DOMAIN="${DOMAIN:?DOMAIN required}"
OUTPUT="/etc/nginx/nginx.conf"
HTTPS_TEMPLATE="/etc/nginx/templates/nginx.conf.template"
INIT_TEMPLATE="/etc/nginx/templates/nginx-init.conf.template"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [ -f "$CERT" ]; then
  TEMPLATE="$HTTPS_TEMPLATE"
  echo "Nginx: mode HTTPS (certificat trouvé)"
else
  TEMPLATE="$INIT_TEMPLATE"
  echo "Nginx: mode HTTP (certificat absent — validation ACME)"
fi

# Override manuel possible (init-letsencrypt)
if [ -n "${NGINX_TEMPLATE:-}" ]; then
  TEMPLATE="$NGINX_TEMPLATE"
fi

sed "s/\${DOMAIN}/${DOMAIN}/g" "$TEMPLATE" > "$OUTPUT"
exec nginx -g 'daemon off;'
