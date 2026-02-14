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
}

export function PageHeader({
  icon: Icon,
  iconGradient,
  title,
  description,
  badge,
  badgeVariant = 'secondary',
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: iconGradient }}
        >
          <Icon className="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
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
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
