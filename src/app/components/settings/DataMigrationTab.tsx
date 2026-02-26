import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Upload,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { Separator } from '../ui/separator';
import { useAppStore } from '../../data/store';
import {
  parseCsv, toCsv, escapeCsvCell, triggerDownload,
  normalizeSpace, normalizeKey, pickValue, parseNumber, parseDate, stableHash,
} from '../../platform/csv-utils';
import type {
  CashflowCategory,
  ParticipationEntry,
  PaymentMethod,
  Project,
  ProjectPhase,
  ProjectStatus,
  ProjectType,
  SettlementSystemCode,
  Transaction,
  TransactionState,
} from '../../data/types';

type MigrationSection = 'projects' | 'participationEntries' | 'transactions';

interface ParsedSheet {
  name: string;
  matrix: string[][];
}

interface FlatRow {
  rowNumber: number;
  values: Record<string, string>;
}

interface PreviewRow<T> {
  rowNumber: number;
  raw: Record<string, string>;
  normalized: T | null;
  errors: string[];
  warnings: string[];
}

interface ParticipationSummaryBaseline {
  rowNumber: number;
  memberName: string;
  nickname: string;
  totalRate: number | null;
  projectCount: number | null;
}

const SECTION_META: Record<MigrationSection, {
  label: string;
  description: string;
  requiredHint: string;
  templateHeaders: string[];
  templateSample: string[];
}> = {
  projects: {
    label: '사업 기본정보',
    description: '사업명, 발주기관, 진행단계, 계약금액 등 프로젝트 마스터 데이터',
    requiredHint: '필수: 사업명',
    templateHeaders: [
      '사업명',
      '발주기관',
      '담당조직',
      '진행 단계',
      '사업유형',
      '계약시작일',
      '계약종료일',
      '총 사업비 금액',
      '특이사항',
    ],
    templateSample: [
      '2026 에코스타트업',
      '기후에너지환경부/한국환경산업기술원',
      '스템CIC',
      '계약전',
      '컨설팅',
      '2026-02-01',
      '2026-11-30',
      '1200000000',
      'e나라도움',
    ],
  },
  participationEntries: {
    label: '인력구성/참여율',
    description: '인력 배정(이름, 사업명, 참여율, 기간) 데이터',
    requiredHint: '필수: 이름(본명), 사업명, 참여율',
    templateHeaders: [
      '이름(본명)',
      '별명',
      '사업명',
      '발주기관',
      '담당조직',
      '참여율 (100%)',
      '인건비 배정 기간',
      '특이사항',
    ],
    templateSample: [
      '김정태',
      '에이블',
      '2026 에코스타트업',
      '기후에너지환경부/한국환경산업기술원',
      '스템CIC',
      '10%',
      '2~11월',
      'e나라도움',
    ],
  },
  transactions: {
    label: '사업비/거래내역',
    description: '사업비 사용내역, 통장거래 등 트랜잭션 데이터',
    requiredHint: '필수: 사업명(또는 projectId), 거래일시, 금액',
    templateHeaders: [
      '사업명',
      '거래일시',
      '결제수단',
      '거래처',
      '적요',
      '금액',
      '입출금구분',
      '비목',
    ],
    templateSample: [
      '2026 에코스타트업',
      '2026-03-05',
      '계좌이체',
      '테스트 거래처',
      '홍보물 제작',
      '1500000',
      '출금',
      '직접사업비',
    ],
  },
};

export function DataMigrationTab() {
  const {
    org,
    currentUser,
    projects,
    ledgers,
    transactions,
    participationEntries,
    addProject,
    updateProject,
    addTransaction,
    updateTransaction,
    addParticipation,
    updateParticipation,
  } = useAppStore();

  const [section, setSection] = useState<MigrationSection>('projects');
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [headerRowInput, setHeaderRowInput] = useState('1');
  const [isParsing, setIsParsing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [lastFileName, setLastFileName] = useState('');
  const [applySummary, setApplySummary] = useState<string>('');
  const [parseError, setParseError] = useState<string>('');

  const activeSheet = useMemo(
    () => sheets.find((s) => s.name === selectedSheet) || null,
    [sheets, selectedSheet],
  );
  const isParticipationMatrix = useMemo(
    () => section === 'participationEntries' && !!activeSheet && detectParticipationMatrix(activeSheet.matrix),
    [section, activeSheet],
  );

  const headerRow = useMemo(() => {
    const n = Number.parseInt(headerRowInput, 10);
    return Number.isInteger(n) && n > 0 ? n : 1;
  }, [headerRowInput]);

  const parsedRows = useMemo<FlatRow[]>(() => {
    if (!activeSheet) return [];
    return matrixToRows(activeSheet.matrix, headerRow);
  }, [activeSheet, headerRow]);

  const projectByName = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) {
      map.set(normalizeKey(p.name), p);
    }
    return map;
  }, [projects]);

  const ledgerByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    for (const ledger of ledgers) {
      if (!map.has(ledger.projectId)) {
        map.set(ledger.projectId, ledger.id);
      }
    }
    return map;
  }, [ledgers]);

  const preview = useMemo(() => {
    if (!activeSheet) return [];

    if (section === 'participationEntries' && isParticipationMatrix) {
      return normalizeParticipationMatrixSheet(activeSheet.matrix, {
        projectsByName: projectByName,
        defaultYear: 2026,
      });
    }

    const rows = parsedRows;
    switch (section) {
      case 'projects':
        return rows.map((row) => normalizeProjectRow(row, {
          orgId: org.id,
          existingByName: projectByName,
        }));
      case 'participationEntries':
        return rows.map((row) => normalizeParticipationRow(row, {
          projectsByName: projectByName,
          defaultYear: 2026,
        }));
      case 'transactions':
        return rows.map((row) => normalizeTransactionRow(row, {
          actorId: currentUser.uid,
          projectsByName: projectByName,
          ledgerByProjectId,
        }));
      default:
        return [];
    }
  }, [
    activeSheet,
    parsedRows,
    section,
    isParticipationMatrix,
    org.id,
    projectByName,
    currentUser.uid,
    ledgerByProjectId,
  ]);

  const validRows = useMemo(
    () => preview.filter((p) => p.normalized && p.errors.length === 0),
    [preview],
  );

  const errorRows = useMemo(
    () => preview.filter((p) => p.errors.length > 0),
    [preview],
  );

  const warningRows = useMemo(
    () => preview.filter((p) => p.errors.length === 0 && p.warnings.length > 0),
    [preview],
  );
  const isParticipationFailClosed = section === 'participationEntries' && errorRows.length > 0;
  const isApplyDisabled = isApplying || validRows.length === 0 || isParticipationFailClosed;

  async function handleFileUpload(file: File) {
    setApplySummary('');
    setParseError('');
    setIsParsing(true);
    try {
      const parsedSheets = await parseUploadFile(file);
      if (parsedSheets.length === 0) {
        throw new Error('파일에서 읽을 수 있는 데이터 시트를 찾지 못했습니다.');
      }
      setSheets(parsedSheets);
      setSelectedSheet(parsedSheets[0].name);
      setLastFileName(file.name);
    } catch (err) {
      setParseError((err as Error).message || '파일 파싱에 실패했습니다.');
      setSheets([]);
      setSelectedSheet('');
    } finally {
      setIsParsing(false);
    }
  }

  async function applyImport() {
    if (section === 'participationEntries' && errorRows.length > 0) {
      setApplySummary(`적용 중단: 참여율 검증 오류 ${errorRows.length}건을 먼저 해결하세요.`);
      return;
    }
    if (validRows.length === 0) return;
    setIsApplying(true);
    setApplySummary('');

    let processed = 0;
    const importedIds = new Set<string>();
    const existingProjectIds = new Set(projects.map((p) => p.id));
    const existingParticipationIds = new Set(participationEntries.map((p) => p.id));
    const existingTransactionIds = new Set(transactions.map((t) => t.id));

    for (const row of validRows) {
      if (!row.normalized) continue;
      if (section === 'projects') {
        const project = row.normalized as Project;
        if (importedIds.has(project.id)) continue;
        importedIds.add(project.id);
        const exists = existingProjectIds.has(project.id);
        if (exists) {
          updateProject(project.id, project);
        } else {
          addProject(project);
          existingProjectIds.add(project.id);
        }
        processed++;
        continue;
      }

      if (section === 'participationEntries') {
        const entry = row.normalized as ParticipationEntry;
        if (importedIds.has(entry.id)) continue;
        importedIds.add(entry.id);
        const exists = existingParticipationIds.has(entry.id);
        if (exists) {
          updateParticipation(entry.id, entry);
        } else {
          addParticipation(entry);
          existingParticipationIds.add(entry.id);
        }
        processed++;
        continue;
      }

      if (section === 'transactions') {
        const tx = row.normalized as Transaction;
        if (importedIds.has(tx.id)) continue;
        importedIds.add(tx.id);
        const exists = existingTransactionIds.has(tx.id);
        if (exists) {
          updateTransaction(tx.id, tx);
        } else {
          addTransaction(tx);
          existingTransactionIds.add(tx.id);
        }
        processed++;
      }
    }

    setApplySummary(`적용 완료: ${processed}건`);
    setIsApplying(false);
  }

  async function downloadTemplateXlsx() {
    const meta = SECTION_META[section];
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(section);
    ws.addRow(meta.templateHeaders);
    ws.addRow(meta.templateSample);
    const buffer = await wb.xlsx.writeBuffer();
    triggerDownload(
      new Blob([buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `migration-template-${section}.xlsx`,
    );
  }

  function downloadTemplateCsv() {
    const meta = SECTION_META[section];
    const csv = toCsv([meta.templateHeaders, meta.templateSample]);
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `migration-template-${section}.csv`);
  }

  function downloadPreviewJson() {
    const payload = validRows
      .filter((row) => row.normalized)
      .map((row) => row.normalized);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `migration-preview-${section}.json`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileUp className="w-4 h-4" />
          섹션별 데이터 마이그레이션
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={section} onValueChange={(v) => setSection(v as MigrationSection)}>
          <TabsList>
            <TabsTrigger value="projects">사업 기본정보</TabsTrigger>
            <TabsTrigger value="participationEntries">인력구성/참여율</TabsTrigger>
            <TabsTrigger value="transactions">사업비/거래내역</TabsTrigger>
          </TabsList>

          <TabsContent value={section} className="space-y-4">
            <div className="p-3 rounded-md border bg-muted/30 space-y-2">
              <p className="text-sm" style={{ fontWeight: 600 }}>{SECTION_META[section].label}</p>
              <p className="text-xs text-muted-foreground">{SECTION_META[section].description}</p>
              <p className="text-xs text-muted-foreground">{SECTION_META[section].requiredHint}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplateCsv}>
                <Download className="w-3.5 h-3.5" />
                CSV 템플릿
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplateXlsx}>
                <FileSpreadsheet className="w-3.5 h-3.5" />
                엑셀 템플릿
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={downloadPreviewJson}
                disabled={validRows.length === 0}
              >
                <Download className="w-3.5 h-3.5" />
                미리보기 JSON
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <Label htmlFor="migration-file">CSV/XLSX 업로드</Label>
                <Input
                  id="migration-file"
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void handleFileUpload(file);
                    e.currentTarget.value = '';
                  }}
                />
                {lastFileName && <p className="text-xs text-muted-foreground mt-1">파일: {lastFileName}</p>}
              </div>
              <div>
                <Label htmlFor="header-row">헤더 시작 행 (1부터)</Label>
                <Input
                  id="header-row"
                  value={headerRowInput}
                  onChange={(e) => setHeaderRowInput(e.target.value)}
                  placeholder="1"
                  disabled={isParticipationMatrix}
                />
                {isParticipationMatrix && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    100-1 참여율(전체) 형식 감지됨: 헤더 행 자동 인식
                  </p>
                )}
              </div>
            </div>

            {sheets.length > 1 && (
              <div className="space-y-1">
                <Label htmlFor="sheet-select">엑셀 탭 선택</Label>
                <select
                  id="sheet-select"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={selectedSheet}
                  onChange={(e) => setSelectedSheet(e.target.value)}
                >
                  {sheets.map((s) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            {isParsing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                파일 파싱 중...
              </div>
            )}

            {parseError && (
              <div className="flex items-center gap-2 p-3 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-sm">
                <AlertTriangle className="w-4 h-4" />
                {parseError}
              </div>
            )}
            {isParticipationFailClosed && (
              <div className="flex items-center gap-2 p-3 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-sm">
                <AlertTriangle className="w-4 h-4" />
                참여율 fail-closed 모드: 오류 {errorRows.length}건이 있어 반영 버튼이 잠금 상태입니다.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">전체 {preview.length}행</Badge>
              {isParticipationMatrix && (
                <Badge className="bg-sky-100 text-sky-800">인력구성 매트릭스 모드</Badge>
              )}
              <Badge className="bg-emerald-100 text-emerald-800">적용 가능 {validRows.length}행</Badge>
              <Badge className="bg-amber-100 text-amber-800">경고 {warningRows.length}행</Badge>
              <Badge className="bg-rose-100 text-rose-800">오류 {errorRows.length}행</Badge>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm" style={{ fontWeight: 600 }}>미리보기 (최대 20행)</p>
                <Button
                  className="gap-1.5"
                  onClick={() => void applyImport()}
                  disabled={isApplyDisabled}
                >
                  {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  데이터 넣기
                </Button>
              </div>

              {applySummary && (
                <div className="flex items-center gap-2 p-3 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  {applySummary}
                </div>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>원본행</TableHead>
                    <TableHead>핵심 미리보기</TableHead>
                    <TableHead>검증</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 20).map((row) => (
                    <TableRow key={`${row.rowNumber}-${row.errors.join('|')}-${row.warnings.join('|')}`}>
                      <TableCell className="text-xs font-mono">{row.rowNumber}</TableCell>
                      <TableCell className="text-xs">{renderPreviewCore(section, row.normalized)}</TableCell>
                      <TableCell className="text-xs">
                        {row.errors.length > 0 ? (
                          <span className="text-rose-600">오류: {row.errors.join(', ')}</span>
                        ) : row.warnings.length > 0 ? (
                          <span className="text-amber-600">경고: {row.warnings.join(', ')}</span>
                        ) : (
                          <span className="text-emerald-600">정상</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {preview.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-8">
                        파일을 업로드하면 여기서 파싱 결과를 미리 볼 수 있습니다.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function renderPreviewCore(section: MigrationSection, row: unknown): string {
  if (!row || typeof row !== 'object') return '-';
  const r = row as Record<string, unknown>;
  if (section === 'projects') {
    return `${String(r.name || '-') } / ${String(r.clientOrg || '-') } / ${String(r.status || '-')}`;
  }
  if (section === 'participationEntries') {
    return `${String(r.memberName || '-')} → ${String(r.projectName || '-')} (${String(r.rate || '-') }%)`;
  }
  return `${String(r.dateTime || '-')} / ${String(r.counterparty || '-')} / ${String((r as any)?.amounts?.bankAmount ?? '-')}`;
}

async function parseUploadFile(file: File): Promise<ParsedSheet[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    const matrix = parseCsv(text);
    return [{ name: file.name, matrix }];
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    return wb.worksheets.map((ws) => {
      const matrix: string[][] = [];
      for (let r = 1; r <= ws.rowCount; r++) {
        const row: string[] = [];
        for (let c = 1; c <= ws.columnCount; c++) {
          row.push(cellToString(ws.getCell(r, c).value));
        }
        matrix.push(row);
      }
      return { name: ws.name, matrix };
    });
  }

  throw new Error('지원하지 않는 파일 형식입니다. CSV 또는 XLSX를 사용하세요.');
}

function matrixToRows(matrix: string[][], headerRow: number): FlatRow[] {
  if (matrix.length === 0) return [];
  const headerIdx = Math.max(0, headerRow - 1);
  const headerSource = matrix[headerIdx] || [];
  const headers = dedupeHeaders(headerSource);
  const rows: FlatRow[] = [];

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const line = matrix[i] || [];
    if (line.every((v) => !normalizeSpace(v))) continue;
    const values: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      values[headers[c]] = normalizeSpace(line[c] || '');
    }
    rows.push({ rowNumber: i + 1, values });
  }

  return rows;
}

function detectParticipationMatrix(matrix: string[][]): boolean {
  if (matrix.length === 0) return false;
  const projectRowIdx = findMatrixRowIndex(matrix, ['사업명']);
  const headerRowIdx = findParticipationHeaderRowIndex(matrix, projectRowIdx);
  return projectRowIdx >= 0 && headerRowIdx > projectRowIdx;
}

function normalizeParticipationMatrixSheet(
  matrix: string[][],
  ctx: { projectsByName: Map<string, Project>; defaultYear: number },
): PreviewRow<ParticipationEntry>[] {
  const projectRowIdx = findMatrixRowIndex(matrix, ['사업명']);
  const clientRowIdx = findMatrixRowIndex(matrix, ['발주기관']);
  const departmentRowIdx = findMatrixRowIndex(matrix, ['담당조직']);
  const noteRowIdx = findMatrixRowIndex(matrix, ['특이사항']);
  const statusRowIdx = findMatrixRowIndex(matrix, ['진행 단계', '사업진행상태']);
  const headerRowIdx = findParticipationHeaderRowIndex(matrix, projectRowIdx);

  if (projectRowIdx < 0 || headerRowIdx < 0) return [];

  const projectRow = matrix[projectRowIdx] || [];
  const clientRow = clientRowIdx >= 0 ? matrix[clientRowIdx] || [] : [];
  const departmentRow = departmentRowIdx >= 0 ? matrix[departmentRowIdx] || [] : [];
  const noteRow = noteRowIdx >= 0 ? matrix[noteRowIdx] || [] : [];
  const statusRow = statusRowIdx >= 0 ? matrix[statusRowIdx] || [] : [];
  const headerRow = matrix[headerRowIdx] || [];

  const maxCol = Math.max(
    projectRow.length,
    clientRow.length,
    departmentRow.length,
    noteRow.length,
    statusRow.length,
    headerRow.length,
  );

  const slots: Array<{ col: number; projectName: string }> = [];
  for (let col = 0; col < maxCol - 2; col++) {
    const projectName = normalizeSpace(projectRow[col] || '');
    const hName = normalizeKey(headerRow[col] || '');
    const hRate = normalizeKey(headerRow[col + 1] || '');
    const hPeriod = normalizeKey(headerRow[col + 2] || '');

    const hasTripletHeader = hName.includes('이름본명')
      && (hRate.includes('참여율') || hRate.includes('투입률') || hRate.includes('투입율'))
      && hPeriod.includes('기간');
    if (!hasTripletHeader) continue;
    if (!projectName || normalizeKey(projectName).includes('사업명')) continue;

    slots.push({ col, projectName });
  }

  if (slots.length === 0) return [];

  const summaryBaselines = collectParticipationSummaryBaselines(matrix, headerRowIdx);
  const previews: PreviewRow<ParticipationEntry>[] = [];
  for (let rowIdx = headerRowIdx + 1; rowIdx < matrix.length; rowIdx++) {
    const line = matrix[rowIdx] || [];
    if (line.every((v) => !normalizeSpace(v || ''))) continue;

    for (const slot of slots) {
      const memberName = normalizeSpace(line[slot.col] || '');
      const rate = normalizeSpace(line[slot.col + 1] || '');
      const period = normalizeSpace(line[slot.col + 2] || '');
      if (!memberName && !rate && !period) continue;

      const values: Record<string, string> = {
        '이름(본명)': memberName,
        '사업명': slot.projectName,
        '발주기관': normalizeSpace(clientRow[slot.col] || ''),
        '담당조직': normalizeSpace(departmentRow[slot.col] || ''),
        '특이사항': normalizeSpace(noteRow[slot.col] || ''),
        '진행 단계': normalizeSpace(statusRow[slot.col] || ''),
        '참여율 (100%)': rate,
        '인건비 배정 기간': period,
      };

      const row = normalizeParticipationRow({ rowNumber: rowIdx + 1, values }, ctx);
      previews.push(row);
    }
  }

  applyParticipationDuplicateIdErrors(previews);
  applyParticipationSummaryConsistencyErrors(previews, summaryBaselines);

  return previews;
}

function collectParticipationSummaryBaselines(
  matrix: string[][],
  headerRowIdx: number,
): ParticipationSummaryBaseline[] {
  const out: ParticipationSummaryBaseline[] = [];

  for (let rowIdx = headerRowIdx + 1; rowIdx < matrix.length; rowIdx++) {
    const line = matrix[rowIdx] || [];
    const memberName = normalizeSpace(line[0] || '');
    const nickname = normalizeSpace(line[1] || '');
    const totalRate = parsePercent100(normalizeSpace(line[2] || ''));
    const projectCountRaw = parseNumber(normalizeSpace(line[3] || ''));
    const projectCount = projectCountRaw == null ? null : Math.round(projectCountRaw);

    const hasAnySummary = !!memberName || !!nickname || totalRate != null || projectCount != null;
    if (!hasAnySummary) continue;
    if (!memberName || normalizeKey(memberName).includes('이름본명')) continue;

    out.push({
      rowNumber: rowIdx + 1,
      memberName,
      nickname,
      totalRate,
      projectCount,
    });
  }

  return out;
}

function applyParticipationDuplicateIdErrors(previews: PreviewRow<ParticipationEntry>[]) {
  const byId = new Map<string, PreviewRow<ParticipationEntry>[]>();
  for (const row of previews) {
    if (!row.normalized) continue;
    const id = String((row.normalized as ParticipationEntry).id || '');
    if (!id) continue;
    const bucket = byId.get(id) || [];
    bucket.push(row);
    byId.set(id, bucket);
  }

  for (const [id, rows] of byId.entries()) {
    if (rows.length <= 1) continue;
    const message = `중복 키 충돌(${id})`;
    rows.forEach((row) => pushUnique(row.errors, message));
  }
}

function applyParticipationSummaryConsistencyErrors(
  previews: PreviewRow<ParticipationEntry>[],
  baselines: ParticipationSummaryBaseline[],
) {
  if (baselines.length === 0 || previews.length === 0) return;

  const rowsByMember = new Map<string, PreviewRow<ParticipationEntry>[]>();
  for (const row of previews) {
    if (!row.normalized) continue;
    const memberName = normalizeSpace((row.normalized as ParticipationEntry).memberName || '');
    const key = normalizeKey(memberName);
    if (!key) continue;
    const bucket = rowsByMember.get(key) || [];
    bucket.push(row);
    rowsByMember.set(key, bucket);
  }

  const baselineMembers = new Set<string>();
  for (const base of baselines) {
    const memberKey = normalizeKey(base.memberName);
    if (!memberKey) continue;
    baselineMembers.add(memberKey);

    const rows = rowsByMember.get(memberKey) || [];
    const actualRate = round2(rows.reduce((sum, row) => {
      const entry = row.normalized as ParticipationEntry;
      return sum + (Number.isFinite(entry.rate) ? entry.rate : 0);
    }, 0));
    const actualProjectCount = new Set(
      rows
        .map((row) => normalizeKey((row.normalized as ParticipationEntry).projectName || ''))
        .filter(Boolean),
    ).size;

    const errors: string[] = [];
    const expectedLoad = (base.totalRate ?? 0) > 0 || (base.projectCount ?? 0) > 0;
    if (rows.length === 0 && expectedLoad) {
      errors.push('좌측 합계표 인원이 프로젝트 배정 데이터에 없습니다');
    }
    if (base.totalRate != null && Math.abs(actualRate - base.totalRate) > 0.5) {
      errors.push(`합계 참여율 불일치(원본 ${base.totalRate}%, 파싱 ${actualRate}%)`);
    }
    if (base.projectCount != null && actualProjectCount !== base.projectCount) {
      errors.push(`투입수 불일치(원본 ${base.projectCount}, 파싱 ${actualProjectCount})`);
    }

    if (errors.length === 0) continue;
    if (rows.length === 0) {
      previews.push({
        rowNumber: base.rowNumber,
        raw: {
          '이름(본명)': base.memberName,
          별명: base.nickname,
          '투입율 합계(%)': base.totalRate == null ? '' : String(base.totalRate),
          '투입수 합계': base.projectCount == null ? '' : String(base.projectCount),
        },
        normalized: null,
        errors,
        warnings: [],
      });
      continue;
    }

    rows.forEach((row) => errors.forEach((message) => pushUnique(row.errors, message)));
  }

  for (const [memberKey, rows] of rowsByMember.entries()) {
    if (baselineMembers.has(memberKey)) continue;
    rows.forEach((row) => pushUnique(row.warnings, '프로젝트 배정 인원이 좌측 합계표에 없습니다'));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pushUnique(arr: string[], message: string) {
  if (!arr.includes(message)) arr.push(message);
}

function findMatrixRowIndex(matrix: string[][], keywords: string[]): number {
  const keys = keywords.map((k) => normalizeKey(k));
  return matrix.findIndex((row) => {
    const first = normalizeKey(row?.[0] || '');
    return keys.some((k) => first.includes(k));
  });
}

function findParticipationHeaderRowIndex(matrix: string[][], projectRowIdx: number): number {
  const start = projectRowIdx >= 0 ? projectRowIdx + 1 : 0;
  for (let i = start; i < matrix.length; i++) {
    const row = matrix[i] || [];
    const first = normalizeKey(row[0] || '');
    if (!first.includes('이름본명')) continue;

    const nameCount = row.filter((v) => normalizeKey(v || '').includes('이름본명')).length;
    const rateCount = row.filter((v) => {
      const k = normalizeKey(v || '');
      return k.includes('참여율') || k.includes('투입률') || k.includes('투입율');
    }).length;

    if (nameCount >= 2 && rateCount >= 2) return i;
  }
  return -1;
}

function normalizeProjectRow(
  row: FlatRow,
  ctx: { orgId: string; existingByName: Map<string, Project> },
): PreviewRow<Project> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const now = new Date().toISOString();

  const name = pickValue(row.values, ['사업명', 'name', 'project name']);
  if (!name) errors.push('사업명 누락');

  const clientOrg = pickValue(row.values, ['발주기관', '계약기관', 'clientOrg']);
  const department = pickValue(row.values, ['담당조직', '부서', 'department']);
  const managerName = pickValue(row.values, ['메인 담당자', '담당자', 'managerName']);
  const status = parseProjectStatus(pickValue(row.values, ['진행 단계', '진행상태', '사업진행상태', 'status']));
  const type = parseProjectType(pickValue(row.values, ['사업유형', 'type']));
  const phase = parseProjectPhase(pickValue(row.values, ['phase', '구분', '확정']));
  const contractAmount = parseNumber(pickValue(row.values, ['총 사업비 금액', '계약금액', 'contractAmount'])) ?? 0;
  const contractStart = parseDate(pickValue(row.values, ['계약시작일', '시작일', 'contractStart']));
  const contractEnd = parseDate(pickValue(row.values, ['계약종료일', '종료일', 'contractEnd']));
  const special = pickValue(row.values, ['특이사항', '비고', 'note']);

  const existing = ctx.existingByName.get(normalizeKey(name));
  const id = existing?.id || `mig-p-${stableHash(`${name}|${clientOrg}`)}`;
  const slug = existing?.slug || slugify(name || id);

  if (!contractStart) warnings.push('계약시작일 누락(기본값 적용)');
  if (!contractEnd) warnings.push('계약종료일 누락(기본값 적용)');

  const normalized: Project = {
    id,
    slug,
    orgId: ctx.orgId,
    name: name || '(미정)',
    status,
    type,
    phase,
    contractAmount,
    contractStart: contractStart || now.slice(0, 10),
    contractEnd: contractEnd || now.slice(0, 10),
    settlementType: 'TYPE1',
    basis: 'SUPPLY_AMOUNT',
    accountType: 'NONE',
    paymentPlan: {
      contract: contractAmount,
      interim: 0,
      final: 0,
    },
    paymentPlanDesc: '',
    clientOrg: clientOrg || '',
    groupwareName: '',
    participantCondition: '',
    contractType: '',
    department: department || '',
    teamName: '',
    managerId: '',
    managerName: managerName || '',
    budgetCurrentYear: contractAmount,
    taxInvoiceAmount: 0,
    profitRate: 0,
    profitAmount: 0,
    isSettled: /정산|완료|o|yes/i.test(special),
    finalPaymentNote: special || '',
    confirmerName: '',
    lastCheckedAt: '',
    cashflowDiffNote: '',
    description: special || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  return { rowNumber: row.rowNumber, raw: row.values, normalized, errors, warnings };
}

function normalizeParticipationRow(
  row: FlatRow,
  ctx: { projectsByName: Map<string, Project>; defaultYear: number },
): PreviewRow<ParticipationEntry> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const now = new Date().toISOString();

  const memberName = pickValue(row.values, ['이름(본명)', '이름', '성명', 'memberName']);
  const nickname = pickValue(row.values, ['별명', '닉네임', 'nickname']);
  const projectName = pickValue(row.values, ['사업명', 'projectName']);
  const clientOrg = pickValue(row.values, ['발주기관', 'clientOrg']);
  const note = pickValue(row.values, ['특이사항', '비고', 'note']);
  const periodRaw = pickValue(row.values, ['인건비 배정 기간', '배정 기간', '기간', 'period']);
  const rateRaw = pickValue(row.values, ['참여율 (100%)', '참여율', '투입률', '투입율', 'rate']);
  const rate = parsePercent100(rateRaw);
  const project = ctx.projectsByName.get(normalizeKey(projectName));

  if (!memberName) errors.push('이름 누락');
  if (!projectName) errors.push('사업명 누락');
  if (rate == null) errors.push('참여율 누락');
  if (!project) errors.push('프로젝트 미매핑(사업명 확인 필요)');

  const period = parsePeriod(periodRaw, ctx.defaultYear);
  const id = `mig-pe-${stableHash(`${memberName}|${projectName}|${period.periodStart}|${period.periodEnd}`)}`;
  const normalized: ParticipationEntry = {
    id,
    memberId: `m-${stableHash(memberName || id)}`,
    memberName: memberName || '(미정)',
    projectId: project?.id || `unmapped-${stableHash(projectName || id)}`,
    projectName: projectName || '(미정)',
    rate: rate ?? 0,
    settlementSystem: parseSettlementSystem(note),
    clientOrg: clientOrg || project?.clientOrg || '',
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    isDocumentOnly: /서류/.test(note),
    note: note || '',
    updatedAt: now,
  };

  return { rowNumber: row.rowNumber, raw: row.values, normalized, errors, warnings };
}

function normalizeTransactionRow(
  row: FlatRow,
  ctx: {
    actorId: string;
    projectsByName: Map<string, Project>;
    ledgerByProjectId: Map<string, string>;
  },
): PreviewRow<Transaction> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const now = new Date().toISOString();

  const projectName = pickValue(row.values, ['사업명', 'projectName']);
  const projectIdRaw = pickValue(row.values, ['projectId', '사업ID']);
  const project = projectIdRaw
    ? [...ctx.projectsByName.values()].find((p) => p.id === projectIdRaw)
    : ctx.projectsByName.get(normalizeKey(projectName));

  if (!project) errors.push('프로젝트 매핑 실패');

  const amountRaw = pickValue(row.values, ['금액', '통장에 찍힌 입/출금액', '입출금액', '출금금액', '입금금액', 'bankAmount']);
  const amount = parseNumber(amountRaw);
  if (amount == null) errors.push('금액 누락');

  const dateRaw = pickValue(row.values, ['거래일시', '거래일', 'dateTime', '일자']);
  const dateTime = parseDate(dateRaw) || now.slice(0, 10);
  if (!parseDate(dateRaw)) warnings.push('거래일시 기본값(오늘) 적용');

  const method = parsePaymentMethod(pickValue(row.values, ['결제수단', '지출구분', 'method']));
  const direction = parseDirection(
    pickValue(row.values, ['입출금구분', 'direction']),
    amount ?? 0,
  );
  const weekCode = toWeekCode(dateTime);

  const ledgerId = project ? (ctx.ledgerByProjectId.get(project.id) || `l-${project.id}`) : 'unmapped-ledger';
  if (!ctx.ledgerByProjectId.get(project?.id || '')) warnings.push('원장 미매핑(기본 ledgerId 사용)');

  const cashflowLabel = pickValue(row.values, ['cashflow항목', '비목', 'cashflow', 'category']) || '기타';
  const id = `mig-tx-${stableHash(`${project?.id || projectName}|${dateTime}|${amount}|${cashflowLabel}|${row.rowNumber}`)}`;
  const bankAmount = Math.abs(amount ?? 0);

  const normalized: Transaction = {
    id,
    ledgerId,
    projectId: project?.id || 'unmapped-project',
    state: parseTxState(pickValue(row.values, ['상태', 'state'])),
    dateTime,
    weekCode,
    direction,
    method,
    cashflowCategory: parseCashflowCategory(cashflowLabel, direction),
    cashflowLabel,
    budgetCategory: pickValue(row.values, ['비목', 'budgetCategory']),
    counterparty: pickValue(row.values, ['거래처', 'counterparty']) || '미상',
    memo: pickValue(row.values, ['적요', 'memo']) || '',
    amounts: {
      bankAmount,
      depositAmount: direction === 'IN' ? bankAmount : 0,
      expenseAmount: direction === 'OUT' ? bankAmount : 0,
      vatIn: parseNumber(pickValue(row.values, ['매입부가세', 'vatIn'])) || 0,
      vatOut: parseNumber(pickValue(row.values, ['매출부가세', 'vatOut'])) || 0,
      vatRefund: parseNumber(pickValue(row.values, ['부가세환급', 'vatRefund'])) || 0,
      balanceAfter: parseNumber(pickValue(row.values, ['통장잔액', 'balanceAfter'])) || 0,
    },
    evidenceRequired: [],
    evidenceStatus: 'MISSING',
    evidenceMissing: [],
    attachmentsCount: 0,
    createdBy: ctx.actorId,
    createdAt: now,
    updatedBy: ctx.actorId,
    updatedAt: now,
  };

  return { rowNumber: row.rowNumber, raw: row.values, normalized, errors, warnings };
}

function dedupeHeaders(headers: string[]): string[] {
  const used = new Map<string, number>();
  const out: string[] = [];

  headers.forEach((raw, idx) => {
    const base = normalizeSpace(raw) || `column_${idx + 1}`;
    const seen = used.get(base) || 0;
    used.set(base, seen + 1);
    out.push(seen === 0 ? base : `${base}_${seen + 1}`);
  });

  return out;
}

// parseCsv, pickValue imported from ../../platform/csv-utils

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray((v as any).richText)) {
      return ((v as any).richText as Array<{ text: string }>).map((x) => x.text).join('');
    }
    if ('result' in v) {
      const result = (v as any).result;
      if (result == null) return '';
      return String(result);
    }
    if ('text' in v && typeof v.text === 'string') {
      return v.text;
    }
    if ('formula' in v || 'sharedFormula' in v || 'error' in v) {
      return '';
    }
  }
  return String(value);
}

// normalizeSpace, normalizeKey, parseNumber imported from ../../platform/csv-utils

function parsePercent100(raw: string): number | null {
  if (!raw) return null;
  const hasSign = raw.includes('%');
  const n = parseNumber(raw);
  if (n == null) return null;
  if (hasSign) return n;
  const compact = raw.replace(/\s+/g, '');
  const hasDecimal = compact.includes('.');
  if (n <= 1) return n * 100;
  // Excel 퍼센트 셀은 1.03(=103%)처럼 들어오는 경우가 있어 보정한다.
  if (hasDecimal && n < 10) return n * 100;
  return n;
}

// parseDate imported from ../../platform/csv-utils

function parsePeriod(raw: string, year: number): { periodStart: string; periodEnd: string } {
  const s = normalizeSpace(raw);
  if (!s) {
    return {
      periodStart: `${year}-01`,
      periodEnd: `${year}-12`,
    };
  }

  const compact = s.replace(/\s+/g, '');

  let start = 1;
  let end = 12;

  const ymRange = compact.match(/(\d{2,4})\.(\d{1,2})\.?[~\-](\d{2,4})\.(\d{1,2})\.?/);
  if (ymRange) {
    start = clampMonth(Number.parseInt(ymRange[2], 10));
    end = clampMonth(Number.parseInt(ymRange[4], 10));
  } else {
    const monthRange = compact.match(/(\d{1,2})월?[~\-](\d{1,2})월?/);
    if (monthRange) {
      start = clampMonth(Number.parseInt(monthRange[1], 10));
      end = clampMonth(Number.parseInt(monthRange[2], 10));
    } else {
      const monthTokens = [...compact.matchAll(/(\d{1,2})월/g)]
        .map((m) => Number.parseInt(m[1], 10))
        .filter((n) => Number.isFinite(n));

      if (monthTokens.length > 0) {
        start = clampMonth(Math.min(...monthTokens));
        end = clampMonth(Math.max(...monthTokens));
      } else {
        const duration = compact.match(/(\d{1,2})개월/);
        if (duration) {
          start = 1;
          end = clampMonth(Number.parseInt(duration[1], 10));
        } else {
          const nums = compact.match(/\d{1,2}/g)
            ?.map((x) => Number.parseInt(x, 10))
            .filter((x) => Number.isFinite(x)) || [];
          start = clampMonth(nums[0] || 1);
          end = clampMonth(nums[1] || nums[0] || 12);
        }
      }
    }
  }

  return {
    periodStart: `${year}-${String(start).padStart(2, '0')}`,
    periodEnd: `${year}-${String(end).padStart(2, '0')}`,
  };
}

function clampMonth(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(12, n));
}

function parseProjectStatus(raw: string): ProjectStatus {
  const s = normalizeSpace(raw);
  if (/완료|종료/.test(s)) return 'COMPLETED';
  if (/진행/.test(s)) return 'IN_PROGRESS';
  if (/잔금/.test(s)) return 'COMPLETED_PENDING_PAYMENT';
  return 'CONTRACT_PENDING';
}

function parseProjectType(raw: string): ProjectType {
  const s = normalizeSpace(raw);
  if (/개발협력|koica/i.test(s)) return 'DEV_COOPERATION';
  if (/컨설팅|ac/i.test(s)) return 'CONSULTING';
  if (/공간/.test(s)) return 'SPACE_BIZ';
  if (/투자|impact|ibs/i.test(s)) return 'IMPACT_INVEST';
  if (/교육/.test(s)) return 'EDUCATION';
  return 'OTHER';
}

function parseProjectPhase(raw: string): ProjectPhase {
  const s = normalizeSpace(raw);
  if (/확정|계약|진행|완료/.test(s)) return 'CONFIRMED';
  return 'PROSPECT';
}

function parseSettlementSystem(raw: string): SettlementSystemCode {
  const s = normalizeSpace(raw);
  if (/e.?나라도움/i.test(s)) return 'E_NARA_DOUM';
  if (/회계사.?정산/.test(s)) return 'ACCOUNTANT';
  if (/민간|고객사/.test(s)) return 'PRIVATE';
  return 'NONE';
}

function parsePaymentMethod(raw: string): PaymentMethod {
  const s = normalizeSpace(raw).toLowerCase();
  if (/법인카드.*1|뒷번호1|card.?1/.test(s)) return 'CORP_CARD_1';
  if (/법인카드.*2|뒷번호2|card.?2/.test(s)) return 'CORP_CARD_2';
  if (/법인카드|카드|card/.test(s)) return 'CORP_CARD_1';
  if (/계좌|이체|bank/.test(s)) return 'TRANSFER';
  return 'OTHER';
}

function parseDirection(raw: string, amount: number): 'IN' | 'OUT' {
  const s = normalizeSpace(raw).toLowerCase();
  if (/입금|in/.test(s)) return 'IN';
  if (/출금|out/.test(s)) return 'OUT';
  return amount < 0 ? 'OUT' : 'OUT';
}

function parseTxState(raw: string): TransactionState {
  const s = normalizeSpace(raw).toLowerCase();
  if (/제출|submitted/.test(s)) return 'SUBMITTED';
  if (/승인|approved/.test(s)) return 'APPROVED';
  if (/반려|rejected/.test(s)) return 'REJECTED';
  return 'DRAFT';
}

function parseCashflowCategory(raw: string, direction: 'IN' | 'OUT'): CashflowCategory {
  const s = normalizeSpace(raw).toLowerCase();
  if (/계약금/.test(s)) return 'CONTRACT_PAYMENT';
  if (/중도/.test(s)) return 'INTERIM_PAYMENT';
  if (/잔금/.test(s)) return 'FINAL_PAYMENT';
  if (/인건비|급여/.test(s)) return 'LABOR_COST';
  if (/외주|용역/.test(s)) return 'OUTSOURCING';
  if (/장비/.test(s)) return 'EQUIPMENT';
  if (/출장|교통/.test(s)) return 'TRAVEL';
  if (/소모품|식비|다과|회의/.test(s)) return 'SUPPLIES';
  if (/통신/.test(s)) return 'COMMUNICATION';
  if (/임차|임대/.test(s)) return 'RENT';
  if (/공과/.test(s)) return 'UTILITY';
  if (/세금/.test(s)) return 'TAX_PAYMENT';
  if (/환급|부가세/.test(s)) return 'VAT_REFUND';
  return direction === 'IN' ? 'MISC_INCOME' : 'MISC_EXPENSE';
}

function toWeekCode(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const day = Number.parseInt(m[3], 10);
  const week = Math.max(1, Math.min(5, Math.ceil(day / 7)));
  return `${m[1]}-${m[2]}-W${week}`;
}

function slugify(raw: string): string {
  const s = normalizeSpace(raw).toLowerCase().replace(/[^a-z0-9가-힣\s-]/g, '').replace(/\s+/g, '-');
  return s || `project-${Date.now()}`;
}

// stableHash, toCsv, escapeCsvCell, triggerDownload imported from ../../platform/csv-utils
