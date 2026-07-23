# Havet Supervision

Plateforme de supervision pour serveurs Linux (Ubuntu, Debian, Plesk) et surveillance de disponibilité des sites web.

**Production** : https://supervision-web-01.havetdigital.app  
**Serveur** : 91.134.100.218

## Déploiement production (5 minutes)

### Prérequis serveur

- Ubuntu 22.04+ / Debian 12+
- Docker Engine + Docker Compose v2
- DNS : `supervision-web-01.havetdigital.app` → IP publique du serveur (`SERVER_IP` dans `.env`)
- Ports 80 et 443 ouverts

### Installation

```bash
# Sur le serveur de production
sudo apt update && sudo apt install -y git
sudo bash scripts/install-docker.sh   # Docker officiel + Compose v2
# Ou si le repo n'est pas encore cloné :
# curl -fsSL https://get.docker.com | sh

git clone https://github.com/oachin/supervision-web.git
cd supervision-web

cp .env.example .env
bash scripts/generate-secrets.sh   # Copier les valeurs dans .env.secrets
nano .env                          # DOMAIN, SERVER_IP, CERTBOT_EMAIL
nano .env.secrets                  # coller les secrets générés

bash scripts/deploy-production.sh
```

Accédez à **https://supervision-web-01.havetdigital.app** et connectez-vous avec `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### Données persistantes

Les volumes Docker suivants survivent aux redémarrages et mises à jour :

| Volume | Contenu |
|--------|---------|
| `postgres_data` | Base de données |
| `redis_data` | Cache et sessions |
| `certbot_conf` | Certificats Let's Encrypt |
| `certbot_www` | Validation ACME |

### Mise à jour

```bash
cd supervision-web
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Les migrations s'appliquent automatiquement au démarrage du backend.

### Renouvellement SSL

Automatique via le conteneur `certbot` (toutes les 12 h). Aucune action requise.

Pour forcer un renouvellement :
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec certbot certbot renew
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart nginx
```

---

## Développement local

```bash
cp .env.example .env
bash scripts/generate-secrets.sh
# Adapter CORS_ORIGIN et NEXT_PUBLIC_API_URL pour localhost
bash scripts/deploy.sh
```

Accès : http://localhost:3000

---

## Agent Linux

Sur chaque serveur supervisé :

```bash
SUPERVISION_API_URL=https://supervision-web-01.havetdigital.app/api \
SUPERVISION_AGENT_KEY=sv_votre_cle \
bash agent/install.sh
```

Créez d'abord le serveur dans l'interface pour obtenir la clé agent.

---

## Architecture de supervision

| Composant | Mode | Détail |
|-----------|------|--------|
| **Serveur Linux** | Agent | Métriques CPU, RAM, disque, uptime |
| **Serveur Plesk** | Agent | Métriques + services (nginx, Apache, MariaDB…) + import des domaines |
| **Sites web** | Externe (plateforme) | HTTP (curl-like, redirections), DNS, port 443, SSL/TLS, chaîne de certificats |

Les sites importés depuis Plesk sont **surveillés uniquement depuis l'extérieur** (serveur de supervision).  
Seul le **serveur Plesk** bénéficie de la supervision interne (ressources + services).

Script CLI de référence (bash) : `scripts/monitor-websites.sh`

```bash
SSL_ALERT_DAYS=15 ./scripts/monitor-websites.sh domaine1.com domaine2.com
# ou
./scripts/monitor-websites.sh liste-domaines.txt
```

---

## Architecture déploiement

```
Internet → Nginx (443/80, Let's Encrypt)
              ├── /     → Frontend (Next.js)
              └── /api  → Backend (NestJS)
                            ├── PostgreSQL (volume persistant)
                            └── Redis (volume persistant)
```

## Sécurité

- JWT + refresh tokens, 2FA TOTP
- Rate limiting Nginx (login + API)
- PostgreSQL/Redis sur réseau Docker interne
- HTTPS obligatoire en production (HSTS)
- Clés agent HMAC-SHA256, chiffrement AES-256-GCM

## Licence

Propriétaire — Havet Digital
