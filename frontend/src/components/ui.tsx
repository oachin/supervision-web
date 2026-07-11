import Link from 'next/link';
import { cn } from '@/lib/utils';

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

  return (
    <span className={cn(variant)}>
      <span className={cn(
        'h-1.5 w-1.5 rounded-full',
        status === 'ONLINE' || status === 'UP' ? 'bg-accent' :
        status === 'OFFLINE' || status === 'DOWN' ? 'bg-destructive' :
        status === 'DEGRADED' ? 'bg-warning' :
        status === 'DISABLED' ? 'bg-muted-foreground' : 'bg-muted-foreground',
      )} />
      {label}
    </span>
  );
}

export function WebsiteStatusBadge({
  status,
  monitoringEnabled = true,
}: {
  status: string;
  monitoringEnabled?: boolean;
}) {
  if (!monitoringEnabled) {
    return <StatusBadge status="DISABLED" />;
  }
  return <StatusBadge status={status} />;
}

function badgeDotClass(variant: 'success' | 'warning' | 'danger' | 'muted') {
  return {
    success: 'bg-accent',
    warning: 'bg-warning',
    danger: 'bg-destructive',
    muted: 'bg-muted-foreground',
  }[variant];
}

function badgeVariantClass(variant: 'success' | 'warning' | 'danger' | 'muted') {
  return {
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    muted: 'badge-muted',
  }[variant];
}

export function HttpCodeBadge({ code }: { code?: number | null }) {
  if (code == null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const variant =
    code >= 200 && code < 400 ? 'success' :
    code >= 400 && code < 500 ? 'warning' : 'danger';

  return (
    <span className={badgeVariantClass(variant)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', badgeDotClass(variant))} />
      {code}
    </span>
  );
}

export function DnsBadge({ ok }: { ok?: boolean | null }) {
  if (ok == null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const variant = ok ? 'success' : 'danger';

  return (
    <span className={badgeVariantClass(variant)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', badgeDotClass(variant))} />
      {ok ? 'OK' : 'FAIL'}
    </span>
  );
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  href,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: 'up' | 'down' | 'neutral';
  href?: string;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg',
          trend === 'up' ? 'bg-accent/15 text-accent' :
          trend === 'down' ? 'bg-destructive/15 text-destructive' :
          'bg-primary/15 text-primary',
        )}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="card group block hover:border-primary/20 transition-colors cursor-pointer">
        {content}
      </Link>
    );
  }

  return (
    <div className="card group hover:border-primary/20 transition-colors">
      {content}
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const cls = {
    CRITICAL: 'badge-danger',
    WARNING: 'badge-warning',
    INFO: 'badge-muted',
  }[severity] || 'badge-muted';

  return <span className={cls}>{severity}</span>;
}
