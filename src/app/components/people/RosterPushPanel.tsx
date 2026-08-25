import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchRosterPushStatusViaBff,
  triggerRosterPushViaBff,
  type RosterPushStatusResponse,
} from '../../lib/participation-roster-client';
import type { ActorLike } from '../../lib/platform-bff-client';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import {
  canTriggerRosterPush, formatRosterInstant, rosterPushReasonLabel,
} from './roster-push-helpers';

/**
 * 참여율 시트 명단 동기화 패널. 채용·퇴사가 일어나는 인력 명부 화면에 붙는다 -
 * "명부를 고쳤으면 시트에 미는 것"까지가 한 동선이다.
 *
 * 실행은 이벤트를 대기열에 넣을 뿐이고(outbox), 실제 반영은 자동 실행(매일 02:30)이
 * 처리한다. 시트별 결과는 ID 가 아니라 시트 제목 + 프로젝트명으로 말한다.
 */
export function RosterPushPanel({ orgId, actor }: { orgId: string; actor: ActorLike & { role?: string } }) {
  const [data, setData] = useState<RosterPushStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchRosterPushStatusViaBff({ tenantId: orgId, actor }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '명단 동기화 상태를 읽지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [orgId, actor]);

  useEffect(() => { void load(); }, [load]);

  const push = async () => {
    setPushing(true);
    try {
      await triggerRosterPushViaBff({
        tenantId: orgId,
        actor,
        idempotencyKey: `roster-push:${crypto.randomUUID()}`,
      });
      toast.success('명단 갱신을 대기열에 넣었습니다. 다음 자동 실행 때 시트에 반영됩니다.');
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '명단 갱신 실행에 실패했습니다.');
    } finally {
      setPushing(false);
    }
  };

  const statuses = (data?.statuses || []).filter((status) => status.active);
  const inactiveCount = data?.counts.inactive || 0;
  const pending = data?.pendingPush;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Table2 className="h-4 w-4 text-slate-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">참여율 시트 명단 동기화</p>
            <p className="text-xs text-slate-500">
              명부의 채용·퇴사를 연동된 참여율 시트의 닉네임 목록에 반영합니다. 실행하면 대기열에 들어가고, 매일 02:30 자동 처리됩니다.
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> 새로고침
          </Button>
          {canTriggerRosterPush(actor.role) ? (
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void push()} disabled={pushing}>
              <Send className="h-3.5 w-3.5" /> {pushing ? '등록 중…' : '명단 갱신 실행'}
            </Button>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

        {pending && (pending.queued > 0 || pending.processing > 0) ? (
          <p className="mt-3 text-xs text-slate-600">
            대기 중 {pending.queued}건{pending.processing > 0 ? ` · 처리 중 ${pending.processing}건` : ''}
            {pending.oldestQueuedAt ? ` · 가장 오래된 대기 ${formatRosterInstant(pending.oldestQueuedAt)}` : ''}
          </p>
        ) : null}

        {data && statuses.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            아직 연동된 시트가 없습니다. 프로젝트 등록/수정에서 참여율 시트 링크를 등록하면 그 시트가 여기에 나타납니다.
          </p>
        ) : null}

        {statuses.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">시트</TableHead>
                  <TableHead className="text-xs">프로젝트</TableHead>
                  <TableHead className="text-xs">상태</TableHead>
                  <TableHead className="text-xs">마지막 성공</TableHead>
                  <TableHead className="text-xs">마지막 시도</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((status) => (
                  <TableRow key={status.spreadsheetId || status.spreadsheetTitle}>
                    <TableCell className="text-sm text-slate-800">{status.spreadsheetTitle}</TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {status.projects.map((project) => project.projectName).join(', ') || '-'}
                    </TableCell>
                    <TableCell>
                      {status.ok ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          반영됨{typeof status.writtenRows === 'number' ? ` · ${status.writtenRows}행` : ''}
                        </Badge>
                      ) : (
                        <span className="text-xs text-rose-700">{rosterPushReasonLabel(status.reason)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-slate-600">{formatRosterInstant(status.lastSuccessAt)}</TableCell>
                    <TableCell className="text-xs tabular-nums text-slate-600">{formatRosterInstant(status.lastAttemptAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {inactiveCount > 0 ? (
              <p className="mt-2 text-xs text-slate-500">연동 해제된 시트 이력 {inactiveCount}건은 표시하지 않습니다.</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
