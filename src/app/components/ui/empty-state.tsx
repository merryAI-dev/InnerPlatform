import type { ReactNode } from 'react';
import { Button } from './button';

interface EmptyStateProps {
  icon: any;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: any;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  children?: ReactNode;
  variant?: 'default' | 'compact' | 'card';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  children,
  variant = 'default',
}: EmptyStateProps) {
  if (variant === 'compact') {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center mb-3"
          style={{
            background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--primary) 8%, var(--muted)))',
          }}
        >
          <Icon className="w-5 h-5 text-primary/70" />
        </div>
        <p className="text-[13px] text-foreground/80" style={{ fontWeight: 600 }}>{title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 max-w-[280px] leading-relaxed">{description}</p>
        {action && (
          <Button
            size="sm"
            className="mt-3.5 gap-1.5 h-8 text-xs text-white"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--ring))' }}
            onClick={action.onClick}
          >
            {action.icon && <action.icon className="w-3.5 h-3.5" />}
            {action.label}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 relative"
        style={{
          background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--primary) 10%, var(--muted)) 100%)',
        }}
      >
        <Icon className="w-7 h-7 text-primary" />
        {/* Subtle glow */}
        <div
          className="absolute inset-0 rounded-2xl opacity-30 blur-xl"
          style={{ background: 'var(--primary)' }}
        />
      </div>
      <h3 className="text-[15px] text-foreground mb-1.5" style={{ fontWeight: 700 }}>{title}</h3>
      <p className="text-[13px] text-muted-foreground max-w-[360px] leading-relaxed">
        {description}
      </p>
      {children}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-5">
          {secondaryAction && (
            <Button variant="outline" size="sm" className="h-9 text-xs" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
          {action && (
            <Button
              size="sm"
              className="h-9 gap-1.5 text-xs text-white"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--ring))' }}
              onClick={action.onClick}
            >
              {action.icon && <action.icon className="w-3.5 h-3.5" />}
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
