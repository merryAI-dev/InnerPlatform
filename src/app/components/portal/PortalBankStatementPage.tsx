import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Upload, Save, Plus, Loader2, ArrowRight, ShieldAlert, Trash2, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { PortalMissionGuide } from './PortalMissionGuide';
import { BankImportTriageWizard } from './BankImportTriageWizard';
import { usePortalStore } from '../../data/portal-store';
import {
  detectBankStatementProfile,
  getBankStatementProfileLabel,
  isHtmlMaskedAsXls,
  normalizeBankStatementMatrix,
  parseHtmlBankExport,
  sanitizeHtmlMatrix,
  type BankStatementRow,
} from '../../platform/bank-statement';
import { groupExpenseIntakeItemsForSurface } from '../../platform/bank-intake-surface';
import { normalizeKey, parseCsv, parseNumber } from '../../platform/csv-utils';
import { loadXlsx, warmXlsx } from '../../platform/lazy-heavy-modules';
import { normalizeProjectFundInputMode } from '../../data/types';
import { resolvePortalMissionProgress } from '../../platform/portal-mission-guide';

function getAmountColumnIndexes(columns: string[]): Set<number> {
  return new Set(
    columns.map((col, idx) => ({ col, idx }))
      .filter(({ col }) => {
        const key = normalizeKey(col);
        return key.includes(normalizeKey('입금')) || key.includes(normalizeKey('출금')) || key.includes(normalizeKey('잔액'));
      })
      .map(({ idx }) => idx),
  );
}

function formatBankStatementRows(
  rows: BankStatementRow[],
  columns: string[],
  formatAmount: (value: string) => string,
): BankStatementRow[] {
  const amountColIdxs = getAmountColumnIndexes(columns);
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell, idx) => (amountColIdxs.has(idx) ? formatAmount(cell) : cell)),
  }));
}

export function PortalBankStatementPage() {
  const navigate = useNavigate();
  const {
    portalUser,
    myProject,
    bankStatementRows,
    saveBankStatementRows,
    expenseSheetRows,
    expenseIntakeItems,
    evidenceRequiredMap,
    saveExpenseIntakeDraft,
    projectExpenseIntakeItem,
    syncExpenseIntakeEvidence,
    weeklySubmissionStatuses,
  } = usePortalStore();
  const [columns, setColumns] = useState<string[]>(bankStatementRows?.columns || []);
  const [rows, setRows] = useState<BankStatementRow[]>(bankStatementRows?.rows || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastUploadedName, setLastUploadedName] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploadPreparing, setUploadPreparing] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectName = myProject?.name || '내 사업';
  const ready = useMemo(() => Boolean(portalUser?.projectId), [portalUser?.projectId]);
  const bankProfile = useMemo(() => detectBankStatementProfile(columns, lastUploadedName), [columns, lastUploadedName]);
  const amountColIdxs = useMemo(() => getAmountColumnIndexes(columns), [columns]);
  const hasUploadedSheet = rows.length > 0 && columns.length > 0;
  const missionProgress = useMemo(() => resolvePortalMissionProgress({
    fundInputMode: normalizeProjectFundInputMode(myProject?.fundInputMode),
    bankStatementRowCount: rows.length,
    expenseRowCount: expenseSheetRows?.length || 0,
    weeklySubmissionStatuses,
  }), [expenseSheetRows?.length, myProject?.fundInputMode, rows.length, weeklySubmissionStatuses]);
  const intakeSurface = useMemo(() => groupExpenseIntakeItemsForSurface(expenseIntakeItems), [expenseIntakeItems]);
  const queueWorkCount = intakeSurface.needsClassification.length + intakeSurface.reviewRequired.length + intakeSurface.pendingEvidence.length;

  const formatAmount = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const num = parseNumber(trimmed);
    if (num == null) return trimmed;
    return num.toLocaleString('ko-KR');
  }, []);

  useEffect(() => {
    if (dirty) return;
    if (bankStatementRows?.rows && bankStatementRows.rows.length > 0) {
      const nextColumns = bankStatementRows.columns || [];
      setColumns(nextColumns);
      setRows(formatBankStatementRows(bankStatementRows.rows, nextColumns, formatAmount));
      return;
    }
    setColumns([]);
    setRows([]);
  }, [bankStatementRows, dirty, formatAmount]);

  const findColumnIndex = useCallback((aliases: string[]) => {
    const normalizedAliases = aliases.map((alias) => normalizeKey(alias));
    return columns.findIndex((column) => {
      const key = normalizeKey(column);
      return normalizedAliases.some((alias) => key === alias || key.includes(alias));
    });
  }, [columns]);

  const parseExcelToMatrix = useCallback(async (file: File): Promise<string[][]> => {
    // KB 등 HTML-as-XLS 감지: 파일 앞부분이 HTML 태그로 시작하면 HTML 파서 사용
    const headBytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    const headText = new TextDecoder('utf-8', { fatal: false }).decode(headBytes).trim();
    if (isHtmlMaskedAsXls(headText)) {
      const fullText = await file.text();
      const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(fullText));
      if (matrix.length > 0) return matrix;
      // fallback to XLSX if HTML parse yields nothing
    }

    const XLSX = await loadXlsx();
    const buffer = new Uint8Array(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });

    const sheetMatrices = workbook.SheetNames.map((sheetName) => {
      const ws = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
      const matrix = rawRows.map((row) =>
        (Array.isArray(row) ? row : []).map((cell) => {
          if (cell == null) return '';
          if (cell instanceof Date) return cell.toISOString().slice(0, 10);
          return String(cell);
        }),
      );
      const nonEmpty = matrix.reduce((sum, row) => {
        return sum + row.filter((cell) => String(cell || '').trim().length > 0).length;
      }, 0);
      return { matrix, nonEmpty };
    });

    const best = sheetMatrices
      .sort((a, b) => b.nonEmpty - a.nonEmpty)[0];

    return best?.matrix || [];
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    try {
      const name = file.name.toLowerCase();
      let matrix: string[][] = [];
      const needsSpreadsheetEngine = name.endsWith('.xlsx') || name.endsWith('.xls');
      if (needsSpreadsheetEngine) {
        setUploadPreparing(true);
      }
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        matrix = await parseExcelToMatrix(file);
      } else if (name.endsWith('.csv')) {
        const text = await file.text();
        matrix = parseCsv(text);
      } else {
        toast.error('CSV, XLSX 또는 XLS 파일만 업로드할 수 있습니다.');
        return;
      }
      const result = normalizeBankStatementMatrix(matrix);
      if (!result.columns.length || !result.rows.length) {
        toast.error('업로드 데이터에서 컬럼/행을 찾지 못했습니다. 파일 형식을 확인해 주세요.');
        return;
      }
      setLastUploadedName(file.name);
      setColumns(result.columns);
      setRows(formatBankStatementRows(result.rows, result.columns, formatAmount));
      setDirty(true);
    } catch (err) {
      console.error('[BankStatement] upload parse failed:', err);
      toast.error('파일을 읽지 못했습니다. `.xls`/`.xlsx`/`.csv` 파일인지 확인해 주세요.');
    } finally {
      setUploadPreparing(false);
    }
  }, [parseExcelToMatrix, formatAmount]);

  const openFilePicker = useCallback(() => {
    warmXlsx();
    fileInputRef.current?.click();
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFileUpload(file);
  }, [handleFileUpload]);

  const addRow = useCallback(() => {
    if (columns.length === 0) {
      toast.message('먼저 통장내역 파일을 업로드해 주세요.');
      return;
    }
    const next = [...rows, { tempId: `bank-${Date.now()}`, cells: columns.map(() => '') }];
    setRows(next);
    setDirty(true);
  }, [rows, columns]);

  const addSpecialTemplateRow = useCallback((kind: 'corp-card-refund' | 'prepaid-in' | 'special-case') => {
    if (columns.length === 0) {
      toast.message('먼저 통장내역 파일을 업로드해 주세요.');
      return;
    }
    const nextRow: BankStatementRow = { tempId: `bank-${Date.now()}`, cells: columns.map(() => '') };
    const dateIdx = findColumnIndex(['거래일시', '거래일자', '거래일', '일자', '날짜']);
    const memoIdx = findColumnIndex(['적요', '메모', '내용', '거래내용', '내통장표시내용']);
    const counterpartyIdx = findColumnIndex(['의뢰인/수취인', '의뢰인', '수취인', '상대계좌명', '거래처']);
    const inIdx = findColumnIndex(['입금금액', '입금', '입금액']);
    const outIdx = findColumnIndex(['출금금액', '출금', '출금액']);

    if (dateIdx >= 0) nextRow.cells[dateIdx] = new Date().toISOString().slice(0, 10);

    if (kind === 'corp-card-refund') {
      if (memoIdx >= 0) nextRow.cells[memoIdx] = '개인법인카드 사용 환수';
      if (counterpartyIdx >= 0) nextRow.cells[counterpartyIdx] = '개인법인카드 환수';
      if (inIdx >= 0) nextRow.cells[inIdx] = '';
    } else if (kind === 'prepaid-in') {
      if (memoIdx >= 0) nextRow.cells[memoIdx] = '선사용금 입금';
      if (counterpartyIdx >= 0) nextRow.cells[counterpartyIdx] = '선사용금';
      if (inIdx >= 0) nextRow.cells[inIdx] = '';
    } else {
      if (memoIdx >= 0) nextRow.cells[memoIdx] = '특이 건 수기 관리';
      if (counterpartyIdx >= 0) nextRow.cells[counterpartyIdx] = '수기 입력';
      if (outIdx >= 0) nextRow.cells[outIdx] = '';
    }

    setRows((prev) => [...prev, nextRow]);
    setDirty(true);
  }, [columns, findColumnIndex]);

  const removeRow = useCallback((rowIdx: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== rowIdx));
    setDirty(true);
  }, []);

  const updateCell = useCallback((rowIdx: number, colIdx: number, value: string) => {
    const nextValue = amountColIdxs.has(colIdx) ? formatAmount(value) : value;
    setRows((prev) => prev.map((row, i) => {
      if (i !== rowIdx) return row;
      const cells = [...row.cells];
      cells[colIdx] = nextValue;
      return { ...row, cells };
    }));
    setDirty(true);
  }, [amountColIdxs, formatAmount]);

  const handleCellBlur = useCallback((rowIdx: number, colIdx: number, value: string) => {
    if (!amountColIdxs.has(colIdx)) return;
    const formatted = formatAmount(value);
    if (formatted === value) return;
    updateCell(rowIdx, colIdx, formatted);
  }, [amountColIdxs, formatAmount, updateCell]);

  const persistSheet = useCallback(async (options?: { silent?: boolean }) => {
    if (!saveBankStatementRows) {
      if (!options?.silent) toast.error('저장 기능이 연결되어 있지 않습니다.');
      return;
    }
    setSaving(true);
    try {
      await saveBankStatementRows({ columns, rows });
      setDirty(false);
      const now = new Date().toISOString();
      setLastSavedAt(now);
      if (!options?.silent) toast.success('통장내역을 저장했습니다.');
    } catch (err) {
      console.error('[BankStatement] save failed:', err);
      if (!options?.silent) toast.error('통장내역 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [columns, rows, saveBankStatementRows]);

  const handleSave = useCallback(async () => {
    await persistSheet();
  }, [persistSheet]);

  useEffect(() => {
    if (!dirty || saving || !saveBankStatementRows || columns.length === 0) return;
    const timer = window.setTimeout(() => {
      void persistSheet({ silent: true });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [dirty, saving, saveBankStatementRows, columns.length, persistSheet]);

  const trustSurface = saving
    ? {
      label: '저장 중',
      description: '현재 수정한 통장내역을 주간 사업비 기준본으로 저장하고 있습니다.',
      toneClass: 'border-indigo-200/70 bg-indigo-50/60',
    }
    : dirty
      ? {
        label: '저장 전 초안',
        description: '수정한 통장내역이 아직 intake 기준본으로 저장되지 않았습니다. 저장 후 신규 거래 queue가 준비됩니다.',
        toneClass: 'border-amber-200/70 bg-amber-50/60',
      }
      : hasUploadedSheet
        ? {
          label: lastSavedAt ? '업로드 기준본 저장 완료' : '현재 저장본 사용 중',
          description: lastSavedAt
            ? '최근 저장본에서 신규 거래와 검토 필요 거래가 intake queue로 분리됩니다.'
            : '이미 저장된 통장내역 기준본을 열어 검토하고 있습니다.',
          toneClass: 'border-emerald-200/70 bg-emerald-50/60',
        }
        : {
          label: '원본 업로드 대기',
          description: '이번 주 원본 파일을 먼저 올리면 주간 사업비 입력의 시작점이 준비됩니다.',
          toneClass: 'border-slate-200/80 bg-slate-50/80',
        };
  const roleNotice = 'PM 화면 기준입니다. 이 화면의 저장본은 신규 거래 triage queue와 주간 사업비 입력의 기준점이 됩니다.';
  const uploadExperienceHint = uploadPreparing
    ? '엑셀 엔진을 준비하고 있습니다. 첫 업로드는 잠시 더 걸릴 수 있습니다.'
    : '엑셀 파일은 첫 업로드 때 엔진을 먼저 준비한 뒤 읽습니다.';
  const helperSteps = [
    {
      title: '1. 원본 업로드',
      description: '은행/카드 엑셀 또는 CSV를 올려 이번 주 원본을 불러옵니다.',
    },
    {
      title: '2. 필요한 행만 보정',
      description: '행 추가, 환수 행, 선사용금, 특이건만 보조로 정리합니다.',
    },
    {
      title: '3. 주간 사업비로 반영',
      description: '저장 후 현재 탭의 사업비 입력(주간)에서 바로 이어서 작업합니다.',
    },
  ];

  if (!ready) {
    return (
      <Card className="border-amber-200/70 bg-gradient-to-br from-amber-50 via-white to-orange-50/70">
        <CardContent className="p-6">
          <div className="max-w-2xl space-y-3">
            <h1 className="text-[20px] font-extrabold tracking-[-0.03em] text-slate-900">통장내역을 시작하려면 먼저 사업 연결이 필요합니다</h1>
            <p className="text-[13px] leading-6 text-slate-600">
              배정된 사업이 있어야 이번 주 원본 파일을 올리고, 주간 사업비 기준본으로 이어갈 수 있습니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate('/portal/project-settings')}>사업 연결 확인하기</Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/portal/weekly-expenses')}>
                주간 사업비 화면 보기
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[18px]" style={{ fontWeight: 700 }}>통장내역</h1>
            <Badge variant={hasUploadedSheet ? 'secondary' : 'outline'} className="text-[10px]">
              {hasUploadedSheet ? `${rows.length}건 불러옴` : '업로드 전'}
            </Badge>
            <Badge variant={dirty ? 'destructive' : 'secondary'} className="text-[10px]">
              {dirty ? '변경됨' : '저장됨'}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {getBankStatementProfileLabel(bankProfile)}
            </Badge>
          </div>
          <p className="text-[12px] text-muted-foreground">{projectName} · 카드/통장 내역 업로드</p>
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => navigate('/portal/weekly-expenses')}>
            사업비 입력(주간)
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
          <Button size="sm" onClick={openFilePicker} disabled={uploadPreparing}>
            {uploadPreparing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            {uploadPreparing ? '엑셀 준비 중' : hasUploadedSheet ? '파일 다시 업로드' : '엑셀 업로드'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onClick={() => warmXlsx()}
            onFocus={() => warmXlsx()}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file);
              e.currentTarget.value = '';
            }}
          />
          <Button variant="outline" size="sm" onClick={addRow} disabled={!hasUploadedSheet}>
            <Plus className="h-4 w-4 mr-1" /> 행 추가
          </Button>
          <Button variant="outline" size="sm" onClick={() => addSpecialTemplateRow('corp-card-refund')} disabled={!hasUploadedSheet}>
            환수 행
          </Button>
          <Button variant="outline" size="sm" onClick={() => addSpecialTemplateRow('prepaid-in')} disabled={!hasUploadedSheet}>
            선사용금
          </Button>
          <Button variant="outline" size="sm" onClick={() => addSpecialTemplateRow('special-case')} disabled={!hasUploadedSheet}>
            특이건
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={saving || !hasUploadedSheet}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            저장
          </Button>
        </div>
      </div>

      {!hasUploadedSheet && (
        <Card data-testid="bank-statement-empty-state" className="border-teal-200/80 bg-gradient-to-br from-teal-50/90 via-white to-emerald-50/60">
          <CardContent className="p-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
              <div
                className={`rounded-2xl border-2 border-dashed p-6 transition-colors ${
                  dragActive ? 'border-teal-500 bg-teal-50' : 'border-teal-200/80 bg-white/80'
                }`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                }}
                onDrop={handleDrop}
              >
                <div className="flex h-full flex-col justify-between gap-5">
                  <div className="space-y-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-sm">
                      <FileSpreadsheet className="h-5 w-5" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-teal-700">Mission 1</p>
                      <p className="text-[18px] font-semibold text-slate-900">이번 주 통장내역부터 올리세요</p>
                      <p className="max-w-2xl text-[13px] leading-6 text-slate-600">
                        원본 파일을 올리면 표는 그대로 유지한 채 이 화면에서 검토하고, 저장 후 바로 사업비 입력(주간)으로 이어서 정리할 수 있습니다.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" onClick={openFilePicker}>
                      {uploadPreparing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
                      {uploadPreparing ? '엑셀 준비 중' : '파일 선택'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigate('/portal/weekly-expenses')}>
                      사업비 입력(주간) 먼저 보기
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                    <span className="text-[11px] text-muted-foreground">지원 형식: `.csv`, `.xls`, `.xlsx`</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{uploadExperienceHint}</p>
                </div>
              </div>

              <div className="grid gap-3">
                {helperSteps.map((step) => (
                  <div key={step.title} className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-teal-600" />
                      <div className="space-y-1">
                        <p className="text-[12px] font-semibold text-slate-900">{step.title}</p>
                        <p className="text-[11px] leading-5 text-slate-600">{step.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="bank-statement-trust-surface" className={trustSurface.toneClass}>
        <CardContent className="px-4 py-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-700" />
            <div className="space-y-1 text-[12px] text-amber-900">
              <p className="font-semibold">반영 상태 · {trustSurface.label}</p>
              <p>{trustSurface.description}</p>
              <p>{roleNotice}</p>
              <p>
                현재 프로필: {getBankStatementProfileLabel(bankProfile)}
                {lastUploadedName ? ` · 최근 파일: ${lastUploadedName}` : ''}
              </p>
              {lastSavedAt && <p className="text-[11px] text-amber-800/80">마지막 자동저장: {lastSavedAt.slice(0, 16).replace('T', ' ')}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {hasUploadedSheet && (
        <Card data-testid="bank-import-queue-summary" className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13px] font-semibold text-slate-950">신규 거래 처리 Queue</p>
                  <Badge variant="outline" className="text-[10px]">
                    총 {queueWorkCount}건
                  </Badge>
                </div>
                <p className="text-[12px] leading-6 text-slate-600">
                  업로드한 원본은 이제 전체 주간 시트를 다시 쓰지 않습니다. 분류와 검토, 증빙 continuation이 필요한 거래만 queue로 남기고 나머지는 기존 주간 입력을 보존합니다.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                    분류 필요 {intakeSurface.needsClassification.length}
                  </Badge>
                  <Badge className="border-rose-200 bg-rose-50 text-rose-700">
                    검토 필요 {intakeSurface.reviewRequired.length}
                  </Badge>
                  <Badge className="border-sky-200 bg-sky-50 text-sky-700">
                    증빙 미완료 {intakeSurface.pendingEvidence.length}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate('/portal/weekly-expenses')}>
                  주간 사업비에서 보기
                </Button>
                <Button variant="outline" size="sm" onClick={() => setTriageOpen(true)} disabled={intakeSurface.pendingEvidence.length === 0}>
                  증빙 이어서 하기
                </Button>
                <Button data-testid="bank-import-open-wizard" size="sm" onClick={() => setTriageOpen(true)} disabled={queueWorkCount === 0}>
                  분류/검토 열기
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <PortalMissionGuide progress={missionProgress} compact />

      {hasUploadedSheet ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 bg-muted/60">
                  <tr>
                    <th className="px-2 py-1 text-left border-b border-r font-medium whitespace-nowrap w-12">
                      행
                    </th>
                    {columns.map((col, idx) => (
                      <th key={idx} className="px-2 py-1 text-left border-b border-r font-medium whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIdx) => (
                    <tr key={row.tempId || rowIdx} className="border-t border-border/30">
                      <td className="px-1.5 py-1 border-r border-border/30">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] text-muted-foreground">{rowIdx + 1}</span>
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 items-center justify-center rounded border text-muted-foreground hover:bg-muted"
                            onClick={() => removeRow(rowIdx)}
                            title="행 삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      {columns.map((_, colIdx) => (
                        <td
                          key={colIdx}
                          className="px-1.5 py-1 border-r border-border/30 focus-within:bg-teal-50/20 focus-within:shadow-[inset_0_0_0_2px_rgba(20,184,166,0.8)]"
                        >
                          <input
                            type="text"
                            value={row.cells[colIdx] || ''}
                            className="w-full bg-transparent outline-none text-[11px]"
                            onChange={(e) => updateCell(rowIdx, colIdx, e.target.value)}
                            onBlur={(e) => handleCellBlur(rowIdx, colIdx, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex min-h-[240px] items-center justify-center p-6">
            <div className="max-w-md text-center">
              <p className="text-[13px] font-medium text-slate-800">업로드 후 표가 여기에 그대로 표시됩니다.</p>
              <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
                헤더와 값은 원본 구조를 유지하고, 이 화면에서는 검토와 보조 입력만 이어서 진행합니다.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <BankImportTriageWizard
        open={triageOpen}
        onOpenChange={setTriageOpen}
        items={expenseIntakeItems}
        onSaveDraft={saveExpenseIntakeDraft}
        onProjectItem={projectExpenseIntakeItem}
        onSyncEvidence={syncExpenseIntakeEvidence}
        evidenceRequiredMap={evidenceRequiredMap}
      />
    </div>
  );
}
