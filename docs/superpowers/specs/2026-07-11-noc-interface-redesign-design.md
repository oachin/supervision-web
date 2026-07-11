# Refonte visuelle "Mission Control" (NOC) — Havet Supervision

Date : 2026-07-11
Statut : Validé, prêt pour plan d'implémentation

## Contexte

L'application (Next.js 15 / React 19 / Tailwind + backend NestJS/Prisma) supervise des
serveurs Linux et Plesk (CPU/RAM/disque/uptime/services) ainsi que des sites web (HTTP,
DNS, SSL). L'interface actuelle est un dashboard SaaS sombre déjà propre (glassmorphism,
cards, badges de statut) mais générique. L'objectif est de la faire évoluer vers une
esthétique de centre de supervision (NOC) — sobre et professionnelle, pas criarde —
avec une densité d'information plus élevée et des éléments "temps réel" (grille de
statut vivante, sparklines, ticker d'événements, mode écran mural).

Périmètre validé : refonte complète (système de design + toutes les pages existantes :
Dashboard, Serveurs, Sites web, Alertes, Événements, Utilisateurs, Paramètres) + nouvelle
route `/wall` (mode kiosque).

Hors périmètre (explicitement exclu de cette itération) : carte topologique/réseau,
push WebSocket/SSE (on reste sur du polling), alertes sonores.

## 1. Système de design "Mission Control"

- **Fond** : assombri par rapport à l'actuel (`--background: 222 47% 4%` au lieu de
  `6%`) pour que les couleurs de statut ressortent davantage sur écran mural.
- **Palette** : on conserve la palette HSL actuelle (primary bleu `217 91% 60%`,
  accent/succès vert `142 76% 45%`, warning ambre `38 92% 50%`, destructive rouge
  `0 84% 60%`) — elle fonctionne déjà bien. Règle stricte : la couleur porte uniquement
  du sens de statut, jamais de la décoration.
- **Statut vivant** : le point de statut (`StatusBadge`) reste fixe pour ONLINE/UP, mais
  gagne un halo pulsé (`animate-pulse` + `box-shadow` glow coloré) pour
  DEGRADED/OFFLINE/DOWN, afin que l'œil soit naturellement attiré par les problèmes.
- **Typographie** : Inter pour les labels/titres (inchangé), **JetBrains Mono
  systématique** pour toute valeur numérique (CPU %, RAM %, disque %, ms de latence,
  timestamps, IDs) — aujourd'hui l'usage est ponctuel, il devient une règle appliquée
  partout.
- **Densité** : `card` padding réduit (`p-6` → `p-4`/`p-5` selon contexte), lignes de
  tableau plus compactes (`p-4` → `p-3`), `--radius` réduit légèrement
  (`0.625rem` → `0.5rem`) pour un rendu plus "panneau d'instruments" que "carte SaaS
  aérée". Les classes utilitaires existantes (`.card`, `.badge-*`, `.btn-*`) sont
  conservées et ajustées, pas remplacées.

## 2. Composants partagés (nouveaux)

Ces trois composants sont le socle réutilisé par toutes les pages ci-dessous.

- **`Sparkline`** (`components/sparkline.tsx`) : mini-courbe SVG légère, dessinée à la
  main (polyline `viewBox` normalisé), pas de dépendance Recharts par tuile — Recharts
  reste utilisé uniquement pour les graphiques détaillés de la page serveur/site
  (usage déjà existant, pas de régression). Props : `data: number[]`, `color`,
  `height`.
- **`StatusGrid` / `Tile`** (`components/status-grid.tsx`) : grille dense de tuiles
  (nom, hostname/URL, pastille de statut pulsée, sparkline, 1-2 métriques clés en
  mono). Un tile "serveur" affiche CPU/RAM + sparkline CPU ; un tile "site" affiche
  code HTTP/latence + sparkline latence. Composant générique réutilisé à 4 endroits :
  Dashboard (vue d'ensemble), page Serveurs (vue grille), page Sites web (vue grille),
  route `/wall`.
- **`EventTicker`** (`components/event-ticker.tsx`) : bandeau d'événements récents
  (alertes créées/acquittées/résolues), alimenté par `GET /alerts/events?limit=20`
  (endpoint existant), poll ~10s, défilement vertical auto (dernier événement en haut,
  transition douce).

## 3. Dashboard

Le Dashboard actuel (résumé + 2 listes "en alerte" + alertes récentes) est restructuré :

- Les 5 `MetricCard` de résumé restent en haut, reskinnées (padding réduit, valeurs en
  mono).
- La section centrale devient une `StatusGrid` complète : une tuile par serveur **et**
  par site (pas seulement ceux en alerte comme aujourd'hui), triée statut critique
  d'abord. Un site/serveur en alerte reste immédiatement visible par son halo pulsé
  même noyé dans la masse.
- `EventTicker` inséré juste sous le topbar/AlertBanner existant.
- La section "Alertes récentes" en bas de page est conservée telle quelle (déjà
  pertinente), reskinnée pour cohérence visuelle.

## 4. Pages Serveurs / Sites web

Les tableaux actuels sont conservés (adaptés à la gestion : ajout, suppression,
pause/reprise de supervision) mais :

- Reskin : lignes compactes, valeurs numériques en mono, `StatusBadge` avec halo
  pulsé sur statut anormal.
- Ajout d'un **toggle "Tableau / Grille"** en haut de page (à côté du bouton
  "Ajouter"), qui bascule vers la `StatusGrid` filtrée sur l'entité concernée. La
  grille est en lecture seule (clic → détail), les actions (suppression, pause)
  restent dans la vue tableau.
- Le filtre par query param (`?filter=alert`, etc.) déjà existant s'applique aux deux
  vues.

## 5. Pages Alertes / Événements

- **Alertes** : cartes reskinnées avec bordure gauche colorée selon la sévérité
  (`border-l-4`), tabs existants conservés. Le compteur de la tab "En cours" peut
  porter un point pulsé si `count > 0`.
- **Événements** : tableau reskinné (mono pour les timestamps), sert de source de
  données pour l'`EventTicker` (même endpoint, pas de nouvelle logique).

## 6. Mode mural `/wall`

Nouvelle route (`app/(app)/wall/page.tsx` ou hors du groupe `(app)` pour ne pas
afficher la sidebar) :

- Plein écran, sans sidebar ni topbar de navigation, texte agrandi (échelle typo
  +20-30 % par rapport au reste de l'app).
- Rotation automatique côté client (pas de nouveau besoin backend) entre deux vues,
  toutes les ~15 secondes :
  1. `StatusGrid` complète (serveurs + sites).
  2. `EventTicker` en plein écran (liste des derniers événements/alertes, format
     élargi).
- Poll des données au même rythme que le reste de l'app (~10s, voir section 7).
- Accessible sans navigation depuis la sidebar (URL directe), mais toujours protégée
  par `AuthGuard` (authentification requise, pas d'accès anonyme).

## 7. Backend

Changements limités, cohérents avec le choix "polling rafraîchi" (pas de
WebSocket/SSE dans cette itération) :

- **`ServersService.findAll()`** (`backend/src/servers/servers.service.ts`) : ajouter
  l'inclusion des 12-20 dernières `ServerMetric` (champs `cpuPercent`,
  `memoryPercent`, `diskPercent`, `collectedAt` uniquement, pas `rawData`/`pleskServices`)
  pour alimenter les sparklines de la grille. L'index existant
  `[serverId, collectedAt]` couvre déjà ce besoin.
- **`WebsitesService.findAll()`** (`backend/src/websites/websites.service.ts`) :
  ajouter l'inclusion des 12-20 derniers `WebsiteCheck` (champs `status`, `responseMs`,
  `checkedAt`) pour la sparkline de latence. Index existant
  `[websiteId, checkedAt]` suffisant.
- **Front** : réduire l'intervalle de polling de 30s à 10s sur Dashboard, Serveurs,
  Sites web (les endpoints `/dashboard`, `/servers`, `/websites` sont déjà couverts par
  `@SkipThrottle()` côté dashboard ; vérifier que le rate-limiting Nginx/Throttler
  global supporte ce rythme sur `/servers` et `/websites`, sinon ajuster le throttler
  pour ces routes en lecture seule).
- Aucun changement sur `/alerts/events` (déjà exploitable tel quel pour le ticker).
- Aucun changement de schéma Prisma requis.

## Gestion des erreurs

- Les sparklines gèrent le cas "moins de 2 points de données" (serveur/site
  fraîchement ajouté) en affichant une ligne plate ou un état vide discret, pas
  d'erreur bloquante.
- La `StatusGrid` et l'`EventTicker` réutilisent le pattern de chargement/erreur déjà
  en place sur le Dashboard (spinner, message d'erreur, retry).
- Le mode `/wall` doit survivre à une erreur réseau ponctuelle sans se figer : en cas
  d'échec de poll, on garde le dernier état affiché et on réessaie au cycle suivant
  (pas de page blanche sur un écran mural).

## Tests / vérification

- Vérification manuelle dans le navigateur (dev server) pour chaque page modifiée :
  Dashboard, Serveurs (tableau + grille), Sites web (tableau + grille), Alertes,
  Événements, `/wall`.
- Vérifier le comportement responsive (la grille doit rester utilisable en dessous de
  1280px, même si le cas d'usage principal est desktop/écran mural).
- L'application est dark-only (aucun toggle de thème dans le code actuel) : pas de
  traitement clair/sombre à prévoir pour le halo pulsé ou les autres composants.

## Roadmap d'implémentation (aperçu, détaillé dans le plan)

1. Système de design (tokens CSS, halo pulsé, classes utilitaires).
2. Composants partagés (`Sparkline`, `StatusGrid`/`Tile`, `EventTicker`).
3. Backend : extension `findAll()` serveurs/sites + ajustement polling front.
4. Dashboard.
5. Serveurs / Sites web (toggle tableau/grille).
6. Alertes / Événements.
7. Route `/wall`.
8. Passe de cohérence sur Utilisateurs / Paramètres (mêmes tokens visuels, pas de
   changement fonctionnel).
