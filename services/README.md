# Services intégrés

## websec-audit

Copie vendored du projet [SalmaC79/easm-platform-](https://github.com/SalmaC79/easm-platform-)
(Web Security Audit Tool / EASM), intégrée dans ce dépôt pour le build Docker en prod
(le dépôt amont est privé).

## websec-bridge

API JSON FastAPI (`bridge_api.py`) qui encapsule `websec_audit.AuditConfig` pour
Havet Supervision :

- `GET /v1/sites` — derniers scores
- `POST /v1/scan` — lance un audit (sites Supervision + externes)
- Auth : header `X-Websec-Key` (= `WEBSEC_API_KEY`)

Le service Docker `websec` est construit via `Dockerfile.standalone`.
