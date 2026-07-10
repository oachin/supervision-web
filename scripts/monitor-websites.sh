#!/usr/bin/env bash
# Havet Supervision — monitoring HTTP + SSL externe (référence CLI)
# Usage: ./scripts/monitor-websites.sh domaines.txt
#        SSL_ALERT_DAYS=15 ./scripts/monitor-websites.sh exemple.com autre.com

set -euo pipefail

SSL_ALERT_DAYS="${SSL_ALERT_DAYS:-15}"
DOMAINS=()

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 domaine [domaine...] | fichier.txt" >&2
  exit 2
fi

if [[ -f "$1" && $(wc -l < "$1") -ge 1 ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -n "$line" ]] && DOMAINS+=("$line")
  done < "$1"
else
  DOMAINS=("$@")
fi

if [[ ${#DOMAINS[@]} -eq 0 ]]; then
  echo "Aucun domaine à vérifier." >&2
  exit 2
fi

printf "%-28s %-8s %-10s %-8s %-6s %-8s %-s\n" \
  "DOMAINE" "DNS" "HTTP" "SSL" "JOURS" "TLS" "DÉTAIL"
printf "%.0s-" {1..100}; echo

EXIT_CODE=0

for domain in "${DOMAINS[@]}"; do
  url="https://${domain}/"
  dns_ok="OK"
  dns_detail=""
  http_code="-"
  http_time="-"
  ssl_ok="—"
  ssl_days="-"
  tls_ver="-"
  detail=""

  if ! dns_detail=$(dig +short A "$domain" 2>/dev/null | head -3 | tr '\n' ' '); then
    dns_ok="FAIL"
    detail="DNS lookup failed"
    EXIT_CODE=1
  elif [[ -z "${dns_detail// }" ]]; then
    dns_ok="FAIL"
    detail="Pas d'enregistrement A"
    EXIT_CODE=1
  fi

  if [[ "$dns_ok" == "OK" ]]; then
    if ! nc -z -w5 "$domain" 443 2>/dev/null; then
      detail="${detail:+$detail · }Port 443 fermé"
      EXIT_CODE=1
    fi
  fi

  if command -v curl &>/dev/null; then
    read -r http_code http_time <<< "$(curl -o /dev/null -s -L -w '%{http_code} %{time_total}' --max-time 15 "$url" 2>/dev/null || echo '000 0')"
    if [[ "$http_code" =~ ^[23] ]]; then
      :
    else
      detail="${detail:+$detail · }HTTP $http_code"
      EXIT_CODE=1
    fi
  fi

  if command -v openssl &>/dev/null && [[ "$dns_ok" == "OK" ]]; then
    cert_info=$(echo | openssl s_client -servername "$domain" -connect "${domain}:443" -verify_return_error 2>/dev/null \
      | openssl x509 -noout -dates -issuer -subject 2>/dev/null || true)
    if [[ -n "$cert_info" ]]; then
      ssl_ok="OK"
      not_after=$(echo "$cert_info" | awk -F= '/notAfter/{print $2}')
      if [[ -n "$not_after" ]]; then
        if date -j -f "%b %d %T %Y %Z" "$not_after" +%s &>/dev/null 2>&1; then
          exp_epoch=$(date -j -f "%b %d %T %Y %Z" "$not_after" +%s)
        else
          exp_epoch=$(date -d "$not_after" +%s 2>/dev/null || echo 0)
        fi
        now_epoch=$(date +%s)
        ssl_days=$(( (exp_epoch - now_epoch) / 86400 ))
        if [[ "$ssl_days" -lt "$SSL_ALERT_DAYS" ]]; then
          detail="${detail:+$detail · }SSL expire dans ${ssl_days}j (seuil ${SSL_ALERT_DAYS}j)"
          EXIT_CODE=1
        fi
      fi
      tls_ver=$(echo | openssl s_client -servername "$domain" -connect "${domain}:443" 2>/dev/null | awk '/Protocol/{print $3; exit}')
    else
      ssl_ok="FAIL"
      detail="${detail:+$detail · }Certificat SSL invalide"
      EXIT_CODE=1
    fi
  fi

  printf "%-28s %-8s %-10s %-8s %-6s %-8s %-s\n" \
    "$domain" "$dns_ok" "${http_code}/${http_time}s" "$ssl_ok" "$ssl_days" "$tls_ver" "$detail"
done

exit "$EXIT_CODE"
