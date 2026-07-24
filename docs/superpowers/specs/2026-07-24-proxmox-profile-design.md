# Design: Profil Proxmox (supervision hyperviseur)

**Date:** 2026-07-24  
**Status:** Draft — awaiting user review  
**Approche retenue:** Agent local sur le nœud + tables dédiées (Approche 2)

## Contexte

La plateforme supervise déjà des serveurs **Linux** et **Plesk** via un agent installé sur la machine. L’objectif est d’ajouter un profil **Proxmox** pour suivre un hyperviseur : ressources nœud, inventaire / performance des VMs QEMU, et santé des backups.

## Décisions validées

| Sujet | Choix |
|-------|--------|
| Collecte | Agent installé **sur** l’hyperviseur (comme Linux/Plesk) |
| Guests | **VMs QEMU/KVM uniquement** (pas LXC en V1) |
| Backups | Alertes : échec + absence de succès + jobs trop longs / warnings |
| Performance | Nœud + métriques live par VM + **historique graphique** par VM |
| Architecture | Tables Prisma dédiées + heartbeat agent |

## Hors scope V1

- Conteneurs LXC
- Clusters multi-nœuds (1 serveur plateforme = 1 nœud Proxmox)
- Proxmox Backup Server distant (on lit les tâches / jobs locaux du nœud)
- Snapshots hors jobs de backup
- Ouverture du port 8006 vers Internet (API locale / `pvesh` uniquement)

---

## 1. Profil & installation

### Enum / modèle

- Étendre `AgentProfile` : `LINUX | PLESK | PROXMOX`
- Pas de champs `pleskUrl` / `pleskApiKey` pour Proxmox en V1 (tout via agent local)

### UI création serveur

- Carte de sélection **Proxmox** aux côtés de Linux / Plesk
- Après création : commande d’install  
  `wget -qO- "https://…/api/agent/install/proxmox?key=sv_…" | sudo bash`

### Backend install

- Étendre `AgentInstallController` / `AgentInstallService` : routes `install/proxmox`, slug `proxmox`
- Même template `install.sh` avec `__PROFILE__=proxmox`
- Vérifier `server.profile === PROXMOX` avant de servir le script

---

## 2. Collecte agent

### Heartbeat (~60 s, inchangé)

Payload enrichi pour le profil `proxmox` :

**Nœud (champs ServerMetric existants)**  
- `cpuPercent`, `memoryPercent` / used / total  
- `diskPercent` / used / total (agrégat des storages locaux pertinents, typiquement `local` + `local-lvm` ou somme des storages `active` hors backups distants si trop bruité)  
- `hostname`, `osVersion`, `uptimeSeconds`, `loadAvg*`

**VMs QEMU** (`proxmoxVms[]`)  
Pour chaque VM :  
- `vmid` (int)  
- `name`  
- `status` (`running` | `stopped` | `paused` | …)  
- `cpus` (vCPU alloués)  
- `maxmemMb` (RAM allouée)  
- `maxdiskGb` (disque alloué)  
- `cpuPercent` (live, si running)  
- `memUsedMb` (live, si running)

**Backups** (`proxmoxBackups[]`)  
Jobs / tâches récents (fenêtre glissante, ex. 7 jours ou N derniers) :  
- `upid` ou id stable  
- `vmid` (nullable si job global)  
- `status` (`ok` | `failed` | `warning` | `running`)  
- `startedAt`, `finishedAt` (nullable si running)  
- `durationSec`  
- `error` (message si échec)  
- `sizeBytes` (si dispo)

### Moyens techniques agent

- Préférer `pvesh get … --output-format json` (API locale, root)  
- Endpoints typiques :  
  - `/nodes/{node}/status`  
  - `/nodes/{node}/qemu` + `/nodes/{node}/qemu/{vmid}/status/current`  
  - `/nodes/{node}/tasks` filtré type backup / ou historique vzdump  
- Détection nœud local : `hostname -s` ou `pvesh get /cluster/status`

Si `pvesh` absent → log erreur, continuer les métriques OS basiques, n’envoyer pas de faux inventaire VM.

---

## 3. Schéma Prisma

```prisma
enum AgentProfile {
  LINUX
  PLESK
  PROXMOX
}

model ProxmoxVm {
  id          String   @id @default(uuid())
  serverId    String
  server      Server   @relation(fields: [serverId], references: [id], onDelete: Cascade)
  vmid        Int
  name        String
  status      String
  cpus        Int
  maxmemMb    Float
  maxdiskGb   Float
  lastSeenAt  DateTime @default(now())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  metrics     ProxmoxVmMetric[]

  @@unique([serverId, vmid])
  @@index([serverId])
}

model ProxmoxVmMetric {
  id           String    @id @default(uuid())
  vmId         String
  vm           ProxmoxVm @relation(fields: [vmId], references: [id], onDelete: Cascade)
  cpuPercent   Float
  memUsedMb    Float
  memTotalMb   Float
  collectedAt  DateTime  @default(now())

  @@index([vmId, collectedAt])
}

model ProxmoxBackup {
  id          String   @id @default(uuid())
  serverId    String
  server      Server   @relation(fields: [serverId], references: [id], onDelete: Cascade)
  upid        String
  vmid        Int?
  vmName      String?
  status      String   // ok | failed | warning | running
  startedAt   DateTime
  finishedAt  DateTime?
  durationSec Int?
  error       String?
  sizeBytes   BigInt?
  collectedAt DateTime @default(now())

  @@unique([serverId, upid])
  @@index([serverId, startedAt])
  @@index([serverId, status])
}
```

Relations à ajouter sur `Server` : `proxmoxVms`, `proxmoxBackups`.

**Rétention (V1 simple)**  
- `ProxmoxVmMetric` : conserver ~30–90 jours (job cron optionnel ou prune à l’ingestion si > N points / VM)  
- `ProxmoxBackup` : upsert par `upid`, garder ~90 jours

---

## 4. Backend API & sync

### Ingestion (`AgentService.reportMetrics`)

Si `server.profile === PROXMOX` :
1. Upsert `ProxmoxVm` (sync inventaire ; VMs absentes du payload → marquées ou purgées après X heartbeats manqués)
2. Insert `ProxmoxVmMetric` pour VMs `running` avec métriques live
3. Upsert `ProxmoxBackup` par `upid`
4. Évaluer règles d’alertes backups

### Endpoints lecture (auth JWT, rôles existants)

- `GET /servers/:id/proxmox/vms` — liste inventaire  
- `GET /servers/:id/proxmox/vms/:vmid/metrics?from=&to=` — série temporelle (downsample comme metrics serveur)  
- `GET /servers/:id/proxmox/backups?limit=` — derniers jobs

DTO agent : étendre le DTO heartbeat avec `proxmoxVms?`, `proxmoxBackups?`.

---

## 5. Alertes

Réutiliser `AlertsService` + types d’événements dédiés (libellés FR).

| Condition | Sévérité | Notes |
|-----------|----------|--------|
| Backup `failed` | CRITICAL | Une alerte par `(server, upid)` ou agrégée par VM |
| Backup `warning` | WARNING | |
| Job `running` > **6 h** | WARNING | Seuil constant V1 |
| Aucun backup `ok` pour une VM depuis **48 h** | WARNING | Uniquement si la VM a déjà eu au moins un backup connu, ou config « monitoring backup attendu » V1 = toutes les VMs inventoriées |

Déduplication : même logique que Plesk (alerte active existante + occurrence / reopen).

Notifications email : règles existantes (serveur + sévérité) s’appliquent sans changement de modèle.

---

## 6. Frontend

### Liste / création serveurs

- Label `PROXMOX` → « Proxmox »
- Carte profil + texte d’aide install (agent root sur le nœud)

### Page détail serveur (`profile === PROXMOX`)

1. **Hyperviseur** — réutiliser graphiques CPU/RAM/disque `ServerMetric`  
2. **Machines virtuelles** — table : VMID, nom, état, vCPU, RAM, disque  
3. **Détail VM** — panneau / section : graphiques historiques CPU % et RAM (plages 1h / 24h / 1 sem. comme page serveur)  
4. **Backups** — table des derniers jobs (statut coloré, durée, erreur)

Pas de nouvelle entrée menu globale en V1 (tout sous la fiche serveur).

---

## 7. Sécurité & ops

- Clé agent HMAC existante, pas de token Proxmox stocké en V1  
- Agent root nécessaire pour `pvesh` (comme Plesk)  
- Pas d’exposition 8006 requise depuis la plateforme

---

## 8. Critères d’acceptation

1. Créer un serveur profil Proxmox, installer l’agent, voir le nœud **ONLINE** avec CPU/RAM/disque  
2. Voir la liste des VMs QEMU (nom, n°, ressources, état)  
3. Voir l’historique CPU/RAM d’une VM sur au moins 1 plage temporelle  
4. Voir les jobs de backup récents ; un échec génère une alerte CRITICAL  
5. Un job running > 6 h ou absence de succès > 48 h génère une alerte WARNING  
6. Profils Linux / Plesk inchangés

## 9. Risques / points d’attention

- Variabilité des sorties `pvesh` selon version PVE → parser défensif  
- Volume de métriques VM (N VMs × 1/min) → downsample à la lecture + prune  
- Définition « stockage nœud » ambiguë sur setups ZFS/Ceph → documenter agrégat V1 et ajuster si besoin
