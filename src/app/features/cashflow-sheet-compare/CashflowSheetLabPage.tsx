import { useMemo, useState } from 'react';
import { AlertCircle, FileSpreadsheet, Loader2, Search } from 'lucide-react';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { useFirebase } from '../../lib/firebase-context';
import {
  extractSpreadsheetIdFromSheetInput,
  previewCashflowSheetLabViaBff,
  type CashflowSheetLabPreviewResult,
} from '../../lib/sheets-cashflow-readonly-client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

function formatMode(mode: string) {
  return mode === 'projection' ? 'Projection' : 'Actual';
}

function formatAmount(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toLocaleString('ko-KR')}원`;
}

function visiblePreviewValues(preview: CashflowSheetLabPreviewResult) {
  const withAmounts = preview.previewValues.filter((value) => value.amount !== null);
  return (withAmounts.length ? withAmounts : preview.previewValues).slice(0, 36);
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return '시트 구조를 확인하지 못했습니다.';
}

function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'error'; children: string }) {
  const className = tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-red-200 bg-red-50 text-red-800';
  return (
    <span className={`inline-flex h-7 items-center rounded border px-2.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

export function CashflowSheetLabPage() {
  const { user: authUser } = useAuth();
  const { orgId } = useFirebase();
  const { activeProjectId, myProject, portalUser } = usePortalStore();
  const [sheetLink, setSheetLink] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [preview, setPreview] = useState<CashflowSheetLabPreviewResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const projectId = activeProjectId || myProject?.id || '';
  const projectName = myProject?.name || '내 사업';
  const spreadsheetId = useMemo(() => extractSpreadsheetIdFromSheetInput(sheetLink), [sheetLink]);
  const actor = useMemo(() => ({
    uid: authUser?.uid || portalUser?.id || 'portal-user',
    email: authUser?.email || portalUser?.email || '',
    role: authUser?.role || portalUser?.role || 'workspace_user',
    idToken: authUser?.idToken,
  }), [
    authUser?.uid,
    authUser?.email,
    authUser?.role,
    authUser?.idToken,
    portalUser?.id,
    portalUser?.email,
    portalUser?.role,
  ]);

  async function handlePreview() {
    if (!projectId || !sheetLink.trim()) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const result = await previewCashflowSheetLabViaBff({
        tenantId: orgId,
        actor,
        projectId,
        value: sheetLink,
        sheetName: sheetName || undefined,
      });
      setPreview(result);
      if (!sheetName && result.selectedSheetName) setSheetName(result.selectedSheetName);
    } catch (error) {
      setPreview(null);
      setErrorMessage(formatError(error));
    } finally {
      setLoading(false);
    }
  }

  if (!projectId) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-2 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <FileSpreadsheet className="h-4 w-4" />
          <span>{projectName}</span>
        </div>
        <h1 className="text-xl font-semibold text-slate-950">캐시플로우 시트 연동 검토</h1>
      </div>

      <section className="grid gap-3 border border-slate-200 bg-white p-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
          <Input
            value={sheetLink}
            onChange={(event) => setSheetLink(event.target.value)}
            placeholder="Google Sheet 링크"
            aria-label="Google Sheet 링크"
            className="h-10 rounded-none text-[12px]"
          />
          <Input
            value={sheetName}
            onChange={(event) => setSheetName(event.target.value)}
            placeholder="시트 탭 이름"
            aria-label="시트 탭 이름"
            className="h-10 rounded-none text-[12px]"
          />
          <Button
            type="button"
            className="h-10 gap-1.5 rounded-none text-[12px]"
            disabled={!spreadsheetId || loading}
            onClick={handlePreview}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            검토
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>Spreadsheet ID</span>
          <code className="border border-slate-200 bg-slate-50 px-2 py-1">{spreadsheetId || '-'}</code>
          <span>MYSC 시스템 계정 읽기 기준</span>
        </div>
        {errorMessage && (
          <div className="flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
            <AlertCircle className="h-4 w-4" />
            <span>{errorMessage}</span>
          </div>
        )}
      </section>

      {preview && (
        <section className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">선택 시트</div>
              <div className="mt-1 truncate text-[13px] font-medium text-slate-950">{preview.selectedSheetName}</div>
            </div>
            <div className="border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">구조</div>
              <div className="mt-1">
                <StatusPill tone={preview.template.supported ? 'ok' : 'error'}>
                  {preview.template.supported ? '지원 양식' : '확인 필요'}
                </StatusPill>
              </div>
            </div>
            <div className="border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">좌표</div>
              <div className="mt-1 text-[13px] font-medium text-slate-950">
                {preview.template.stats.mappingCount.toLocaleString()}개
              </div>
              <div className="mt-1 font-mono text-[10px] text-slate-500">source: sheet_layout</div>
            </div>
            <div className="border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Java Read Model</div>
              <div className="mt-1">
                <StatusPill tone={preview.cashflowSnapshotStatus === 'ready' ? 'ok' : 'warn'}>
                  {preview.cashflowSnapshotStatus === 'ready' ? '연결됨' : '미연결'}
                </StatusPill>
              </div>
              <div className="mt-1 font-mono text-[10px] text-slate-500">{preview.accessPolicy.valueSource}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
            <span>Google: {preview.accessPolicy.googleAuth}</span>
            <span>Scope: {preview.accessPolicy.googleScope}</span>
            <span>Role: {preview.accessPolicy.actorRolePolicy}</span>
          </div>

          {preview.template.reasons.length > 0 && (
            <div className="border border-red-200 bg-red-50 p-3 text-[12px] text-red-800">
              {preview.template.reasons.map((reason) => (
                <div key={`${reason.code}-${reason.mode || 'sheet'}`}>
                  {reason.message} {reason.lineIds?.length ? `(${reason.lineIds.join(', ')})` : ''}
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            {preview.template.sections.map((section) => (
              <div key={section.mode} className="border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                  <h2 className="text-[13px] font-semibold text-slate-950">{formatMode(section.mode)}</h2>
                  <span className="text-[11px] text-slate-500">
                    {section.weekColumns.length}주 · {section.lineRows.length}행
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-[11px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">항목</th>
                        <th className="px-3 py-2 font-medium">Line ID</th>
                        <th className="px-3 py-2 font-medium">행</th>
                        <th className="px-3 py-2 font-medium">첫 주차</th>
                        <th className="px-3 py-2 font-medium">마지막 주차</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.lineRows.map((row) => (
                        <tr key={`${section.mode}-${row.lineId}`} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-900">{row.label}</td>
                          <td className="px-3 py-2 font-mono text-slate-700">{row.lineId}</td>
                          <td className="px-3 py-2 text-slate-500">{row.a1}</td>
                          <td className="px-3 py-2 text-slate-500">{section.weekColumns[0]?.a1 || '-'}</td>
                          <td className="px-3 py-2 text-slate-500">{section.weekColumns.at(-1)?.a1 || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <div className="border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-slate-950">Java 값 미리보기</h2>
              <span className="text-[11px] text-slate-500">
                {preview.previewValues.length.toLocaleString()}개 좌표
              </span>
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[760px] text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">Line ID</th>
                    <th className="px-3 py-2 font-medium">주차</th>
                    <th className="px-3 py-2 font-medium">셀</th>
                    <th className="px-3 py-2 text-right font-medium">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePreviewValues(preview).map((value) => (
                    <tr key={`${value.mode}-${value.lineId}-${value.yearMonth}-${value.weekNo}-${value.a1}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{formatMode(value.mode)}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{value.lineId}</td>
                      <td className="px-3 py-2 text-slate-500">{value.yearMonth} W{value.weekNo}</td>
                      <td className="px-3 py-2 text-slate-500">{value.a1}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{formatAmount(value.amount)}</td>
                    </tr>
                  ))}
                  {preview.previewValues.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-[12px] text-slate-500">
                        표시할 좌표가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
