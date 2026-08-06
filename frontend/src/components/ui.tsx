import Link from 'next/link';
import { cn, isMaintenanceStatus } from '@/lib/utils';

export function StatusBadge({
  status,
  statusCode,
  size = 'sm',
  className,
}: {
  status: string;
  statusCode?: number | null;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  if (isMaintenanceStatus(status, statusCode)) {
    return (
      <span className={cn(
        'badge-maintenance',
        size === 'lg' && 'gap-2 px-4 py-1.5 text-sm font-semibold',
        className,
      )}>
        <span className={cn('rounded-full bg-emerald-400', size === 'lg' ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5')} />
        En maintenance
      </span>
    );
  }

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
    DISABLED: 'Non supervisé',
  }[status] || status;

  return (
    <span className={cn(
      variant,
      size === 'lg' && 'gap-2 px-4 py-1.5 text-sm font-semibold',
      className,
    )}>
      <span className={cn(
        'rounded-full',
        size === 'lg' ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5',
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
  lastStatusCode,
  size = 'sm',
  className,
}: {
  status: string;
  monitoringEnabled?: boolean;
  lastStatusCode?: number | null;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  if (!monitoringEnabled) {
    return <StatusBadge status="DISABLED" size={size} className={className} />;
  }
  return <StatusBadge status={status} statusCode={lastStatusCode} size={size} className={className} />;
}

function badgeDotClass(variant: 'success' | 'warning' | 'danger' | 'muted' | 'maintenance') {
  return {
    success: 'bg-accent',
    warning: 'bg-warning',
    danger: 'bg-destructive',
    muted: 'bg-muted-foreground',
    maintenance: 'bg-emerald-400',
  }[variant];
}

function badgeVariantClass(variant: 'success' | 'warning' | 'danger' | 'muted' | 'maintenance') {
  return {
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    muted: 'badge-muted',
    maintenance: 'badge-maintenance',
  }[variant];
}

export function HttpCodeBadge({ code }: { code?: number | null }) {
  if (code == null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const variant =
    code === 503 ? 'maintenance' :
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
  compact = false,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: 'up' | 'down' | 'neutral';
  href?: string;
  compact?: boolean;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('text-muted-foreground', compact ? 'text-[11px]' : 'text-sm')}>{title}</p>
          <p
            className={cn(
              'font-bold tracking-tight',
              compact ? 'mt-0.5 text-xl' : 'mt-1 text-3xl',
            )}
          >
            {value}
          </p>
          {subtitle && (
            <p className={cn('text-muted-foreground', compact ? 'mt-0.5 text-[10px]' : 'mt-1 text-xs')}>
              {subtitle}
            </p>
          )}
        </div>
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg',
            compact ? 'h-8 w-8' : 'h-10 w-10',
            trend === 'up'
              ? 'bg-accent/15 text-accent'
              : trend === 'down'
                ? 'bg-destructive/15 text-destructive'
                : 'bg-primary/15 text-primary',
          )}
        >
          <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
        </div>
      </div>
    </>
  );

  const className = cn(
    'group block transition-colors hover:border-primary/20',
    compact
      ? 'rounded-lg border border-white/10 bg-secondary/20 p-3'
      : 'card cursor-pointer',
    href && 'cursor-pointer',
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const cls = {
    CRITICAL: 'badge-danger',
    WARNING: 'badge-warning',
    INFO: 'badge-muted',
  }[severity] || 'badge-muted';

  return <span className={cls}>{severity}</span>;
}
