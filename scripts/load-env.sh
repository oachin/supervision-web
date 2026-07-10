#!/usr/bin/env bash
# Charge .env sans interpréter les $ dans les mots de passe (set -u safe)
load_env() {
  local env_file="${1:-.env}"
  if [ ! -f "$env_file" ]; then
    echo "❌ Fichier $env_file introuvable" >&2
    return 1
  fi
  set +u
  set +H 2>/dev/null || true
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
  set -u
}
