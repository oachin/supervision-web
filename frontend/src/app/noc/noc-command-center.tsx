'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type NocHost, type NocState } from '@/lib/api';
import { formatUptime } from '@/lib/utils';
import './noc-command-center.css';

const POLL_MS = 30_000;
const SEV_LABEL = {
  crit: 'CRITICAL',
  warn: 'WARNING',
  ssl: 'EXPIRATION SSL',
  info: 'INFO',
  ok: 'RESOLU',
} as const;

function SeverityTags({
  critical,
  warning,
  ssl = 0,
  info = 0,
}: {
  critical: number;
  warning: number;
  ssl?: number;
  info?: number;
}) {
  if (critical <= 0 && warning <= 0 && ssl <= 0 && info <= 0) return null;
  return (
    <div className="sev-tags">
      {critical > 0 && (
        <span className="sev-tag crit">CRITICAL · {critical}</span>
      )}
      {warning > 0 && (
        <span className="sev-tag warn">WARNING · {warning}</span>
      )}
      {ssl > 0 && (
        <span className="sev-tag ssl">EXPIRATION SSL · {ssl}</span>
      )}
      {info > 0 && <span className="sev-tag info">INFO · {info}</span>}
    </div>
  );
}

function formatIncidentDuration(sinceIso: string | null, now: number) {
  if (!sinceIso) return '—';
  const sec = Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 1000));
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatClock(d: Date) {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatAlertTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function Sparkline({
  series,
  color,
  height = 34,
}: {
  series: number[];
  color: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 120;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const data = series.length >= 2 ? series : [0, 0];
    const min = Math.min(...data);
    const max = Math.max(...data);
    const r = max - min || 1;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - 4 - ((v - min) / r) * (h - 8);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = color.replace('rgb(', 'rgba(').replace(')', ',0.12)');
    if (color.startsWith('#')) {
      ctx.fillStyle = `${color}20`;
    }
    ctx.fill();
  }, [series, color, height]);

  return <canvas ref={canvasRef} style={{ width: '100%', height }} />;
}

function Histo24h({ data }: { data: NocState['history24h'] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const total = useMemo(
    () => data.reduce((acc, b) => acc + b.crit + b.warn, 0),
    [data],
  );

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 360;
    const h = 120;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(1, ...data.map((b) => b.crit + b.warn));
    const bw = w / data.length - 4;
    data.forEach((b, i) => {
      const x = i * (w / data.length) + 2;
      const ch = (b.crit / max) * (h - 18);
      const wh = (b.warn / max) * (h - 18);
      ctx.fillStyle = 'rgba(245,158,11,.85)';
      ctx.fillRect(x, h - 14 - wh, bw, wh);
      ctx.fillStyle = 'rgba(244,63,94,.9)';
      ctx.fillRect(x, h - 14 - wh - ch, bw, ch);
      if (i % 4 === 0) {
        ctx.fillStyle = '#6b7d99';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(String(b.hour).padStart(2, '0') + 'h', x, h - 2);
      }
    });
  }, [data]);

  return (
    <>
      <canvas ref={canvasRef} style={{ width: '100%', height: 120, marginTop: 6 }} />
      <div className="legend">
        <span>
          <i style={{ background: 'var(--crit)' }} />
          Critiques
        </span>
        <span>
          <i style={{ background: 'var(--warn)' }} />
          Avertissements
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)' }}>
          {total} alertes / 24 h
        </span>
      </div>
    </>
  );
}

function SegmentBar({ host }: { host: NocHost }) {
  const sites = host.sites;
  const vms = host.vms;
  if (host.type === 'hyperviseur' && vms) {
    const total = Math.max(vms.total, 1);
    const okPct = (vms.ok / total) * 100;
    const stoppedPct = (vms.stopped / total) * 100;
    const other = Math.max(0, 100 - okPct - stoppedPct);
    return (
      <div className="seg-wrap">
        <div className="seg-bar">
          {okPct > 0 && <div style={{ width: `${okPct}%`, background: 'var(--ok)' }} />}
          {stoppedPct > 0 && <div style={{ width: `${stoppedPct}%`, background: 'var(--off)' }} />}
          {other > 0 && <div style={{ width: `${other}%`, background: 'var(--warn)' }} />}
        </div>
        <div className="seg-legend">
          <span>
            <i style={{ background: 'var(--ok)' }} />
            <b>{vms.ok}</b> running
          </span>
          <span>
            <i style={{ background: 'var(--off)' }} />
            <b>{vms.stopped}</b> stopped
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <b>{vms.total}</b> VMs
          </span>
        </div>
      </div>
    );
  }
  if (!sites) return null;
  const total = Math.max(sites.total + sites.off, 1);
  const pct = (n: number) => (n / total) * 100;
  return (
    <div className="seg-wrap">
      <div className="seg-bar">
        {sites.ok > 0 && <div style={{ width: `${pct(sites.ok)}%`, background: 'var(--ok)' }} />}
        {sites.maintenance > 0 && (
          <div style={{ width: `${pct(sites.maintenance)}%`, background: 'var(--maint)' }} />
        )}
        {sites.degraded > 0 && (
          <div style={{ width: `${pct(sites.degraded)}%`, background: 'var(--warn)' }} />
        )}
        {sites.down > 0 && <div style={{ width: `${pct(sites.down)}%`, background: 'var(--crit)' }} />}
        {sites.off > 0 && <div style={{ width: `${pct(sites.off)}%`, background: 'var(--off)' }} />}
      </div>
      <div className="seg-legend">
        <span>
          <i style={{ background: 'var(--ok)' }} />
          <b>{sites.ok}</b> OK
        </span>
        {sites.maintenance > 0 && (
          <span>
            <i style={{ background: 'var(--maint)' }} />
            <b>{sites.maintenance}</b> maint.
          </span>
        )}
        {sites.degraded > 0 && (
          <span>
            <i style={{ background: 'var(--warn)' }} />
            <b>{sites.degraded}</b> dégradés
          </span>
        )}
        {sites.down > 0 && (
          <span>
            <i style={{ background: 'var(--crit)' }} />
            <b>{sites.down}</b> down
          </span>
        )}
        {sites.off > 0 && (
          <span>
            <i style={{ background: 'var(--off)' }} />
            <b>{sites.off}</b> off
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <b>{sites.total}</b> sites
        </span>
      </div>
    </div>
  );
}

function CriticalHostCard({ host, now }: { host: NocHost; now: number }) {
  const cpuColor =
    (host.metrics.cpu ?? 0) >= 85 ? 'rgb(244,63,94)' : 'rgb(245,158,11)';
  const ramColor =
    (host.metrics.ram ?? 0) >= 85 ? 'rgb(244,63,94)' : 'rgb(245,158,11)';
  const latColor =
    (host.metrics.latency_ms ?? 0) >= 500 ? 'rgb(244,63,94)' : 'rgb(16,185,129)';

  return (
    <div className={`host-card ${host.status === 'degraded' ? 'degraded' : ''}`}>
      <div className="host-head">
        <div className="host-title">
          <div className="name">{host.name}</div>
          {host.tags?.length > 0 && (
            <div className="host-tags">
              {host.tags.map((tag) => (
                <span key={tag} className="host-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={`sev-tag ${host.status === 'critical' ? 'crit' : 'warn'}`}>
          {host.status === 'critical' ? 'CRITICAL' : 'WARNING'}
        </div>
        <div className="since">{formatIncidentDuration(host.incidentSince, now)}</div>
      </div>
      <SegmentBar host={host} />
      {host.downSites.length > 0 && (
        <div className="down-sites">
          {host.downSites.slice(0, 6).map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))}
          {host.downSites.length > 6 && (
            <span className="chip">+{host.downSites.length - 6} down</span>
          )}
        </div>
      )}
      <div className="host-metrics">
        <div className="metric">
          <div className="m-label">
            CPU <b>{host.metrics.cpu != null ? `${Math.round(host.metrics.cpu)}%` : '—'}</b>
          </div>
          <Sparkline series={host.metrics.series.cpu} color={cpuColor} />
        </div>
        <div className="metric">
          <div className="m-label">
            RAM <b>{host.metrics.ram != null ? `${Math.round(host.metrics.ram)}%` : '—'}</b>
          </div>
          <Sparkline series={host.metrics.series.ram} color={ramColor} />
        </div>
        <div className="metric">
          <div className="m-label">
            Latence{' '}
            <b>
              {host.metrics.latency_ms != null ? `${host.metrics.latency_ms}ms` : '—'}
            </b>
          </div>
          <Sparkline
            series={
              host.metrics.latency_ms != null
                ? Array.from({ length: 20 }, () => host.metrics.latency_ms!)
                : [0, 0]
            }
            color={latColor}
          />
        </div>
      </div>
    </div>
  );
}

function OkHostCard({ host }: { host: NocHost }) {
  const short = host.name.replace(/\.havetdigital\.app$/i, '');
  const count =
    host.type === 'hyperviseur' && host.vms
      ? `${host.vms.ok}/${host.vms.total}`
      : host.sites
        ? `${host.sites.ok}/${host.sites.total}`
        : '—';
  const unit = host.type === 'hyperviseur' ? 'VMs' : 'sites';
  const up =
    host.type === 'hyperviseur'
      ? `CPU ${host.metrics.cpu != null ? Math.round(host.metrics.cpu) : '—'} % · RAM ${
          host.metrics.ram != null ? Math.round(host.metrics.ram) : '—'
        } %`
      : `up ${
          host.metrics.uptimeSeconds != null
            ? formatUptime(host.metrics.uptimeSeconds)
            : '—'
        } · ${host.metrics.latency_ms != null ? `${host.metrics.latency_ms} ms` : '—'}`;

  return (
    <div className={`ok-card ${host.status === 'degraded' ? 'warn' : ''}`}>
      <div className="name">
        <i />
        {short}
      </div>
      {host.tags?.length > 0 && (
        <div className="host-tags compact">
          {host.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="host-tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="stat">
        {count}
        <span>{unit}</span>
      </div>
      <Sparkline
        series={host.metrics.series.cpu.length ? host.metrics.series.cpu : [20, 25, 22]}
        color={host.status === 'degraded' ? 'rgb(245,158,11)' : 'rgb(16,185,129)'}
        height={22}
      />
      <div className="up">{up}</div>
    </div>
  );
}

function PanelFallback({ label }: { label: string }) {
  return <div className="unavailable">{label}</div>;
}

export function NocCommandCenter() {
  const [state, setState] = useState<NocState | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [refreshIn, setRefreshIn] = useState(30);

  async function load() {
    try {
      const data = await api.getNocState();
      setState(data);
      setError(false);
      setLastSyncAt(Date.now());
      setRefreshIn(30);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    const keepAlive = () => {
      void api.keepAlive().catch(() => {});
    };
    keepAlive();
    const interval = setInterval(keepAlive, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setRefreshIn((s) => (s <= 0 ? 30 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        window.location.href = '/dashboard';
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const clock = new Date(now);
  const syncAge =
    lastSyncAt != null ? Math.max(0, Math.floor((now - lastSyncAt) / 1000)) : null;

  const incidentHosts = state?.hosts.filter((h) => h.status !== 'ok') ?? [];
  const okHosts = state?.hosts.filter((h) => h.status === 'ok') ?? [];
  const kpis = state?.kpis;
  const sitePct =
    kpis && kpis.sites.total > 0
      ? ((kpis.sites.ok / kpis.sites.total) * 100).toFixed(1).replace('.', ',')
      : null;

  const bannerCrit = state?.global.criticalAlerts ?? 0;
  const bannerWarn = state?.global.warningAlerts ?? 0;
  const bannerSsl = state?.global.sslAlerts ?? 0;
  const bannerLevel =
    !state
      ? null
      : state.global.criticalHosts > 0 || bannerCrit > 0
        ? 'crit'
        : bannerWarn > 0 || bannerSsl > 0
          ? 'warn'
          : 'ok';
  const bannerLabel =
    bannerLevel === 'crit'
      ? 'INCIDENT EN COURS'
      : bannerLevel === 'warn'
        ? 'AVERTISSEMENTS ACTIFS'
        : 'Tout est opérationnel';

  if (!state && !error) {
    return (
      <div className="noc-cc" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="unavailable">Chargement du NOC…</div>
      </div>
    );
  }

  return (
    <div className="noc-cc">
      <header>
        <div className="brand">
          <div className="logo">H</div>
          <div>
            <h1>Centre de Supervision</h1>
            <span>NOC · Vue murale</span>
          </div>
        </div>

        {state && bannerLevel ? (
          <div
            className={`global-status ${bannerLevel === 'ok' ? 'ok' : bannerLevel === 'warn' ? 'warn' : ''}`}
          >
            <div className="dot" />
            <b>{bannerLabel}</b>
          </div>
        ) : (
          <div className="global-status" style={{ opacity: 0.5 }}>
            <b>Données indisponibles</b>
          </div>
        )}

        <div className="clockbox">
          <div className="time">{formatClock(clock)}</div>
          <div className="date">
            {clock.toLocaleDateString('fr-FR', {
              weekday: 'short',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </div>
        </div>
        <div className="refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <path d="M21 3v6h-6" />
          </svg>
          <span>auto · {refreshIn}s</span>
          <Link href="/dashboard" className="exit-noc" title="Quitter">
            quitter
          </Link>
        </div>
      </header>

      <div className="kpis">
        {kpis ? (
          <>
            <div className={`kpi ${kpis.servers.ok < kpis.servers.total ? 'crit' : 'ok'}`}>
              <div className="bar" />
              <div className="label">Serveurs</div>
              <div className="value">
                {kpis.servers.ok}
                <span className="unit">/{kpis.servers.total} OK</span>
              </div>
              <div className="sub">
                {incidentHosts.length
                  ? `${incidentHosts.map((h) => h.name.replace(/\.havetdigital\.app$/i, '')).slice(0, 3).join(' · ')} en incident`
                  : 'Tous opérationnels'}
              </div>
            </div>
            <div className={`kpi ${kpis.sites.down > 0 ? 'warn' : 'ok'}`}>
              <div className="bar" />
              <div className="label">Sites en ligne</div>
              <div className="value">
                {kpis.sites.ok}
                <span className="unit">/{kpis.sites.total}</span>
              </div>
              <div className="sub">
                {sitePct != null ? `${sitePct} %` : '—'} · {kpis.sites.down} down ·{' '}
                {kpis.sites.degraded} dégradés
              </div>
            </div>
            <div
              className={`kpi ${
                kpis.alerts.critical > 0
                  ? 'crit'
                  : kpis.alerts.warning > 0 || (kpis.alerts.ssl ?? 0) > 0
                    ? 'warn'
                    : 'ok'
              }`}
            >
              <div className="bar" />
              <div className="label">Alertes actives</div>
              <div className="value">{kpis.alerts.active}</div>
              <div className="sub">
                <SeverityTags
                  critical={kpis.alerts.critical}
                  warning={kpis.alerts.warning}
                  ssl={kpis.alerts.ssl ?? 0}
                />
                {kpis.alerts.active === 0 && 'Aucune alerte'}
              </div>
            </div>
            <div className={`kpi ${kpis.vms.ok < kpis.vms.total ? 'warn' : 'ok'}`}>
              <div className="bar" />
              <div className="label">Machines virtuelles</div>
              <div className="value">
                {kpis.vms.ok}
                <span className="unit">/{kpis.vms.total}</span>
              </div>
              <div className="sub">
                {state!.hosts
                  .filter((h) => h.type === 'hyperviseur' && h.vms)
                  .map((h) => `${h.name.replace(/\.havetdigital\.app$/i, '')} : ${h.vms!.total}`)
                  .join(' · ') || 'Aucun hyperviseur'}
              </div>
            </div>
            <div
              className={`kpi ${
                kpis.availability30d == null
                  ? 'info'
                  : kpis.availability30d >= 99.5
                    ? 'ok'
                    : kpis.availability30d >= 99
                      ? 'warn'
                      : 'crit'
              }`}
            >
              <div className="bar" />
              <div className="label">Disponibilité 30 j</div>
              <div className="value">
                {kpis.availability30d != null
                  ? kpis.availability30d.toFixed(1).replace('.', ',')
                  : '—'}
                <span className="unit">%</span>
              </div>
              <div className="sub">
                {kpis.availability30d != null
                  ? 'Serveurs + VM · hors sites · cible 99,5 %'
                  : 'Métrique non disponible'}
              </div>
            </div>
          </>
        ) : (
          <PanelFallback label="KPI indisponibles" />
        )}
      </div>

      <main>
        <div className="col-hosts">
          <section>
            <h2>
              Incidents en cours{' '}
              <span className="count">{incidentHosts.length} hosts</span>
            </h2>
            {error && !state ? (
              <PanelFallback label="Hosts indisponibles" />
            ) : incidentHosts.length === 0 ? (
              <div className="unavailable" style={{ minHeight: 48 }}>
                Aucun incident
              </div>
            ) : (
              <div className="crit-grid">
                {incidentHosts.slice(0, 4).map((h) => (
                  <CriticalHostCard key={h.id} host={h} now={now} />
                ))}
              </div>
            )}
          </section>

          <section style={{ marginTop: 'auto' }}>
            <h2>
              Opérationnel <span className="count">{okHosts.length} hosts</span>
            </h2>
            {okHosts.length === 0 ? (
              <div className="unavailable" style={{ minHeight: 48 }}>
                Aucun host opérationnel
              </div>
            ) : (
              <div className="ok-grid">
                {okHosts.map((h) => (
                  <OkHostCard key={h.id} host={h} />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="rail">
          <div className="panel feed">
            <h2>
              Flux d&apos;alertes{' '}
              <span className="count">
                {state ? `${state.global.alerts} actives` : '—'}
              </span>
            </h2>
            {!state ? (
              <PanelFallback label="Flux indisponible" />
            ) : (
              <div className="feed-list">
                {state.alerts.length === 0 ? (
                  <div className="unavailable" style={{ minHeight: 40 }}>
                    Aucune alerte
                  </div>
                ) : (
                  state.alerts.map((a, i) => (
                    <div key={`${a.time}-${a.message}-${i}`} className={`alert ${a.severity}`}>
                      <span className="t">{formatAlertTime(a.time)}</span>
                      <div className="body">
                        <div className="h">{a.host}</div>
                        <div className="d">{a.message}</div>
                      </div>
                      <span className="sev">{SEV_LABEL[a.severity]}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="panel histo">
            <h2>Alertes · 24 h</h2>
            {state ? (
              <Histo24h data={state.history24h} />
            ) : (
              <PanelFallback label="Historique indisponible" />
            )}
          </div>
        </div>
      </main>

      <footer>
        <div className="lg">
          <i style={{ background: 'var(--ok)' }} />
          En ligne
        </div>
        <div className="lg">
          <i style={{ background: 'var(--maint)' }} />
          Maintenance
        </div>
        <div className="lg">
          <i style={{ background: 'var(--warn)' }} />
          Dégradé
        </div>
        <div className="lg">
          <i style={{ background: 'var(--crit)' }} />
          Hors ligne
        </div>
        <div className="lg">
          <i style={{ background: 'var(--off)' }} />
          Supervision off
        </div>
        <div className="ticker">
          Dernière synchro :{' '}
          <b>{syncAge != null ? `il y a ${syncAge} s` : '—'}</b>
          {error ? ' · ' : ''}
          {error ? <b style={{ color: 'var(--warn)' }}>erreur réseau</b> : null}
        </div>
      </footer>
    </div>
  );
}
