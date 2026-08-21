import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UserPlus } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { resolveApiErrorPresentation } from '../../platform/api-error-messages';
import { PlatformApiError } from '../../platform/api-client';
import {
  fetchParticipationSheetPreviewViaBff,
  type ParticipationSheetPreview,
} from '../../lib/platform-bff-client';
import type { AuthUser } from '../../data/auth-store';

/*
 * 참여율 시트를 플랫폼에서 확인하는 화면. 읽기만 한다.
 *
 * 시트가 사람 손에서 채워지는 동안 "제대로 채워졌나" 를 볼 길이 있어야 한다. 반영은 여기서
 * 확인한 뒤의 일이라 이 화면에는 반영 버튼이 없다 - 확인과 반영을 한 버튼에 묶으면 사람이
 * 무엇을 승인했는지 모르는 채 누르게 된다.
 */

const LINK_STATE_LABEL: Record<ParticipationSheetPreview['rows'][number]['linkState'], string> = {
  LINKED: '연결됨',
  PENDING_LINK: '연결 대기',
  PLACEHOLDER: '사람 미정',
};

function sheetErrorMessage(error: unknown): string {
  const status = error instanceof PlatformApiError ? error.status : 500;
  const code = error instanceof PlatformApiError ? error.code : '';
  const mapped = resolveApiErrorPresentation(code, status);
  // 서버가 사람 말로 적어 준 안내가 있으면 그것이 더 구체적이다(어느 사업, 어느 기간).
  const serverMessage = error instanceof PlatformApiError ? String(error.message || '').trim() : '';
  return serverMessage || mapped.guide;
}

export function ParticipationSheetPreviewPanel({ tenantId, user, projects }: {
  tenantId: string;
  user: AuthUser;
  projects: Array<{ id: string; name: string }>;
}) {
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ParticipationSheetPreview | null>(null);

  const missingByRow = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of preview?.missing || []) {
      map.set(entry.rowIndex, (map.get(entry.rowIndex) || 0) + 1);
    }
    return map;
  }, [preview?.missing]);

  const check = () => {
    if (!projectId || loading) return;
    setLoading(true);
    setError('');
    setPreview(null);
    void fetchParticipationSheetPreviewViaBff({ tenantId, actor: user, projectId })
      .then(setPreview)
      .catch((cause) => setError(sheetErrorMessage(cause)))
      .finally(() => setLoading(false));
  };

  const summary = preview?.summary;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="text-[15px] font-bold text-card-foreground">참여율 시트 확인</div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            사업 등록·수정에 저장된 시트를 읽어 그대로 보여줍니다. 확인만 하며 값은 바뀌지 않습니다.
          </div>
        </div>
        <div className="flex items-end gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="h-9 w-[260px] text-[13px]" aria-label="확인할 사업">
              <SelectValue placeholder="사업을 선택해 주세요" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            className="h-9 rounded-md bg-[#17324D] px-3 text-[13px] text-white shadow-none hover:bg-slate-800"
            disabled={!projectId || loading}
            onClick={check}
          >
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />}
            시트 확인
          </Button>
        </div>
      </div>

      {error ? (
        <div className="px-4 py-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>시트를 확인하지 못했습니다</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {preview && summary ? (
        <div className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Badge className={preview.ok
              ? 'h-6 rounded-md border border-border bg-secondary px-2 text-secondary-foreground shadow-none'
              : 'h-6 rounded-md border border-red-200 bg-red-50 px-2 text-red-700 shadow-none'}>
              {preview.ok ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
              {preview.ok ? '반영할 수 있는 상태' : `확인 필요 ${summary.errorCount}건`}
            </Badge>
            <span className="text-muted-foreground">
              {summary.period.start} ~ {summary.period.end} · {summary.monthCount}개월
            </span>
            <span className="text-muted-foreground">
              줄 {summary.rowCount} · 연결됨 {summary.linkedCount} · 연결 대기 {summary.pendingLinkCount} · 사람 미정 {summary.placeholderCount}
            </span>
            <span className={summary.missingCount > 0 ? 'font-semibold text-red-700' : 'text-muted-foreground'}>
              미입력 {summary.missingCount}칸
            </span>
            <a
              href={preview.sheetLink}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-[12px] font-semibold text-[#0176D3] underline-offset-2 hover:underline"
            >
              시트 열기
            </a>
          </div>

          {preview.blocking.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>먼저 고쳐야 하는 것 {preview.blocking.length}건</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 space-y-1">
                  {preview.blocking.slice(0, 10).map((entry, index) => (
                    <li key={`${entry.code}:${entry.rowIndex ?? ''}:${entry.month ?? ''}:${index}`}>
                      {entry.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {/* 사전 등록을 놓쳤을 때 되돌아올 길. 자동 등록은 하지 않는다 - 사람이 확인해 넣는다. */}
          {preview.candidates.length > 0 ? (
            <Alert>
              <UserPlus className="h-4 w-4" />
              <AlertTitle>People 등록이 필요한 사람 {preview.candidates.length}명</AlertTitle>
              <AlertDescription>
                {preview.candidates.map((candidate) => candidate.nickname
                  ? `${candidate.name || '이름 미상'}(${candidate.nickname})`
                  : (candidate.name || '이름 미상')).join(' · ')}
                <div className="mt-1 text-muted-foreground">
                  지금 등록하지 않아도 됩니다. People 에 등록되면 다음 확인에서 저절로 연결됩니다.
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          {preview.rows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow className="border-border bg-muted hover:bg-muted">
                    <TableHead className="sticky left-0 z-10 min-w-[150px] bg-muted text-xs font-semibold">사람</TableHead>
                    <TableHead className="min-w-[110px] text-xs font-semibold">역할</TableHead>
                    <TableHead className="min-w-[150px] text-xs font-semibold">투입기간</TableHead>
                    <TableHead className="min-w-[90px] text-xs font-semibold">연결</TableHead>
                    {preview.months.map((month) => (
                      <TableHead key={month} className="min-w-[64px] text-center text-xs font-semibold">
                        {month.slice(2)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => {
                    const missingCount = missingByRow.get(row.rowIndex) || 0;
                    return (
                      <TableRow key={row.rowIndex} className="border-border">
                        <TableCell className="sticky left-0 z-10 bg-card text-xs font-medium">
                          {row.name || row.nickname || '이름 없음'}
                          {row.name && row.nickname ? <span className="ml-1 text-muted-foreground">({row.nickname})</span> : null}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.role || '―'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.stintStart || '미입력'} ~ {row.stintEnd || '진행 중'}
                          {missingCount > 0 ? <span className="ml-1 font-semibold text-red-700">미입력 {missingCount}</span> : null}
                        </TableCell>
                        <TableCell className={`text-xs ${row.linkState === 'LINKED' ? 'text-muted-foreground' : 'font-semibold text-amber-700'}`}>
                          {LINK_STATE_LABEL[row.linkState]}
                        </TableCell>
                        {preview.months.map((month) => {
                          const inStint = Boolean(row.stintStart)
                            && month >= row.stintStart
                            && (!row.stintEnd || month <= row.stintEnd);
                          const value = row.monthlyRates[month];
                          const hasValue = value !== undefined;
                          return (
                            <TableCell
                              key={month}
                              className={`px-2 py-2 text-center text-xs tabular-nums ${
                                hasValue ? 'font-semibold text-slate-800'
                                  : inStint ? 'bg-red-50 font-semibold text-red-700' : 'text-slate-300'
                              }`}
                            >
                              {hasValue ? `${value}%` : inStint ? '미입력' : '―'}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              시트에서 읽은 참여 줄이 없습니다.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
