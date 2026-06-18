import type { ReactNode } from 'react';
import { Badge } from '../ui/badge';

interface PageHeaderProps {
  icon: any;
  iconGradient: string;
  title: string;
  description: string;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'outline';
  actions?: ReactNode;
  headingVisible?: boolean;
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  badge,
  badgeVariant = 'secondary',
  actions,
  headingVisible = true,
}: PageHeaderProps) {
  if (!headingVisible) {
    if (!actions && !badge) return null;
    return (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        {badge && (
          <Badge variant={badgeVariant} className="text-[10px] h-5 px-2">
            {badge}
          </Badge>
        )}
        {actions}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#001e46] shadow-sm"
        >
          <Icon className="w-4.5 h-4.5 text-white" />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="text-[20px]" style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
              {title}
            </h1>
            {badge && (
              <Badge variant={badgeVariant} className="text-[10px] h-5 px-2">
                {badge}
              </Badge>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">{actions}</div>}
    </div>
  );
}
