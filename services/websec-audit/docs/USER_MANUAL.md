# User Manual / Manuel utilisateur

*Bilingual document — English section first, French section below.*
*Document bilingue — section anglaise d'abord, section française ensuite.*

---

## 🇬🇧 English

### 1. Installation

**Requirements:** Python **3.11 – 3.13**.

**Option A — Docker (recommended, no local Python needed):**

```bash
git clone <repository-url>
cd web-security-audit-tool
docker compose up --build          # dashboard on http://localhost:8000
docker compose run --rm audit      # run a one-off CLI audit
```

The image already contains WeasyPrint's native libraries and `nmap`, and the
SQLite database persists in a named Docker volume.

**Option B — local Python:**

```bash
git clone <repository-url>
cd web-security-audit-tool

python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

**For PDF reports**, install the native libraries WeasyPrint needs:

```bash
sudo apt install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0 libcairo2
```

**For port scanning** (optional), install the `nmap` binary:

```bash
sudo apt install nmap
```

### 2. Configure the sites to audit

Edit `config/targets.yaml`:

```yaml
sites:
  - name: Company Website        # a friendly label
    url: https://www.example.com # full URL (http:// or https://)
    domain: example.com          # domain for DNS checks (optional; inferred from url)

  - name: Customer Portal
    url: https://portal.example.com
    domain: example.com
```

- `name` — how the site appears in reports.
- `url` — the address that is fetched for availability, TLS, headers and misconfig checks.
- `domain` — used for SPF/DKIM/DMARC lookups. If omitted, it is taken from the URL host.

### 3. Run an audit

```bash
python main.py
```

This runs every check **except** the port scan, scores each site, saves the run
to the database, and writes an HTML + PDF report to `reports/output/`.

Useful options:

| Command | Effect |
|---------|--------|
| `python main.py --scan tls headers` | Run only the listed scanners |
| `python main.py --deep` | Also run the deep engines (testssl.sh + nuclei, and ZAP if installed) — slower, far more thorough |
| `python main.py --workers 20` | Cap parallelism at 20 sites at a time (default: `auto` = every site at once, max 500) |
| `python main.py --per-site-reports` | Also write one detailed report per site |
| `python main.py --no-report` | Skip report generation |
| `python main.py --no-db` | Don't save the run to the database |
| `python main.py --alert` | Send email alerts for critical findings |
| `python main.py --authorized` | Also run the port scan (authorization required) |
| `python main.py --history https://www.example.com` | Print a site's score history and exit |
| `python main.py --config other.yaml` | Use a different targets file |

### 4. Read the report

Open the newest file in `reports/output/`:

- **Summary table** — grade, score, trend (▲/▼ vs. the previous run), and the
  number of actionable findings per site.
- **Detailed findings** — every finding with its severity, category, description
  and point penalty, plus a per-site score history line.
- Grades: **A** (≥90) is excellent, **F** (<50) is critical.

### 5. Track security over time

Every run is stored. To see how a site has evolved:

```bash
python main.py --history https://www.example.com
```

Run the audit regularly (e.g. from a scheduled job / cron) to build a history;
the trend indicators and history lines then populate automatically.

### 6. The interactive dashboard

Start the web dashboard (it uses the same database the CLI writes to):

```bash
uvicorn dashboard.app:app --host 0.0.0.0 --port 8000
# then open http://localhost:8000 in a browser
```

- **Global dashboard** (home): summary cards (sites monitored, average score,
  critical/at-risk counts), a grade-distribution chart, a fleet score-trend
  chart, and a sortable table of every site. Click any row to drill in.
- **Per-site page**: the site's score-over-time chart, all findings with
  bilingual recommendations and framework references, its run history, and
  **Download HTML / Download PDF** buttons for that site's report.
- **Run audit now**: the button on the home page launches a scan in the
  background; a live status card shows progress and the page refreshes when it
  finishes.
- **Continuous monitoring**: to scan automatically, set `AUDIT_SCHEDULE_MINUTES`
  in `.env` (run every N minutes) and/or `AUDIT_SCHEDULE_AT` (run at specific
  times each day, e.g. `AUDIT_SCHEDULE_AT=02:00,14:00`) while the app is up, or
  schedule the CLI with cron/systemd for production:
  ```cron
  0 */6 * * * cd /opt/web-security-audit-tool && .venv/bin/python main.py >> audit.log 2>&1
  ```
- **Dark mode**: click the 🌙 / ☀️ button in the header to switch themes; your
  choice is remembered in the browser (it also follows your OS setting by default).

### 7. Set up email alerts

1. Copy the example configuration and fill it in:
   ```bash
   cp .env.example .env
   $EDITOR .env
   ```
2. Set at least `SMTP_HOST`, `ALERT_TO`, and credentials if your server requires them.
3. Run with `--alert`:
   ```bash
   python main.py --alert
   ```

An email is sent when a site scores below `ALERT_SCORE_THRESHOLD` (default 60)
**or** has a critical finding (e.g. expired certificate, site down).

### 8. Authorization for port scanning ⚠️

Port scanning is **off by default**. It only runs with `--authorized`, which
asserts you hold **written** authorization to scan the target infrastructure.
Keep the authorization reference on file. Never scan systems you are not
permitted to test.

### 9. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `PDF skipped — WeasyPrint unavailable` | Install the native libs from step 1 |
| `nmap binary not found` | `sudo apt install nmap` |
| `DB save skipped` | Check `AUDIT_DB_URL`; ensure the folder is writable |
| DNS checks inconclusive | Transient resolver/timeout — re-run; not a confirmed weakness |
| Alerts not sent | Verify `SMTP_HOST` and `ALERT_TO` are set in `.env` |

---

## 🇫🇷 Français

### 1. Installation

**Prérequis :** Python **3.11 à 3.13**.

**Option A — Docker (recommandé, aucun Python local nécessaire) :**

```bash
git clone <repository-url>
cd web-security-audit-tool
docker compose up --build          # tableau de bord sur http://localhost:8000
docker compose run --rm audit      # audit CLI ponctuel
```

L'image contient déjà les bibliothèques natives de WeasyPrint et `nmap`, et la
base SQLite persiste dans un volume Docker nommé.

**Option B — Python local :**

```bash
git clone <url-du-depot>
cd web-security-audit-tool

python -m venv .venv
source .venv/bin/activate            # Windows : .venv\Scripts\activate
pip install -r requirements.txt
```

**Pour les rapports PDF**, installez les bibliothèques natives de WeasyPrint :

```bash
sudo apt install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0 libcairo2
```

**Pour le scan de ports** (optionnel), installez le binaire `nmap` :

```bash
sudo apt install nmap
```

### 2. Configurer les sites à auditer

Modifiez `config/targets.yaml` :

```yaml
sites:
  - name: Site vitrine           # un libellé lisible
    url: https://www.example.com # URL complète (http:// ou https://)
    domain: example.com          # domaine pour les contrôles DNS (optionnel)

  - name: Portail client
    url: https://portal.example.com
    domain: example.com
```

- `name` — nom affiché dans les rapports.
- `url` — adresse interrogée pour la disponibilité, le TLS, les en-têtes et la configuration.
- `domain` — utilisé pour les recherches SPF/DKIM/DMARC. Déduit de l'URL si omis.

### 3. Lancer un audit

```bash
python main.py
```

Cela exécute tous les contrôles **sauf** le scan de ports, note chaque site,
enregistre l'exécution en base et écrit un rapport HTML + PDF dans
`reports/output/`.

Options utiles :

| Commande | Effet |
|----------|-------|
| `python main.py --scan tls headers` | N'exécuter que les scanners listés |
| `python main.py --deep` | Lance aussi les moteurs approfondis (testssl.sh + nuclei, et ZAP si installé) — plus lent, bien plus complet |
| `python main.py --workers 20` | Limiter à 20 sites en parallèle (défaut : `auto` = tous les sites à la fois, max 500) |
| `python main.py --per-site-reports` | Écrire aussi un rapport détaillé par site |
| `python main.py --no-report` | Ne pas générer de rapport |
| `python main.py --no-db` | Ne pas enregistrer l'exécution en base |
| `python main.py --alert` | Envoyer des alertes e-mail pour les constats critiques |
| `python main.py --authorized` | Exécuter aussi le scan de ports (autorisation requise) |
| `python main.py --history https://www.example.com` | Afficher l'historique d'un site puis quitter |
| `python main.py --config autre.yaml` | Utiliser un autre fichier de cibles |

### 4. Lire le rapport

Ouvrez le fichier le plus récent dans `reports/output/` :

- **Tableau de synthèse** — note, score, tendance (▲/▼ par rapport à l'exécution
  précédente) et nombre de constats exploitables par site.
- **Constats détaillés** — chaque constat avec sa sévérité, sa catégorie, sa
  description et la pénalité en points, plus une ligne d'historique par site.
- Notes : **A** (≥90) est excellent, **F** (<50) est critique.

### 5. Suivre la sécurité dans le temps

Chaque exécution est enregistrée. Pour voir l'évolution d'un site :

```bash
python main.py --history https://www.example.com
```

Lancez l'audit régulièrement (par ex. via une tâche planifiée / cron) pour
constituer un historique ; les indicateurs de tendance se remplissent alors
automatiquement.

### 6. Le tableau de bord interactif

Démarrez le tableau de bord web (il utilise la même base que la CLI) :

```bash
uvicorn dashboard.app:app --host 0.0.0.0 --port 8000
# puis ouvrez http://localhost:8000 dans un navigateur
```

- **Tableau de bord global** (accueil) : cartes de synthèse (sites suivis, score
  moyen, nombre de sites critiques/à risque), un graphique de répartition des
  notes, une courbe de tendance du score du parc, et un tableau triable de tous
  les sites. Cliquez sur une ligne pour ouvrir le détail.
- **Page par site** : la courbe d'évolution du score, tous les constats avec
  recommandations bilingues et référentiels, l'historique des exécutions, et des
  boutons **Télécharger HTML / PDF** pour le rapport du site.
- **Lancer un audit** : le bouton de l'accueil déclenche un scan en arrière-plan ;
  une carte d'état affiche la progression et la page se rafraîchit à la fin.
- **Surveillance continue** : pour analyser automatiquement, définissez
  `AUDIT_SCHEDULE_MINUTES` dans `.env` (toutes les N minutes) et/ou
  `AUDIT_SCHEDULE_AT` (à des heures précises, ex. `AUDIT_SCHEDULE_AT=02:00,14:00`)
  tant que l'app tourne, ou planifiez la CLI avec cron/systemd en production :
  ```cron
  0 */6 * * * cd /opt/web-security-audit-tool && .venv/bin/python main.py >> audit.log 2>&1
  ```
- **Mode sombre** : cliquez sur le bouton 🌙 / ☀️ dans l'en-tête pour changer de
  thème ; votre choix est mémorisé dans le navigateur (il suit aussi le réglage
  de votre système par défaut).

### 7. Configurer les alertes e-mail

1. Copiez la configuration d'exemple et renseignez-la :
   ```bash
   cp .env.example .env
   $EDITOR .env
   ```
2. Renseignez au minimum `SMTP_HOST`, `ALERT_TO`, et les identifiants si nécessaire.
3. Lancez avec `--alert` :
   ```bash
   python main.py --alert
   ```

Un e-mail est envoyé lorsqu'un site passe sous `ALERT_SCORE_THRESHOLD` (60 par
défaut) **ou** présente un constat critique (certificat expiré, site hors ligne…).

### 8. Autorisation pour le scan de ports ⚠️

Le scan de ports est **désactivé par défaut**. Il ne s'exécute qu'avec
`--authorized`, qui atteste que vous détenez une autorisation **écrite** de
scanner l'infrastructure cible. Conservez la référence de l'autorisation.
N'auditez jamais des systèmes que vous n'êtes pas autorisé à tester.

### 9. Dépannage

| Symptôme | Solution |
|----------|----------|
| `PDF skipped — WeasyPrint unavailable` | Installer les bibliothèques natives (étape 1) |
| `nmap binary not found` | `sudo apt install nmap` |
| `DB save skipped` | Vérifier `AUDIT_DB_URL` ; dossier accessible en écriture |
| Contrôles DNS non concluants | Timeout passager — relancer ; pas une faiblesse avérée |
| Alertes non envoyées | Vérifier `SMTP_HOST` et `ALERT_TO` dans `.env` |
