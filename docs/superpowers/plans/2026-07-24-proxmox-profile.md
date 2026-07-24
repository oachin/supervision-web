# Proxmox Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `PROXMOX` agent profile that monitors hypervisor CPU/RAM/disk, QEMU VMs (inventory + live + historical metrics), and backup jobs with alerts (failed / missing / long-running).

**Architecture:** Extend the existing agent heartbeat path (Go agent → NestJS `AgentService` → Prisma). New tables `ProxmoxVm`, `ProxmoxVmMetric`, `ProxmoxBackup` store Proxmox-specific data. Install uses the same `install.sh` template with profile `proxmox`. UI adds a third profile card and Proxmox sections on the server detail page. Spec: `docs/superpowers/specs/2026-07-24-proxmox-profile-design.md`.

**Tech Stack:** NestJS 10, Prisma 6, PostgreSQL, Go agent, Next.js 15, TypeScript, Tailwind.

## Global Constraints

- V1: QEMU VMs only (no LXC).
- V1: agent on the Proxmox node via local `pvesh` (no remote 8006 API token).
- Backup alert thresholds V1: failed → CRITICAL; warning → WARNING; running > **6 hours** → WARNING; no successful backup for a known VM in **48 hours** → WARNING.
- One platform `Server` = one Proxmox node (no cluster aggregation).
- No new npm dependencies unless unavoidable.
- **No Jest/Vitest in this repo** — verification gates are `npx prisma validate` / `npm run build` (backend + frontend) and manual agent checks. Do not introduce a test runner in this plan.
- Keep Linux/Plesk behavior unchanged.
- French UI copy, matching existing labels style.

## File map

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | Enum `PROXMOX` + 3 models + Server relations |
| `backend/prisma/migrations/…` | SQL migration |
| `backend/src/common/dto.ts` | Agent DTOs + create-server profile |
| `backend/src/agent/agent-install.*` | `install/proxmox` route + slug |
| `backend/src/agent/agent.service.ts` | Sync VMs/metrics/backups + alert hooks |
| `backend/src/servers/servers.controller.ts` | GET proxmox vms / metrics / backups |
| `backend/src/servers/servers.service.ts` | Query helpers + downsample VM metrics |
| `agent/main.go` | Collect Proxmox VMs + backups via `pvesh` |
| `frontend/src/lib/api.ts` | Types + API client methods |
| `frontend/src/app/(app)/servers/page.tsx` | Profile card Proxmox |
| `frontend/src/app/(app)/servers/[id]/page.tsx` | VM table, charts, backups |
| `frontend/src/components/proxmox-*.tsx` | Optional extracted panels if page grows |

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260724150000_proxmox_profile/migration.sql`

**Interfaces:**
- Produces: Prisma models `ProxmoxVm`, `ProxmoxVmMetric`, `ProxmoxBackup`; enum value `AgentProfile.PROXMOX`; `Server.proxmoxVms`, `Server.proxmoxBackups`

- [ ] **Step 1: Extend enum and Server relations**

In `backend/prisma/schema.prisma`, change:

```prisma
enum AgentProfile {
  LINUX
  PLESK
}
```

to:

```prisma
enum AgentProfile {
  LINUX
  PLESK
  PROXMOX
}
```

On `model Server`, add fields (keep existing fields intact):

```prisma
  proxmoxVms     ProxmoxVm[]
  proxmoxBackups ProxmoxBackup[]
```

Append models at end of file (before any trailing blank):

```prisma
model ProxmoxVm {
  id         String           @id @default(uuid())
  serverId   String
  server     Server           @relation(fields: [serverId], references: [id], onDelete: Cascade)
  vmid       Int
  name       String
  status     String
  cpus       Int
  maxmemMb   Float
  maxdiskGb  Float
  lastSeenAt DateTime         @default(now())
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt
  metrics    ProxmoxVmMetric[]

  @@unique([serverId, vmid])
  @@index([serverId])
}

model ProxmoxVmMetric {
  id          String    @id @default(uuid())
  vmId        String
  vm          ProxmoxVm @relation(fields: [vmId], references: [id], onDelete: Cascade)
  cpuPercent  Float
  memUsedMb   Float
  memTotalMb  Float
  collectedAt DateTime  @default(now())

  @@index([vmId, collectedAt])
}

model ProxmoxBackup {
  id          String    @id @default(uuid())
  serverId    String
  server      Server    @relation(fields: [serverId], references: [id], onDelete: Cascade)
  upid        String
  vmid        Int?
  vmName      String?
  status      String
  startedAt   DateTime
  finishedAt  DateTime?
  durationSec Int?
  error       String?
  sizeBytes   BigInt?
  collectedAt DateTime  @default(now())

  @@unique([serverId, upid])
  @@index([serverId, startedAt])
  @@index([serverId, status])
}
```

- [ ] **Step 2: Write migration SQL**

Create `backend/prisma/migrations/20260724150000_proxmox_profile/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "AgentProfile" ADD VALUE 'PROXMOX';

-- CreateTable
CREATE TABLE "ProxmoxVm" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "vmid" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cpus" INTEGER NOT NULL,
    "maxmemMb" DOUBLE PRECISION NOT NULL,
    "maxdiskGb" DOUBLE PRECISION NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxmoxVm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProxmoxVmMetric" (
    "id" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "memUsedMb" DOUBLE PRECISION NOT NULL,
    "memTotalMb" DOUBLE PRECISION NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxmoxVmMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProxmoxBackup" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "upid" TEXT NOT NULL,
    "vmid" INTEGER,
    "vmName" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "error" TEXT,
    "sizeBytes" BIGINT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxmoxBackup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProxmoxVm_serverId_vmid_key" ON "ProxmoxVm"("serverId", "vmid");
CREATE INDEX "ProxmoxVm_serverId_idx" ON "ProxmoxVm"("serverId");
CREATE INDEX "ProxmoxVmMetric_vmId_collectedAt_idx" ON "ProxmoxVmMetric"("vmId", "collectedAt");
CREATE UNIQUE INDEX "ProxmoxBackup_serverId_upid_key" ON "ProxmoxBackup"("serverId", "upid");
CREATE INDEX "ProxmoxBackup_serverId_startedAt_idx" ON "ProxmoxBackup"("serverId", "startedAt");
CREATE INDEX "ProxmoxBackup_serverId_status_idx" ON "ProxmoxBackup"("serverId", "status");

ALTER TABLE "ProxmoxVm" ADD CONSTRAINT "ProxmoxVm_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProxmoxVmMetric" ADD CONSTRAINT "ProxmoxVmMetric_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "ProxmoxVm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProxmoxBackup" ADD CONSTRAINT "ProxmoxBackup_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Validate schema**

Run:

```bash
cd backend && npx prisma validate && npx prisma generate
```

Expected: schema valid, client generated with `proxmoxVm` / `proxmoxBackup` delegates.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260724150000_proxmox_profile/
git commit -m "feat(prisma): add PROXMOX profile and Proxmox VM/backup tables"
```

---

### Task 2: Agent install route + DTOs for Proxmox payload

**Files:**
- Modify: `backend/src/agent/agent-install.service.ts`
- Modify: `backend/src/agent/agent-install.controller.ts`
- Modify: `backend/src/common/dto.ts`
- Modify: `backend/src/servers/servers.service.ts` (profile default only if needed — already uses `dto.profile`)

**Interfaces:**
- Consumes: `AgentProfile.PROXMOX` from Task 1
- Produces: `GET /agent/install/proxmox`, DTO types `AgentProxmoxVmDto`, `AgentProxmoxBackupDto`, fields on `AgentMetricsDto`

- [ ] **Step 1: Extend install service slug helpers**

In `agent-install.service.ts`, change method signatures from `'linux' | 'plesk'` to `'linux' | 'plesk' | 'proxmox'` everywhere (`buildInstallUrl`, `buildWgetCommand`, `profileToSlug`, `getInstallScript`).

`profileToSlug`:

```typescript
profileToSlug(profile: AgentProfile): 'linux' | 'plesk' | 'proxmox' {
  if (profile === 'PLESK') return 'plesk';
  if (profile === 'PROXMOX') return 'proxmox';
  return 'linux';
}
```

In `getInstallScript`, map:

```typescript
const expected: AgentProfile =
  profile === 'plesk' ? 'PLESK' : profile === 'proxmox' ? 'PROXMOX' : 'LINUX';
```

- [ ] **Step 2: Add controller route**

In `agent-install.controller.ts`:

```typescript
@Get('install/proxmox')
installProxmox(@Query('key') key: string, @Res() res: Response) {
  return this.serveInstall('proxmox', key, res);
}
```

Update `serveInstall` profile union to include `'proxmox'`.

- [ ] **Step 3: Add DTOs**

In `backend/src/common/dto.ts`, allow create server profile:

```typescript
@IsIn(['LINUX', 'PLESK', 'PROXMOX'])
profile?: 'LINUX' | 'PLESK' | 'PROXMOX';
```

Add nested DTOs and fields on `AgentMetricsDto`:

```typescript
export class AgentProxmoxVmDto {
  @IsInt()
  vmid!: number;

  @IsString()
  name!: string;

  @IsString()
  status!: string;

  @IsInt()
  cpus!: number;

  @IsNumber()
  maxmemMb!: number;

  @IsNumber()
  maxdiskGb!: number;

  @IsOptional()
  @IsNumber()
  cpuPercent?: number;

  @IsOptional()
  @IsNumber()
  memUsedMb?: number;
}

export class AgentProxmoxBackupDto {
  @IsString()
  upid!: string;

  @IsOptional()
  @IsInt()
  vmid?: number;

  @IsOptional()
  @IsString()
  vmName?: string;

  @IsString()
  status!: string; // ok | failed | warning | running

  @IsString()
  startedAt!: string; // ISO

  @IsOptional()
  @IsString()
  finishedAt?: string;

  @IsOptional()
  @IsInt()
  durationSec?: number;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsNumber()
  sizeBytes?: number;
}
```

On `AgentMetricsDto`:

```typescript
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentProxmoxVmDto)
  proxmoxVms?: AgentProxmoxVmDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentProxmoxBackupDto)
  proxmoxBackups?: AgentProxmoxBackupDto[];
```

Ensure `ValidateNested`, `Type`, `IsArray`, `IsOptional`, `IsInt`, `IsNumber`, `IsString` imports already present in the file.

- [ ] **Step 4: Build backend**

```bash
cd backend && npm run build
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add backend/src/agent/agent-install.service.ts backend/src/agent/agent-install.controller.ts backend/src/common/dto.ts
git commit -m "feat(agent): add proxmox install route and heartbeat DTOs"
```

---

### Task 3: Go agent — collect QEMU VMs + backups via pvesh

**Files:**
- Modify: `agent/main.go`

**Interfaces:**
- Consumes: env `SUPERVISION_PROFILE=proxmox`
- Produces: JSON fields `proxmoxVms`, `proxmoxBackups` on metrics POST body matching Task 2 DTOs

- [ ] **Step 1: Extend MetricsPayload**

In `agent/main.go`, add types and fields:

```go
type ProxmoxVmPayload struct {
	VMID      int     `json:"vmid"`
	Name      string  `json:"name"`
	Status    string  `json:"status"`
	Cpus      int     `json:"cpus"`
	MaxmemMb  float64 `json:"maxmemMb"`
	MaxdiskGb float64 `json:"maxdiskGb"`
	CPUPercent *float64 `json:"cpuPercent,omitempty"`
	MemUsedMb  *float64 `json:"memUsedMb,omitempty"`
}

type ProxmoxBackupPayload struct {
	UPID        string  `json:"upid"`
	VMID        *int    `json:"vmid,omitempty"`
	VMName      string  `json:"vmName,omitempty"`
	Status      string  `json:"status"`
	StartedAt   string  `json:"startedAt"`
	FinishedAt  string  `json:"finishedAt,omitempty"`
	DurationSec *int    `json:"durationSec,omitempty"`
	Error       string  `json:"error,omitempty"`
	SizeBytes   *int64  `json:"sizeBytes,omitempty"`
}
```

Add to `MetricsPayload`:

```go
	ProxmoxVMs     []ProxmoxVmPayload     `json:"proxmoxVms,omitempty"`
	ProxmoxBackups []ProxmoxBackupPayload `json:"proxmoxBackups,omitempty"`
```

- [ ] **Step 2: Implement pvesh helpers + collectors**

Add helpers (same file is fine for V1):

```go
func pveshJSON(args ...string) ([]byte, error) {
	cmdArgs := append([]string{"get"}, args...)
	cmdArgs = append(cmdArgs, "--output-format", "json")
	return exec.Command("pvesh", cmdArgs...).Output()
}

func localPveNode() (string, error) {
	out, err := exec.Command("hostname", "-s").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
```

Implement `collectProxmoxVms(node string) []ProxmoxVmPayload`:
1. `pveshJSON("/nodes/"+node+"/qemu")` → list of maps with `vmid`, `name`, `status`, `cpus`, `maxmem`, `maxdisk`
2. For each VM with `status == "running"`, call `pveshJSON(fmt.Sprintf("/nodes/%s/qemu/%d/status/current", node, vmid))` for `cpu` (fraction 0–1 → *100) and `mem` (bytes → MB)
3. Convert `maxmem` bytes → MB, `maxdisk` bytes → GB

Implement `collectProxmoxBackups(node string) []ProxmoxBackupPayload`:
1. `pveshJSON("/nodes/"+node+"/tasks", "--typefilter", "vzdump")` — if `--typefilter` unsupported on older PVE, fetch `/nodes/{node}/tasks` and filter `type == "vzdump"` in Go
2. Limit to last ~50 tasks
3. Map exitstatus: empty/`OK`/`ok` → `ok`; contains `warn` → `warning`; non-empty failure → `failed`; no `endtime` → `running`
4. `startedAt` / `finishedAt` from unix `starttime` / `endtime` as RFC3339 UTC
5. Parse `vmid` from task `id` field when present (`vzdump:100` style) or from `status` text; leave nil if unknown
6. Put failure text into `error` when failed

- [ ] **Step 3: Hook into collectMetrics**

After existing metric collection, when `cfg.Profile == "proxmox"` (or `pvesh` exists):

```go
	if cfg.Profile == "proxmox" {
		if node, err := localPveNode(); err == nil {
			m.ProxmoxVMs = collectProxmoxVms(node)
			m.ProxmoxBackups = collectProxmoxBackups(node)
		} else {
			log.Printf("Proxmox: impossible de déterminer le nœud: %v", err)
		}
	}
```

For disk on Proxmox nodes, prefer summing local storage via `pveshJSON("/nodes/"+node+"/storage")` where `active==1` and `type` in `dir,lvm,lvmthin,zfspool` — use `used`/`total`/`avail` fields. Fallback to existing `/` disk stats if pvesh storage fails.

- [ ] **Step 4: Compile agent**

```bash
cd agent && go build -o /tmp/supervision-agent .
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add agent/main.go
git commit -m "feat(agent): collect Proxmox QEMU VMs and vzdump tasks"
```

---

### Task 4: Backend sync + backup alerts

**Files:**
- Modify: `backend/src/agent/agent.service.ts`

**Interfaces:**
- Consumes: `dto.proxmoxVms`, `dto.proxmoxBackups`; Prisma models from Task 1
- Produces: upserted rows; alerts titled with prefixes `Backup Proxmox` / `Backup Proxmox manquant` / `Backup Proxmox long`

Constants at top of file:

```typescript
const PROXMOX_BACKUP_STALE_MS = 48 * 60 * 60 * 1000;
const PROXMOX_BACKUP_LONG_MS = 6 * 60 * 60 * 1000;
```

- [ ] **Step 1: Call sync after metric insert**

In `recordMetrics`, after Plesk blocks:

```typescript
    if (server.profile === 'PROXMOX') {
      if (dto.proxmoxVms?.length) {
        await this.syncProxmoxVms(server.id, dto.proxmoxVms);
      }
      if (dto.proxmoxBackups?.length) {
        await this.syncProxmoxBackups(server, dto.proxmoxBackups);
      }
      await this.evaluateProxmoxBackupAlerts(server);
    }
```

- [ ] **Step 2: Implement syncProxmoxVms**

```typescript
  private async syncProxmoxVms(serverId: string, vms: NonNullable<AgentMetricsDto['proxmoxVms']>) {
    const now = new Date();
    for (const vm of vms) {
      const row = await this.prisma.proxmoxVm.upsert({
        where: { serverId_vmid: { serverId, vmid: vm.vmid } },
        create: {
          serverId,
          vmid: vm.vmid,
          name: vm.name,
          status: vm.status,
          cpus: vm.cpus,
          maxmemMb: vm.maxmemMb,
          maxdiskGb: vm.maxdiskGb,
          lastSeenAt: now,
        },
        update: {
          name: vm.name,
          status: vm.status,
          cpus: vm.cpus,
          maxmemMb: vm.maxmemMb,
          maxdiskGb: vm.maxdiskGb,
          lastSeenAt: now,
        },
      });

      if (vm.status === 'running' && vm.cpuPercent != null && vm.memUsedMb != null) {
        await this.prisma.proxmoxVmMetric.create({
          data: {
            vmId: row.id,
            cpuPercent: vm.cpuPercent,
            memUsedMb: vm.memUsedMb,
            memTotalMb: vm.maxmemMb,
          },
        });
      }
    }
  }
```

- [ ] **Step 3: Implement syncProxmoxBackups**

Upsert by `serverId_upid`. Parse `startedAt`/`finishedAt` with `new Date(...)`. Store `sizeBytes` as `BigInt(Math.trunc(sizeBytes))` when provided.

- [ ] **Step 4: Implement evaluateProxmoxBackupAlerts**

Logic:
1. Load backups for server where `startedAt >= now - 7 days` OR `status === 'running'`
2. For each backup with `status === 'failed'`: `alerts.create({ title: \`Backup Proxmox échoué: ${server.name} VM ${vmid ?? '?'}\`, message: error ?? 'Job vzdump en échec', severity: 'CRITICAL', serverId })`
3. For `warning`: same with WARNING
4. For `running` with `Date.now() - startedAt > PROXMOX_BACKUP_LONG_MS`: WARNING title `Backup Proxmox trop long: …`
5. For each `ProxmoxVm` on server: find latest backup with `status === 'ok'` and matching `vmid`. If none in last 48h **and** there exists at least one historical backup for that vmid ever (or any backup for server in DB): WARNING `Backup Proxmox manquant: …`
6. When a failed backup later has a matching successful newer backup for same vmid, call `alerts.onIssueResolved({ serverId, titleContains: 'Backup Proxmox échoué' })` carefully — prefer titleContains including VM id when possible

Import `AgentMetricsDto` already used.

- [ ] **Step 5: Build**

```bash
cd backend && npm run build
```

Expected: success.

- [ ] **Step 6: Commit**

```bash
git add backend/src/agent/agent.service.ts
git commit -m "feat(agent): sync Proxmox VMs/backups and raise backup alerts"
```

---

### Task 5: Read APIs for VMs, VM metrics, backups

**Files:**
- Modify: `backend/src/servers/servers.service.ts`
- Modify: `backend/src/servers/servers.controller.ts`

**Interfaces:**
- Produces:
  - `GET /servers/:id/proxmox/vms` → `ProxmoxVm[]`
  - `GET /servers/:id/proxmox/vms/:vmid/metrics?from=&to=` → downsampled metrics (max 500 points, same pattern as `getMetrics`)
  - `GET /servers/:id/proxmox/backups?limit=50` → `ProxmoxBackup[]` (serialize `sizeBytes` as string or number)

- [ ] **Step 1: Service methods**

```typescript
  async getProxmoxVms(serverId: string) {
    await this.ensureServer(serverId);
    return this.prisma.proxmoxVm.findMany({
      where: { serverId },
      orderBy: { vmid: 'asc' },
    });
  }

  async getProxmoxVmMetrics(serverId: string, vmid: number, from?: Date, to?: Date) {
    await this.ensureServer(serverId);
    const vm = await this.prisma.proxmoxVm.findUnique({
      where: { serverId_vmid: { serverId, vmid } },
    });
    if (!vm) throw new NotFoundException('VM introuvable');

    const metrics = await this.prisma.proxmoxVmMetric.findMany({
      where: {
        vmId: vm.id,
        collectedAt: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { collectedAt: 'asc' },
    });
    return this.downsample(metrics); // reuse private downsample if extracted; else duplicate max-500 logic from getMetrics
  }

  async getProxmoxBackups(serverId: string, limit = 50) {
    await this.ensureServer(serverId);
    const rows = await this.prisma.proxmoxBackup.findMany({
      where: { serverId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return rows.map((r) => ({
      ...r,
      sizeBytes: r.sizeBytes != null ? r.sizeBytes.toString() : null,
    }));
  }
```

If `ensureServer` does not exist, inline `findUnique` + `NotFoundException` like other methods in the file.

Extract downsample to a private method shared with `getMetrics` if not already shared (keep DRY).

- [ ] **Step 2: Controller routes**

Place **before** `@Get(':id')` is wrong for Nest order — put specific routes **before** parameterized siblings that could clash. Current file has `@Get(':id/metrics')` already. Add:

```typescript
  @Get(':id/proxmox/vms')
  getProxmoxVms(@Param('id') id: string) {
    return this.servers.getProxmoxVms(id);
  }

  @Get(':id/proxmox/vms/:vmid/metrics')
  getProxmoxVmMetrics(
    @Param('id') id: string,
    @Param('vmid') vmid: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.servers.getProxmoxVmMetrics(
      id,
      parseInt(vmid, 10),
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get(':id/proxmox/backups')
  getProxmoxBackups(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.servers.getProxmoxBackups(id, limit ? parseInt(limit, 10) : 50);
  }
```

- [ ] **Step 3: Build**

```bash
cd backend && npm run build
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add backend/src/servers/servers.service.ts backend/src/servers/servers.controller.ts
git commit -m "feat(servers): expose Proxmox VMs, metrics, and backups APIs"
```

---

### Task 6: Frontend API client + create-server Proxmox card

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/(app)/servers/page.tsx`

**Interfaces:**
- Consumes: Task 5 endpoints
- Produces: `api.getProxmoxVms`, `getProxmoxVmMetrics`, `getProxmoxBackups`; UI can create `PROXMOX` servers

- [ ] **Step 1: Types + methods in api.ts**

Extend profile unions:

```typescript
profile: 'LINUX' | 'PLESK' | 'PROXMOX';
```

Add:

```typescript
export interface ProxmoxVm {
  id: string;
  serverId: string;
  vmid: number;
  name: string;
  status: string;
  cpus: number;
  maxmemMb: number;
  maxdiskGb: number;
  lastSeenAt: string;
}

export interface ProxmoxVmMetric {
  id: string;
  cpuPercent: number;
  memUsedMb: number;
  memTotalMb: number;
  collectedAt: string;
}

export interface ProxmoxBackup {
  id: string;
  upid: string;
  vmid: number | null;
  vmName: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationSec: number | null;
  error: string | null;
  sizeBytes: string | null;
}
```

Methods on `ApiClient`:

```typescript
  getProxmoxVms(serverId: string) {
    return this.fetch<ProxmoxVm[]>(`/servers/${serverId}/proxmox/vms`);
  }
  getProxmoxVmMetrics(serverId: string, vmid: number, from?: string, to?: string) {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return this.fetch<ProxmoxVmMetric[]>(
      `/servers/${serverId}/proxmox/vms/${vmid}/metrics${qs ? `?${qs}` : ''}`,
    );
  }
  getProxmoxBackups(serverId: string, limit = 50) {
    return this.fetch<ProxmoxBackup[]>(`/servers/${serverId}/proxmox/backups?limit=${limit}`);
  }
```

- [ ] **Step 2: servers/page.tsx profile UI**

Update `profileLabels`:

```typescript
const profileLabels: Record<string, string> = {
  LINUX: 'Linux',
  PLESK: 'Plesk',
  PROXMOX: 'Proxmox',
};
```

Extend form type to include `'PROXMOX'`. Add a third card next to Plesk:

```tsx
<label className={`card cursor-pointer border-2 p-4 transition-colors ${form.profile === 'PROXMOX' ? 'border-primary bg-primary/5' : 'border-white/10 hover:border-white/20'}`}>
  <input type="radio" name="profile" className="sr-only" value="PROXMOX" checked={form.profile === 'PROXMOX'} onChange={() => setForm({ ...form, profile: 'PROXMOX' })} />
  <div className="font-semibold">Proxmox</div>
  <p className="mt-1 text-xs text-muted-foreground">Hyperviseur — VMs QEMU, backups vzdump</p>
</label>
```

Install help text when `installInfo.profile === 'PROXMOX'`: note that the agent must run as root on the Proxmox node with `pvesh` available.

- [ ] **Step 3: Build frontend**

```bash
cd frontend && npm run build
```

Expected: success (server detail page may still lack Proxmox UI — that is Task 7).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/app/(app)/servers/page.tsx
git commit -m "feat(ui): add Proxmox profile to server creation and API client"
```

---

### Task 7: Server detail page — VMs, charts, backups

**Files:**
- Modify: `frontend/src/app/(app)/servers/[id]/page.tsx`
- Create (if page exceeds ~800 lines of new JSX): `frontend/src/components/proxmox-vms-panel.tsx`, `frontend/src/components/proxmox-backups-panel.tsx`

**Interfaces:**
- Consumes: API methods from Task 6; existing chart patterns on the same page for host metrics

- [ ] **Step 1: Load Proxmox data when profile is PROXMOX**

After server load:

```typescript
const [proxmoxVms, setProxmoxVms] = useState<ProxmoxVm[]>([]);
const [proxmoxBackups, setProxmoxBackups] = useState<ProxmoxBackup[]>([]);
const [selectedVmid, setSelectedVmid] = useState<number | null>(null);
const [vmMetrics, setVmMetrics] = useState<ProxmoxVmMetric[]>([]);
const [vmRange, setVmRange] = useState<'1h' | '24h' | '7d'>('24h');

useEffect(() => {
  if (server?.profile !== 'PROXMOX') return;
  Promise.all([
    api.getProxmoxVms(server.id),
    api.getProxmoxBackups(server.id),
  ]).then(([vms, backups]) => {
    setProxmoxVms(vms);
    setProxmoxBackups(backups);
  }).catch(console.error);
}, [server?.id, server?.profile]);
```

When `selectedVmid` or `vmRange` changes, compute `from` ISO and call `getProxmoxVmMetrics`.

- [ ] **Step 2: Header label**

Replace profile display:

```tsx
Profil : {server.profile === 'PLESK' ? 'Plesk' : server.profile === 'PROXMOX' ? 'Proxmox' : 'Linux'}
```

- [ ] **Step 3: VMs table + selection**

Below host charts, if `PROXMOX`:

| VMID | Nom | État | vCPU | RAM | Disque |
|------|-----|------|------|-----|--------|

Row click sets `selectedVmid`. Status badge: green `running`, muted `stopped`, amber other.

- [ ] **Step 4: VM performance charts**

If `selectedVmid` set, show range buttons (`1h`, `24h`, `7d`) and two charts (CPU %, RAM used/total %) using the same chart library already on the page (Recharts). Empty state: « Sélectionnez une VM ».

- [ ] **Step 5: Backups table**

Columns: Début, VM, Statut, Durée, Erreur. Status colors: `ok` success, `failed` destructive, `warning`/`running` warning.

- [ ] **Step 6: Build**

```bash
cd frontend && npm run build
```

Expected: success.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/(app)/servers/[id]/page.tsx frontend/src/components/proxmox-*.tsx
git commit -m "feat(ui): Proxmox VM inventory, history charts, and backups panel"
```

---

### Task 8: README note + end-to-end smoke checklist

**Files:**
- Modify: `README.md` (short section under Architecture de supervision)

- [ ] **Step 1: Document Proxmox row in the architecture table**

Add:

```markdown
| **Serveur Proxmox** | Agent | Métriques nœud + VMs QEMU + jobs backup vzdump |
```

- [ ] **Step 2: Manual smoke (on a real Proxmox node after deploy)**

1. Create server profile Proxmox in UI → copy wget install command  
2. Run install on node → `systemctl status havet-supervision-agent` active  
3. Within 2 minutes: server ONLINE, VMs listed  
4. Select a running VM → charts populate after a few heartbeats  
5. Confirm backups list shows recent vzdump tasks  
6. (Optional) fail a test backup or insert a failed task → CRITICAL alert appears  

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Proxmox agent profile"
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Enum + install `proxmox` | 1, 2 |
| Agent pvesh VMs + backups | 3 |
| Tables Vm / Metric / Backup | 1 |
| Sync + alerts (failed/warn/long/stale 48h) | 4 |
| Read APIs + downsample | 5 |
| UI create + detail graphs/backups | 6, 7 |
| QEMU only / no LXC / no PBS remote | 3 (no LXC code), documented in constraints |
| Linux/Plesk unchanged | all tasks additive |
| README | 8 |

## Placeholder scan

No TBD / “implement later” steps. Verification uses `npm run build` / `go build` because the repo has no unit-test runner (same convention as `2026-07-11-noc-design-system-dashboard.md`).
