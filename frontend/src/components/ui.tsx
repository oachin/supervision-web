import { cn } from '@/lib/utils';

export function StatusBadge({ status }: { status: string }) {
  const variant = {
    ONLINE: 'badge-success',
    UP: 'badge-success',
    OFFLINE: 'badge-danger',
    DOWN: 'badge-danger',
    DEGRADED: 'badge-warning',
    UNKNOWN: 'badge-muted',
  }[status] || 'badge-muted';

  const label = {
    ONLINE: 'En ligne',
    UP: 'En ligne',
    OFFLINE: 'Hors ligne',
    DOWN: 'Hors ligne',
    DEGRADED: 'Dégradé',
    UNKNOWN: 'Inconnu',
  }[status] || status;

  return (
    <span className={cn(variant)}>
      <span className={cn(
        'h-1.5 w-1.5 rounded-full',
        status === 'ONLINE' || status === 'UP' ? 'bg-accent' :
        status === 'OFFLINE' || status === 'DOWN' ? 'bg-destructive' :
        status === 'DEGRADED' ? 'bg-warning' : 'bg-muted-foreground',
      )} />
      {label}
    </span>
  );
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="card group hover:border-primary/20 transition-colors">
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
