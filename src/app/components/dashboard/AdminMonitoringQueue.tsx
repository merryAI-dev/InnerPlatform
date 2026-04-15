import { useNavigate } from 'react-router';
import { ArrowRight, AlertTriangle, ChevronRight, CircleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import type { AdminMonitoringIssue } from '../../platform/admin-monitoring';

const severityStyles: Record<AdminMonitoringIssue['severity'], { ring: string; badge: string; accent: string }> = {
  critical: {
    ring: 'border-rose-200 bg-rose-50/70',
    badge: 'bg-rose-100 text-rose-700',
    accent: 'text-rose-600',
  },
  warning: {
    ring: 'border-amber-200 bg-amber-50/70',
    badge: 'bg-amber-100 text-amber-700',
    accent: 'text-amber-600',
  },
  info: {
    ring: 'border-sky-200 bg-sky-50/70',
    badge: 'bg-sky-100 text-sky-700',
    accent: 'text-sky-600',
  },
};

export function AdminMonitoringQueue({ issues }: { issues: AdminMonitoringIssue[] }) {
  const navigate = useNavigate();
  const topIssues = issues.slice(0, 6);

  return (
    <Card className="shadow-sm border-border/50 h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-[13px] flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            </div>
            이상 징후 큐
          </span>
          <span className="text-[10px] text-muted-foreground">{issues.length}개 감지</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {topIssues.length === 0 ? (
          <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/70 p-4 text-[12px] text-emerald-800">
            <div className="flex items-center gap-2 font-semibold">
              <CircleAlert className="w-4 h-4" />
              현재 감지된 이상 징후가 없습니다.
            </div>
            <p className="mt-1 text-[11px] text-emerald-700/80">대시보드가 안정 상태입니다. 운영 지표를 계속 관찰하세요.</p>
          </div>
        ) : (
          topIssues.map((issue) => {
            const style = severityStyles[issue.severity];
            return (
              <button
                key={issue.key}
                type="button"
                onClick={() => navigate(issue.to)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-all hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${style.ring}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 h-2.5 w-2.5 rounded-full shrink-0 ${issue.severity === 'critical' ? 'bg-rose-500' : issue.severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px]" style={{ fontWeight: 700 }}>{issue.label}</span>
                      <Badge className={`text-[9px] h-4 px-1.5 shrink-0 ${style.badge}`}>
                        {issue.count}건
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">
                      {issue.detail}
                    </p>
                  </div>
                  <ChevronRight className={`w-4 h-4 shrink-0 ${style.accent}`} />
                </div>
              </button>
            );
          })
        )}

        {issues.length > topIssues.length && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-between px-2 text-[10px] text-muted-foreground"
            onClick={() => navigate('/audit')}
          >
            <span>나머지 {issues.length - topIssues.length}개 이상 징후 확인</span>
            <ArrowRight className="w-3 h-3" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
