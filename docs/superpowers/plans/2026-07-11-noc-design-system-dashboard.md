# NOC Design System + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Mission Control" design foundation (tokens, pulsing status indicators, sparkline + status-grid + event-ticker components) and rebuild the Dashboard page as its first showcase, per `NOC-REDESIGN-DESIGN.md` sections 1, 2, 3 and 7.

**Architecture:** Pure additive/refactor work on the existing Next.js 15 (App Router) + Tailwind frontend and NestJS + Prisma backend. No new dependencies, no schema changes. Backend changes extend two existing `findAll()` queries with lightweight historical data (already-indexed relations). Frontend changes add three new shared components (`Sparkline`, `StatusGrid`/`Tile`, `EventTicker`) consumed first by the Dashboard page; these same components will be reused by the Servers/Websites/Wall work in the follow-up plan.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 3, TypeScript, NestJS 10, Prisma 6, PostgreSQL.

## Global Constraints

- Design tokens: `--background: 222 47% 4%` (from `222 47% 6%`), `--radius: 0.5rem` (from
  `0.625rem`), values copied verbatim from `NOC-REDESIGN-DESIGN.md` section 1.
- All numeric values in the UI (CPU/RAM/disk %, ms, timestamps) use `font-mono`
  (JetBrains Mono, already the configured `font-mono` family in
  `frontend/tailwind.config.ts`) — no new font is introduced.
- Color carries status meaning only (green/amber/red/blue reserved for
  ONLINE-UP / DEGRADED / OFFLINE-DOWN / primary actions) — never used decoratively in
  new components.
- No WebSocket/SSE in this plan — real-time feel comes from polling at 10s intervals
  (down from the current 30s), per `NOC-REDESIGN-DESIGN.md` section 7.
- No Prisma schema migration in this plan — both backend tasks only add `select`/`take`
  clauses to existing relations (`ServerMetric` via `[serverId, collectedAt]` index,
  `WebsiteCheck` via `[websiteId, checkedAt]` index), both already present in
  `backend/prisma/schema.prisma`.
- **No automated test framework exists in this repository** (no Jest/Vitest config,
  no `*.spec.ts`/`*.test.ts` files in `frontend/` or `backend/`, confirmed by search
  before writing this plan). Introducing one is out of scope for a visual redesign and
  not requested. Verification in this plan therefore relies on: (a) TypeScript
  compilation (`npm run build`) as a correctness gate after every code change, and (b)
  manual browser verification via the local dev stack (`bash scripts/deploy.sh`, per
  `README.md`), matching the "Tests / vérification" section of the design spec.
- Scope boundary: this plan covers Dashboard only. The Servers/Websites pages'
  table-to-grid toggle, Alerts/Events reskin, and the `/wall` route are deliberately
  deferred to a follow-up plan (`NOC-REDESIGN-DESIGN.md` roadmap steps 5-8) — they reuse
  the components built here.

---

## Task 1: Design tokens — darker background, tighter radius, pulse/ticker keyframes

**Files:**
- Modify: `frontend/src/app/globals.css:9` (background token), `frontend/src/app/globals.css:23` (radius token), `frontend/src/app/globals.css:91` (append new keyframes/classes after the closing `}` of `@layer components`)

**Interfaces:**
- Produces: CSS classes `.status-dot-pulse-danger`, `.status-dot-pulse-warning`,
  `.event-ticker-row` — consumed by Task 2 (`StatusBadge`), Task 4 (`Tile`), and Task 5
  (`EventTicker`).

- [ ] **Step 1: Darken the background token**

In `frontend/src/app/globals.css`, change line 9:

```css
    --background: 222 47% 6%;
```
to:
```css
    --background: 222 47% 4%;
```

- [ ] **Step 2: Tighten the border radius token**

Change line 23:

```css
    --radius: 0.625rem;
```
to:
```css
    --radius: 0.5rem;
```

- [ ] **Step 3: Add pulse and ticker keyframes/classes**

Append this block immediately after the closing `}` of the `@layer components { ... }`
block (i.e. after the current last line, `}` that closes `.badge-muted`'s parent layer):

```css

@keyframes pulse-glow-danger {
  0%, 100% { box-shadow: 0 0 0 0 hsl(var(--destructive) / 0.6); }
  50% { box-shadow: 0 0 8px 3px hsl(var(--destructive) / 0.6); }
}

@keyframes pulse-glow-warning {
  0%, 100% { box-shadow: 0 0 0 0 hsl(var(--warning) / 0.6); }
  50% { box-shadow: 0 0 8px 3px hsl(var(--warning) / 0.6); }
}

@keyframes ticker-row-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.status-dot-pulse-danger {
  animation: pulse-glow-danger 1.8s ease-in-out infinite;
}

.status-dot-pulse-warning {
  animation: pulse-glow-warning 1.8s ease-in-out infinite;
}

.event-ticker-row {
  animation: ticker-row-in 0.3s ease-out;
}
```

- [ ] **Step 4: Verify the frontend still builds**

Run: `cd frontend && npm run build`
Expected: build completes with no CSS/TypeScript errors (exit code 0). The visual
change (darker background, tighter corners) will not be checked in the browser until
Task 9's end-to-end pass — this step only guards against a syntax mistake in the CSS.

- [ ] **Step 5: Commit**

```bash
cd /Users/provectio/Documents/HavetDigital/supervision
git add frontend/src/app/globals.css
git commit -m "style: darken background, tighten radius, add pulse/ticker keyframes"
```

---

## Task 2: Pulsing status dot on `StatusBadge`

**Files:**
- Modify: `frontend/src/components/ui.tsx:1-37`

**Interfaces:**
- Consumes: `.status-dot-pulse-danger`, `.status-dot-pulse-warning` from Task 1.
- Produces: no signature change to `StatusBadge`/`WebsiteStatusBadge` (same props),
  only their rendered output gains the pulse classes — safe for all existing callers.

- [ ] **Step 1: Add the pulse class to the status dot**

In `frontend/src/components/ui.tsx`, replace the `StatusBadge` function body (lines
4-37) with:

```tsx
export function StatusBadge({ status }: { status: string }) {
  const variant = {
    ONLINE: 'badge-success',
    UP: 'badge-success',
    OFFLINE: 'badge-danger',
    DOWN: 'badge-danger',
    DEGRADED: 'badge-warning',
    UNKNOWN: 'badge-muted',
    DISABLED: 'badge-muted',
  }[status] || 'badge-muted';

  const label = {
    ONLINE: 'En ligne',
    UP: 'En ligne',
    OFFLINE: 'Hors ligne',
    DOWN: 'Hors ligne',
    DEGRADED: 'Dégradé',
    UNKNOWN: 'Inconnu',
    DISABLED: 'Supervision off',
  }[status] || status;

  const pulseClass =
    status === 'OFFLINE' || status === 'DOWN'
      ? 'status-dot-pulse-danger'
      : status === 'DEGRADED'
        ? 'status-dot-pulse-warning'
        : '';

  return (
    <span className={cn(variant)}>
      <span className={cn(
        'h-1.5 w-1.5 rounded-full',
        status === 'ONLINE' || status === 'UP' ? 'bg-accent' :
        status === 'OFFLINE' || status === 'DOWN' ? 'bg-destructive' :
        status === 'DEGRADED' ? 'bg-warning' :
        status === 'DISABLED' ? 'bg-muted-foreground' : 'bg-muted-foreground',
        pulseClass,
      )} />
      {label}
    </span>
  );
}
```

(`WebsiteStatusBadge` below it is unchanged — it already delegates to `StatusBadge`.)

- [ ] **Step 2: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: exit code 0, no type errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/provectio/Documents/HavetDigital/supervision
git add frontend/src/components/ui.tsx
git commit -m "feat: pulsing halo on degraded/offline status dots"
```

---

## Task 3: `Sparkline` component

**Files:**
- Create: `frontend/src/components/sparkline.tsx`

**Interfaces:**
- Produces: `Sparkline({ data: number[], height?: number, color?: string })` — a
  dependency-free SVG line, consumed by Task 4's `Tile`.

- [ ] **Step 1: Create the component**

```tsx
export function Sparkline({
  data,
  height = 28,
  color = 'currentColor',
}: {
  data: number[];
  height?: number;
  color?: string;
}) {
  if (data.length < 2) {
    return (
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        <line x1="0" y1={height / 2} x2="100" y2={height / 2} stroke={color} strokeOpacity={0.2} strokeWidth={1.5} />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = 100 / (data.length - 1);

  const points = data
    .map((value, i) => {
      const x = i * stepX;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
```

- [ ] **Step 2: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: exit code 0. (The component is not yet imported anywhere, so this only
checks its own syntax/types — Next.js will not tree-shake-error on an unused file.)

- [ ] **Step 3: Commit**

```bash
cd /Users/provectio/Documents/HavetDigital/supervision
git add frontend/src/components/sparkline.tsx
git commit -m "feat: add dependency-free Sparkline component"
```

---

## Task 4: `Tile` + `StatusGrid` components

**Files:**
- Create: `frontend/src/components/status-grid.tsx`

**Interfaces:**
- Consumes: `Sparkline` from Task 3; `.status-dot-pulse-danger`/`-warning` from Task 1;
  `cn` from `frontend/src/lib/utils.ts`.
- Produces: `export interface StatusTileData { id, name, subtitle, status, href,
  metricLabel, secondaryLabel?, sparklineData }` and `StatusGrid({ tiles:
  StatusTileData[] })` — consumed by Task 8 (Dashboard) and, in the follow-up plan, by
  the Servers/Websites grid-view toggle and `/wall`.

- [ ] **Step 1: Create the component**

```tsx
'use client';

import Link from 'next/link';
import { Sparkline } from './sparkline';
import { cn } from '@/lib/utils';

export interface StatusTileData {
  id: string;
  name: string;
  subtitle: string;
  status: string;
  href: string;
  metricLabel: string;
  secondaryLabel?: string;
  sparklineData: number[];
}

const severityRank: Record<string, number> = {
  OFFLINE: 0,
  DOWN: 0,
  DEGRADED: 1,
  UNKNOWN: 2,
  ONLINE: 3,
  UP: 3,
  DISABLED: 4,
};

function statusDotClass(status: string) {
  if (status === 'ONLINE' || status === 'UP') return 'bg-accent';
  if (status === 'OFFLINE' || status === 'DOWN') return 'bg-destructive';
  if (status === 'DEGRADED') return 'bg-warning';
  return 'bg-muted-foreground';
}

function statusPulseClass(status: string) {
  if (status === 'OFFLINE' || status === 'DOWN') return 'status-dot-pulse-danger';
  if (status === 'DEGRADED') return 'status-dot-pulse-warning';
  return '';
}

function statusGlowColor(status: string) {
  if (status === 'ONLINE' || status === 'UP') return 'hsl(142 76% 45%)';
  if (status === 'OFFLINE' || status === 'DOWN') return 'hsl(0 84% 60%)';
  if (status === 'DEGRADED') return 'hsl(38 92% 50%)';
  return 'hsl(215 20% 55%)';
}

export function Tile({ tile }: { tile: StatusTileData }) {
  return (
    <Link
      href={tile.href}
      className="group flex flex-col gap-2 rounded-lg border border-white/5 bg-card/60 p-3 transition-colors hover:border-primary/30"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{tile.name}</p>
          <p className="truncate text-xs text-muted-foreground">{tile.subtitle}</p>
        </div>
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            statusDotClass(tile.status),
            statusPulseClass(tile.status),
          )}
        />
      </div>
      <Sparkline data={tile.sparklineData} color={statusGlowColor(tile.status)} height={24} />
      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
        <span>{tile.metricLabel}</span>
        {tile.secondaryLabel && <span>{tile.secondaryLabel}</span>}
      </div>
    </Link>
  );
}

export function StatusGrid({ tiles }: { tiles: StatusTileData[] }) {
  const sorted = [...tiles].sort(
    (a, b) => (severityRank[a.status] ?? 2) - (severityRank[b.status] ?? 2),
  );

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun élément à afficher.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {sorted.map((tile) => (
        <Tile key={tile.id} tile={tile} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/provectio/Documents/HavetDigital/supervision
git add frontend/src/components/status-grid.tsx
git commit -m "feat: add Tile and StatusGrid components"
```

---

## Task 5: `EventTicker` component

**Files:**
- Create: `frontend/src/components/event-ticker.tsx`

**Interfaces:**
- Consumes: `api.getAlertEvents(limit)` (already exists in `frontend/src/lib/api.ts`,
  returns `AlertEvent[]`), `SeverityBadge` from `frontend/src/components/ui.tsx`,
  `formatDate` from `frontend/src/lib/utils.ts`, `.event-ticker-row` from Task 1.
- Produces: `EventTicker({ limit?: number })` — consumed by Task 8 (Dashboard).

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { api, type AlertEvent } from '@/lib/api';
import { SeverityBadge } from './ui';
import { formatDate } from '@/lib/utils';

const actionLabels: Record<string, string> = {
  CREATED: 'Créée',
  ACKNOWLEDGED: 'Acquittée',
  SNOOZE_EXPIRED: 'Snooze expiré',
  OCCURRENCE: 'Occurrence',
  ISSUE_RESOLVED: 'Résolue',
  REOPENED: 'Réouverte',
  CLOSED: 'Clôturée',
  RESOURCE_DELETED: 'Ressource supprimée',
};

export function EventTicker({ limit = 8 }: { limit?: number }) {
  const [events, setEvents] = useState<AlertEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.getAlertEvents(limit)
        .then((data) => {
          if (!cancelled) setEvents(data);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [limit]);

  if (events.length === 0) return null;

  return (
    <div className="card max-h-56 overflow-y-auto p-0">
      <ul className="divide-y divide-white/5">
        {events.map((e) => {
          const title = e.alert?.title ?? e.alertTitle ?? '—';
          const severity = (e.alert?.severity ?? e.alertSeverity ?? 'INFO') as
            | 'INFO'
            | 'WARNING'
            | 'CRITICAL';
          return (
            <li key={e.id} className="event-ticker-row flex items-center gap-3 px-4 py-2 text-sm">
              <SeverityBadge severity={severity} />
              <span className="truncate font-medium">{title}</span>
              <span className="text-xs text-muted-foreground">{actionLabels[e.action] ?? e.action}</span>
              <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                {formatDate(e.createdAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/provectio/Documents/HavetDigital/supervision
git add frontend/src/components/event-ticker.tsx
git commit -m "feat: add EventTicker component"
```

---

## Task 6: Backend — extend `ServersService.findAll()` with metric history

**Files:**
- Modify: `backend/src/servers/servers.service.ts:29-36`

**Interfaces:**
- Produces: `GET /servers` response items gain a `metrics: { cpuPercent: number,
  memoryPercent: number, diskPercent: number, collectedAt: string }[]` field (newest
  first, up to 20 entries) — consumed by Task 8's `serverToTile`.

- [ ] **Step 1: Extend the Prisma query**

In `backend/src/servers/servers.service.ts`, replace lines 29-36:

```ts
  async findAll() {
    const servers = await this.prisma.server.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { websites: true, metrics: true } },
      },
    });
    return servers.map((s) => this.sanitize(s as unknown as Record<string, unknown>));
```

with:

```ts
  async findAll() {
    const servers = await this.prisma.server.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { websites: true, metrics: true } },
        metrics: {
          take: 20,
          orderBy: { collectedAt: 'desc' },
          select: {
            cpuPercent: true,
            memoryPercent: true,
            diskPercent: true,
            collectedAt: true,
          },
        },
      },
    });
    return servers.map((s) => this.sanitize(s as unknown as Record<string, unknown>));
```

- [ ] **Step 2: Verify the backend builds**

Run: `cd backend && npm run build`
Expected: exit code 0. This runs `nest build` (TypeScript compilation against the
generated Prisma client) and will fail loudly if the `include` shape is invalid.

- [ ] **Step 3: Commit**

```bash
cd /Users/provectio/Documents/HavetDigital/supervision
git add backend/src/servers/servers.service.ts
git commit -m "feat: include recent metric history in GET /servers"
```

---

## Task 7: Backend — extend `WebsitesService.findAll()` with check history

**Files:**
- Modify: `backend/src/websites/websites.service.ts:15-22`

**Interfaces:**
- Produces: `GET /websites` response items gain a `checks: { status: string,
  responseMs: number | null, checkedAt: string }[]` field (newest first, up to 20
  entries) — consumed by Task 8's `websiteToTile`.

- [ ] **Step 1: Extend the Prisma query**

In `backend/src/websites/websites.service.ts`, replace lines 15-22:

```ts
  async findAll() {
    return this.prisma.website.findMany({
      orderBy: { name: 'asc' },
      include: {
        server: { select: { id: true, name: true, hostname: true } },
      },
    });
  }
```

with:

```ts
  async findAll() {
    return this.prisma.website.findMany({
      orderBy: { name: 'asc' },
      include: {
        server: { select: { id: true, name: true, hostname: true } },
        checks: {
          take: 20,
          orderBy: { checkedAt: 'desc' },
          select: {
            status: true,
            responseMs: true,
            checkedAt: true,
          },
        },
      },
    });
  }
```

- [ ] **Step 2: Verify the backend builds**

Run: `cd backend && npm run build`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/provectio/Documents/HavetDigital/supervision
git add backend/src/websites/websites.service.ts
git commit -m "feat: include recent check history in GET /websites"
```

---

## Task 8: Dashboard — live status grid + event ticker + 10s polling

**Files:**
- Modify: `frontend/src/lib/api.ts` (add two lightweight point types, extend `Server`
  and `Website` interfaces)
- Modify: `frontend/src/app/(app)/dashboard/page.tsx:1-214` (full rewrite)

**Interfaces:**
- Consumes: `StatusGrid`/`StatusTileData` (Task 4), `EventTicker` (Task 5), the
  extended `metrics`/`checks` fields from Tasks 6-7.
- Produces: no new exports (page component), but establishes the `serverToTile`/
  `websiteToTile` mapping pattern that the follow-up plan's Servers/Websites grid view
  will reuse verbatim.

- [ ] **Step 1: Add lightweight history types and extend `Server`/`Website`**

In `frontend/src/lib/api.ts`, find the `Server` interface (currently ending with
`_count?: { websites: number; metrics: number };`) and add a `metrics` field. Find the
`Website` interface (currently ending with `server?: { id: string; name: string;
hostname: string };`) and add a `checks` field. Apply this diff:

```ts
export interface Server {
  id: string;
  name: string;
  hostname: string;
  ipAddress?: string;
  osType: string;
  osVersion?: string;
  profile: 'LINUX' | 'PLESK';
  hasPlesk: boolean;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'UNKNOWN';
  lastSeenAt?: string;
  tags: string[];
  notes?: string;
  _count?: { websites: number; metrics: number };
  metrics?: { cpuPercent: number; memoryPercent: number; diskPercent: number; collectedAt: string }[];
}
```

```ts
export interface Website {
  id: string;
  name: string;
  url: string;
  status: 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  monitoringEnabled: boolean;
  checkInterval: number;
  sslAlertDays?: number;
  lastCheckAt?: string;
  lastResponseMs?: number;
  lastStatusCode?: number;
  sslExpiresAt?: string;
  sslDaysRemaining?: number;
  sslIssuer?: string;
  sslSubject?: string;
  lastDnsOk?: boolean;
  lastPort443Open?: boolean;
  lastTlsVersion?: string;
  server?: { id: string; name: string; hostname: string };
  checks?: { status: string; responseMs?: number; checkedAt: string }[];
}
```

(`ServerDetail`/`ServerSummary`/`WebsiteDetail` further down the file already declare
narrower/wider versions of `metrics`/`checks` that override these optional fields —
this is structurally valid TypeScript since their element types are supersets of the
new optional ones; the build step below confirms no conflict.)

- [ ] **Step 2: Rewrite the Dashboard page**

Replace the entire contents of `frontend/src/app/(app)/dashboard/page.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Server as ServerIcon, Globe, Bell, AlertTriangle, EyeOff } from 'lucide-react';
import { api, type DashboardData, type Server, type Website } from '@/lib/api';
import { MetricCard, SeverityBadge } from '@/components/ui';
import { StatusGrid, type StatusTileData } from '@/components/status-grid';
import { EventTicker } from '@/components/event-ticker';
import { formatDate, formatCpuPercent } from '@/lib/utils';
import Link from 'next/link';

function serverToTile(s: Server): StatusTileData {
  const latest = s.metrics?.[0];
  const history = s.metrics ? [...s.metrics].reverse().map((m) => m.cpuPercent) : [];
  return {
    id: s.id,
    name: s.name,
    subtitle: s.hostname === 'en-attente' ? '—' : s.hostname,
    status: s.status,
    href: `/servers/${s.id}`,
    metricLabel: latest ? `CPU ${formatCpuPercent(latest.cpuPercent)}` : '—',
    secondaryLabel: latest ? `RAM ${latest.memoryPercent.toFixed(0)}%` : undefined,
    sparklineData: history,
  };
}

function websiteToTile(w: Website): StatusTileData {
  const history = w.checks ? [...w.checks].reverse().map((c) => c.responseMs ?? 0) : [];
  return {
    id: w.id,
    name: w.name,
    subtitle: w.url,
    status: w.monitoringEnabled ? w.status : 'DISABLED',
    href: `/websites/${w.id}`,
    metricLabel: w.lastStatusCode != null ? `${w.lastStatusCode} · ${w.lastResponseMs ?? '—'}ms` : '—',
    secondaryLabel: w.sslDaysRemaining != null ? `SSL ${w.sslDaysRemaining}j` : undefined,
    sparklineData: history,
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));

    const interval = setInterval(() => {
      api.getDashboard().then(setData).catch(console.error);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = () => {
      api.getServers().then(setServers).catch(console.error);
      api.getWebsites().then(setWebsites).catch(console.error);
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!data) return <p className="text-destructive">Erreur de chargement</p>;

  const { summary, recentAlerts, disabledWebsites } = data;
  const serversInAlert = summary.servers.offline + summary.servers.degraded;
  const websitesInAlert = summary.websites.down + summary.websites.degraded;
  const websitesDisabled = summary.websites.disabled ?? 0;

  const tiles: StatusTileData[] = [
    ...servers.map(serverToTile),
    ...websites.map(websiteToTile),
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">Vue d&apos;ensemble de votre infrastructure</p>
      </div>

      <EventTicker />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Serveurs en ligne"
          value={`${summary.servers.online}/${summary.servers.total}`}
          subtitle={serversInAlert > 0 ? `${serversInAlert} en alerte` : 'Tous opérationnels'}
          icon={ServerIcon}
          trend={serversInAlert > 0 ? 'down' : 'up'}
          href={serversInAlert > 0 ? '/servers?filter=alert' : '/servers'}
        />
        <MetricCard
          title="Sites en ligne"
          value={`${summary.websites.up}/${summary.websites.total}`}
          subtitle={websitesInAlert > 0 ? `${websitesInAlert} en alerte` : 'Tous accessibles'}
          icon={Globe}
          trend={websitesInAlert > 0 ? 'down' : 'up'}
          href={websitesInAlert > 0 ? '/websites?filter=alert' : '/websites'}
        />
        <MetricCard
          title="Alertes actives"
          value={summary.activeAlerts}
          subtitle="Non résolues"
          icon={Bell}
          trend={summary.activeAlerts > 0 ? 'down' : 'neutral'}
          href="/alerts"
        />
        <MetricCard
          title="Serveurs dégradés"
          value={summary.servers.degraded}
          subtitle="Ressources élevées"
          icon={AlertTriangle}
          trend={summary.servers.degraded > 0 ? 'down' : 'up'}
          href={summary.servers.degraded > 0 ? '/servers?filter=degraded' : '/servers'}
        />
        <MetricCard
          title="Supervision off"
          value={websitesDisabled}
          subtitle={websitesDisabled > 0 ? 'Sites non surveillés' : 'Tous surveillés'}
          icon={EyeOff}
          trend="neutral"
          href={websitesDisabled > 0 ? '/websites?filter=disabled' : '/websites'}
        />
      </div>

      {websitesDisabled > 0 && (
        <div className="card border-white/10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">Sites avec supervision désactivée</h2>
            <Link href="/websites?filter=disabled" className="text-sm text-primary hover:underline">Gérer</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {disabledWebsites.map((w) => (
              <Link
                key={w.id}
                href={`/websites/${w.id}`}
                className="rounded-lg border border-white/10 bg-secondary/20 px-3 py-1.5 text-sm transition-colors hover:border-primary/30"
              >
                {w.name}
              </Link>
            ))}
            {websitesDisabled > disabledWebsites.length && (
              <span className="self-center text-xs text-muted-foreground">
                +{websitesDisabled - disabledWebsites.length} autre{websitesDisabled - disabledWebsites.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Vue d&apos;ensemble</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {tiles.length} élément{tiles.length > 1 ? 's' : ''}
          </span>
        </div>
        <StatusGrid tiles={tiles} />
      </div>

      {recentAlerts.length > 0 && (
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Alertes récentes</h2>
            <Link href="/alerts" className="text-sm text-primary hover:underline">Voir tout</Link>
          </div>
          <div className="space-y-2">
            {recentAlerts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/5 p-3">
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.message}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{formatDate(a.createdAt)}</span>
                  <SeverityBadge severity={a.severity} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

Note the `Server` icon import is renamed to `ServerIcon` to avoid colliding with the
`Server` type imported from `@/lib/api` in the same file.

- [ ] **Step 3: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: exit code 0, no type errors (this is the step that confirms the `metrics`/
`checks` optional-field additions from Step 1 don't conflict with `ServerDetail`/
`ServerSummary`/`WebsiteDetail`).

- [ ] **Step 4: Commit**

```bash
cd /Users/provectio/Documents/HavetDigital/supervision
git add frontend/src/lib/api.ts "frontend/src/app/(app)/dashboard/page.tsx"
git commit -m "feat: rebuild Dashboard with live status grid and event ticker"
```

---

## Task 9: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the local dev stack**

Run: `cd /Users/provectio/Documents/HavetDigital/supervision && bash scripts/deploy.sh`

This builds and starts Postgres, Redis, backend and frontend via Docker Compose (see
`README.md` "Développement local"). Wait for it to report the stack is up.

- [ ] **Step 2: Log in and open the Dashboard**

Visit `http://localhost:3000`, log in with `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env`.
On `/dashboard`, confirm:
- The page background reads as near-black, not the previous lighter navy.
- The 5 summary metric cards render with mono-font values.
- A "Vue d'ensemble" card shows a dense grid of tiles — one per server and per
  website that exists in the database, each with a name, subtitle, status dot,
  sparkline, and metric line.
- If any server/website is currently OFFLINE/DOWN or DEGRADED, its tile's status dot
  visibly pulses with a colored glow (red for OFFLINE/DOWN, amber for DEGRADED); a
  healthy tile's dot is static.
- A ticker card above the metric cards lists the most recent alert events (empty/
  hidden if there are none yet — trigger one by pausing monitoring on a website via
  `/websites` to confirm it appears).

- [ ] **Step 3: Confirm live refresh**

Leave the Dashboard open for at least 15 seconds without interacting. Open the browser
network tab and confirm `GET /api/servers`, `GET /api/websites`, and `GET
/api/alerts/events` requests fire roughly every 10 seconds (not 30s as before).

- [ ] **Step 4: Confirm no regressions on other pages**

Visit `/servers`, `/websites`, `/alerts`, `/events` — these are unmodified by this
plan, confirm they still load and function (list/create/delete) as before Task 1-8's
CSS token changes (background/radius apply globally via `.card`/`.btn`/etc., so a
quick visual check that nothing looks broken is sufficient; no code in these pages
changed).

- [ ] **Step 5: Stop the stack**

Run: `cd /Users/provectio/Documents/HavetDigital/supervision && docker compose -f docker-compose.yml -f docker-compose.dev.yml down`

No commit for this task — it is a verification checkpoint. If any check in Steps 2-4
fails, fix the relevant task above and re-run this task before considering the plan
complete.
