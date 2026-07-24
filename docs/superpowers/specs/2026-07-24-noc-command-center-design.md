# Design: NOC Command Center

**Date:** 2026-07-24  
**Status:** Approved (maquette validée + remplacement `/noc`)

## Objectif

Remplacer l’écran NOC honeycomb par la maquette **Command Center** (TV 1920×1080), branchée sur l’API Havet Supervision.

## Non-objectifs

- Ne pas conserver l’ancienne vue honeycomb
- Pas de Zabbix
- Pas de faux % disponibilité 30 j si non calculé

## Architecture

1. **`GET /api/noc/state`** (NestJS, JWT) agrège en un payload stable :
   - `global`, `kpis`, `hosts[]`, `alerts[]` (10 dernières actives + récentes), `history24h[]`
2. **Frontend `/noc`** — React client, CSS calqué sur la maquette (mêmes tokens), polling **30 s**, keep-alive JWT existant
3. Module API client `getNocState()` ; fallback « données indisponibles » par panneau

## Mapping données

| UI | Source |
|----|--------|
| Host status | `buildServerOverview` logic (offline/sites down/crit alerts → critical) |
| Sites / VMs | Websites par serveur ; VMs si `profile=PROXMOX` |
| Métriques / sparklines | Derniers `ServerMetric` (CPU/RAM) ; latence = moyenne `lastResponseMs` sites |
| Incident since | Plus ancienne alerte ACTIVE du serveur, sinon `lastSeenAt` si OFFLINE |
| Flux alertes | Alertes ACTIVE (+ events récents RESOLU si dispo) |
| Histogr. 24 h | Count alertes créées par heure (CRIT/WARN) |
| Dispo 30 j | `null` → affichage « — » |

## Contraintes UI

Layout / couleurs / hiérarchie de `noc-command-center.html` inchangés. Overflow hidden, pas de scroll.
