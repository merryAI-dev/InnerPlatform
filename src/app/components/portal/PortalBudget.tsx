import { useState, useMemo, useCallback, type DragEvent } from 'react';
import {
  Lock, SlidersHorizontal, ChevronDown, ChevronRight,
  Calculator, Wallet, TrendingUp, Info,
  ArrowUp, ArrowDown, Plus, Trash2, Settings, GripVertical, Upload,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/dialog';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Textarea } from '../ui/textarea';
import { PageHeader } from '../layout/PageHeader';
import { usePortalStore } from '../../data/portal-store';
import { toast } from 'sonner';
import {
  fmtKRW, fmtPercent, fmtShort,
  type BudgetRow,
} from '../../data/budget-data';
import type { BudgetPlanRow, BudgetCodeEntry, BudgetCodeRename } from '../../data/types';
import { BASIS_LABELS } from '../../data/types';
import {
  mergeBudgetCodeBooks,
  parseBudgetPlanImportText,
  selectBudgetPlanImportSheet,
} from '../../platform/budget-plan-import';
import { moveBudgetSubCode, moveBudgetSubCodeToIndex } from '../../platform/budget-code-book-order';
import { buildBudgetLabelKey, normalizeBudgetLabel } from '../../platform/budget-labels';
import { parseNumber } from '../../platform/csv-utils';
import { parseBudgetPlanMatrix, planBudgetPlanMerge } from '../../platform/google-sheet-migration';
import { parseLocalWorkbookFile, type LocalWorkbookSheet } from '../../platform/local-workbook';
import { SETTLEMENT_COLUMNS } from '../../platform/settlement-csv';

// ═══════════════════════════════════════════════════════════════
// PortalBudget — 예산총괄 (리디자인 — 모바일 우선, 깨짐 방지)
// ═══════════════════════════════════════════════════════════════

function groupIdForEntry(name: string): string {
  return normalizeBudgetLabel(name) || '기타';
}

function formatBudgetCodeLabel(_index: number, name: string): string {
  const trimmed = String(name || '').trim();
  return trimmed || '비목 미입력';
}

function formatSubCodeLabel(_codeIndex: number, _subIndex: number, name: string): string {
  const trimmed = String(name || '').trim();
  return trimmed || '세목 미입력';
}

// 소진율 색상
function burnColor(rate: number): string {
  if (rate >= 0.8) return '#e11d48';
  if (rate >= 0.5) return '#f59e0b';
  if (rate > 0) return '#059669';
  return '#94a3b8';
}

interface BudgetCodeImportPreview {
  rows: BudgetCodeEntry[];
  totalPairs: number;
  duplicatePairs: number;
  skippedRows: number;
  headerDetected: boolean;
  samplePairs: Array<{ code: string; subCode: string }>;
}

type BudgetPlanImportTab = 'file' | 'paste';

function parseCsvCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let idx = 0; idx < line.length; idx += 1) {
    const ch = line[idx];
    if (ch === '"') {
      if (inQuotes && line[idx + 1] === '"') {
        current += '"';
        idx += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function looksLikeBudgetCodeHeader(code: string, subCode: string): boolean {
  const left = normalizeBudgetLabel(code).replace(/\s+/g, '').toLowerCase();
  const right = normalizeBudgetLabel(subCode).replace(/\s+/g, '').toLowerCase();
  const codeCandidates = new Set(['비목', 'budgetcode', 'budgetcategory', 'category']);
  const subCandidates = new Set(['세목', 'subcode', 'subcategory', 'detailcategory']);
  return codeCandidates.has(left) && subCandidates.has(right);
}

function parseBudgetCodeImportText(text: string): BudgetCodeImportPreview {
  const grouped = new Map<string, { code: string; subCodes: string[]; seenSubs: Set<string> }>();
  const samplePairs: Array<{ code: string; subCode: string }> = [];
  const seenPairs = new Set<string>();
  const lines = text.split(/\r?\n/);
  let totalPairs = 0;
  let duplicatePairs = 0;
  let skippedRows = 0;
  let headerDetected = false;
  let processedLineCount = 0;

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const cells = line.includes('\t') ? line.split('\t').map((cell) => cell.trim()) : parseCsvCells(line);
    const rawCode = String(cells[0] || '').trim();
    const rawSubCode = String(cells[1] || '').trim();
    if (!rawCode || !rawSubCode) {
      skippedRows += 1;
      return;
    }
    if (processedLineCount === 0 && looksLikeBudgetCodeHeader(rawCode, rawSubCode)) {
      headerDetected = true;
      processedLineCount += 1;
      return;
    }
    processedLineCount += 1;

    const codeKey = normalizeBudgetLabel(rawCode);
    const subKey = normalizeBudgetLabel(rawSubCode);
    if (!codeKey || !subKey) {
      skippedRows += 1;
      return;
    }

    const pairKey = `${codeKey}|${subKey}`;
    if (seenPairs.has(pairKey)) {
      duplicatePairs += 1;
      return;
    }
    seenPairs.add(pairKey);
    totalPairs += 1;

    const existing = grouped.get(codeKey);
    if (existing) {
      if (!existing.seenSubs.has(subKey)) {
        existing.subCodes.push(rawSubCode);
        existing.seenSubs.add(subKey);
      }
    } else {
      grouped.set(codeKey, {
        code: rawCode,
        subCodes: [rawSubCode],
        seenSubs: new Set([subKey]),
      });
    }
    if (samplePairs.length < 6) {
      samplePairs.push({ code: rawCode, subCode: rawSubCode });
    }
  });

  return {
    rows: Array.from(grouped.values()).map((entry) => ({ code: entry.code, subCodes: entry.subCodes })),
    totalPairs,
    duplicatePairs,
    skippedRows,
    headerDetected,
    samplePairs,
  };
}

export function PortalBudget() {
  const {
    myProject,
    expenseSheetRows,
    budgetPlanRows,
    budgetCodeBook,
    saveBudgetPlanRows,
    saveBudgetCodeBook,
  } = usePortalStore();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedRow, setSelectedRow] = useState<BudgetRow | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [codeBookMode, setCodeBookMode] = useState(false);
  const [draftRows, setDraftRows] = useState<Array<{
    budgetCode: string;
    subCode: string;
    initialBudget: string;
    revisedBudget: string;
    note: string;
  }>>([]);
  const [draftCodeBook, setDraftCodeBook] = useState<BudgetCodeEntry[]>([]);
  const [codeBookEditorTab, setCodeBookEditorTab] = useState<'manual' | 'paste' | 'csv'>('manual');
  const [codeBookImportText, setCodeBookImportText] = useState('');
  const [codeBookImportFileName, setCodeBookImportFileName] = useState('');
  const [codeBookReplaceMode, setCodeBookReplaceMode] = useState(false);
  const [budgetImportOpen, setBudgetImportOpen] = useState(false);
  const [budgetImportTab, setBudgetImportTab] = useState<BudgetPlanImportTab>('file');
  const [budgetImportText, setBudgetImportText] = useState('');
  const [budgetImportFileName, setBudgetImportFileName] = useState('');
  const [budgetImportSheets, setBudgetImportSheets] = useState<LocalWorkbookSheet[]>([]);
  const [budgetImportSheetName, setBudgetImportSheetName] = useState('');
  const [budgetImportLoading, setBudgetImportLoading] = useState(false);
  const [budgetImportApplying, setBudgetImportApplying] = useState(false);
  const [draggedSubCode, setDraggedSubCode] = useState<{ codeIdx: number; subIdx: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    codeIdx: number;
    subIdx: number;
    position: 'before' | 'after';
  } | null>(null);

  const meta = myProject ? {
    projectId: myProject.id,
    projectName: myProject.name,
    year: new Date(myProject.contractStart).getFullYear(),
    funder: myProject.clientOrg,
    basis: BASIS_LABELS[myProject.basis] || myProject.basis,
    totalBudget: myProject.contractAmount,
    lastUpdated: myProject.updatedAt ? new Date(myProject.updatedAt).toLocaleDateString('ko-KR') : '-',
    updatedBy: myProject.managerName || '-',
  } : null;

  const toggleGroup = (gid: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(gid) ? next.delete(gid) : next.add(gid);
      return next;
    });
  };

  const planMap = useMemo(() => {
    const map = new Map<string, BudgetPlanRow>();
    (budgetPlanRows || []).forEach((row) => {
      map.set(buildBudgetLabelKey(row.budgetCode, row.subCode), row);
    });
    return map;
  }, [budgetPlanRows]);

  const spentMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!expenseSheetRows) return map;
    const budgetCodeIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '비목');
    const subCodeIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '세목');
    const bankAmountIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장에 찍힌 입/출금액');
    if (budgetCodeIdx < 0 || subCodeIdx < 0 || bankAmountIdx < 0) return map;
    for (const row of expenseSheetRows) {
      const amount = parseNumber(String(row.cells[bankAmountIdx] || '')) ?? 0;
      if (amount === 0) continue;
      const key = buildBudgetLabelKey(row.cells[budgetCodeIdx], row.cells[subCodeIdx]);
      if (key === '|') continue;
      map.set(key, (map.get(key) || 0) + amount);
    }
    return map;
  }, [expenseSheetRows]);

  const activeCodeBook = useMemo(
    () => budgetCodeBook,
    [budgetCodeBook],
  );

  const codeBookImportPreview = useMemo(
    () => parseBudgetCodeImportText(codeBookImportText),
    [codeBookImportText],
  );
  const budgetImportSelectedSheet = useMemo(
    () => budgetImportSheets.find((sheet) => sheet.name === budgetImportSheetName) || budgetImportSheets[0] || null,
    [budgetImportSheets, budgetImportSheetName],
  );
  const budgetImportMatrix = useMemo(
    () => (budgetImportTab === 'paste'
      ? parseBudgetPlanImportText(budgetImportText)
      : (budgetImportSelectedSheet?.matrix || [])),
    [budgetImportSelectedSheet?.matrix, budgetImportTab, budgetImportText],
  );
  const budgetImportParsed = useMemo(
    () => parseBudgetPlanMatrix(budgetImportMatrix),
    [budgetImportMatrix],
  );
  const budgetImportMergePlan = useMemo(
    () => planBudgetPlanMerge(budgetPlanRows || [], budgetImportParsed.rows),
    [budgetPlanRows, budgetImportParsed.rows],
  );
  const budgetImportMergedCodeBook = useMemo(
    () => mergeBudgetCodeBooks(budgetCodeBook, budgetImportParsed.codeBook),
    [budgetCodeBook, budgetImportParsed.codeBook],
  );
  const budgetImportMergedSubCodeCount = useMemo(
    () => budgetImportMergedCodeBook.reduce((sum, entry) => sum + entry.subCodes.length, 0),
    [budgetImportMergedCodeBook],
  );

  const formatInput = useCallback((value: string) => {
    const num = parseNumber(value);
    if (num == null) return '';
    return num.toLocaleString('ko-KR');
  }, []);

  const formatInputLive = useCallback((value: string) => {
    const trimmed = value.replace(/[^0-9.,-]/g, '');
    return formatInput(trimmed);
  }, [formatInput]);

  const resetBudgetImport = useCallback(() => {
    setBudgetImportTab('file');
    setBudgetImportText('');
    setBudgetImportFileName('');
    setBudgetImportSheets([]);
    setBudgetImportSheetName('');
    setBudgetImportLoading(false);
    setBudgetImportApplying(false);
  }, []);

  const openBudgetImport = useCallback(() => {
    resetBudgetImport();
    setBudgetImportOpen(true);
  }, [resetBudgetImport]);

  const closeBudgetImport = useCallback(() => {
    if (budgetImportApplying) return;
    setBudgetImportOpen(false);
    resetBudgetImport();
  }, [budgetImportApplying, resetBudgetImport]);

  const syncDraftRowCode = useCallback((prevCode: string, nextCode: string) => {
    if (!editMode) return;
    setDraftRows((prev) => prev.map((r) => (
      r.budgetCode === prevCode ? { ...r, budgetCode: nextCode } : r
    )));
  }, [editMode]);

  const syncDraftRowSubCode = useCallback((budgetCode: string, prevSub: string, nextSub: string) => {
    if (!editMode) return;
    setDraftRows((prev) => prev.map((r) => (
      r.budgetCode === budgetCode && r.subCode === prevSub ? { ...r, subCode: nextSub } : r
    )));
  }, [editMode]);

  const addDraftRow = useCallback((budgetCode: string, subCode: string) => {
    setDraftRows((prev) => ([
      ...prev,
      { budgetCode, subCode, initialBudget: '', revisedBudget: '', note: '' },
    ]));
  }, []);

  const removeDraftRows = useCallback((budgetCode: string, subCode?: string) => {
    setDraftRows((prev) => prev.filter((r) => {
      if (r.budgetCode !== budgetCode) return true;
      if (subCode == null) return false;
      return r.subCode !== subCode;
    }));
  }, []);

  const updateBudgetCode = useCallback((idx: number, nextCode: string) => {
    setDraftCodeBook((prev) => {
      const copy = prev.map((c) => ({ code: c.code, subCodes: [...c.subCodes] }));
      const before = copy[idx];
      if (!before) return prev;
      copy[idx] = { ...before, code: nextCode };
      if (before.code !== nextCode) syncDraftRowCode(before.code, nextCode);
      return copy;
    });
  }, [syncDraftRowCode]);

  const updateSubCode = useCallback((idx: number, subIdx: number, nextSub: string) => {
    setDraftCodeBook((prev) => {
      const copy = prev.map((c) => ({ code: c.code, subCodes: [...c.subCodes] }));
      const entry = copy[idx];
      if (!entry) return prev;
      const before = entry.subCodes[subIdx] || '';
      entry.subCodes[subIdx] = nextSub;
      if (before !== nextSub) syncDraftRowSubCode(entry.code, before, nextSub);
      return copy;
    });
  }, [syncDraftRowSubCode]);

  const addBudgetCode = useCallback(() => {
    setDraftCodeBook((prev) => ([...prev, { code: '', subCodes: [''] }]));
    addDraftRow('', '');
  }, [addDraftRow]);

  const removeBudgetCode = useCallback((idx: number) => {
    setDraftCodeBook((prev) => {
      const entry = prev[idx];
      const next = prev.filter((_, i) => i !== idx);
      if (entry?.code) removeDraftRows(entry.code);
      return next;
    });
  }, [removeDraftRows]);

  const addSubCode = useCallback((idx: number) => {
    setDraftCodeBook((prev) => {
      const copy = prev.map((c) => ({ code: c.code, subCodes: [...c.subCodes] }));
      const entry = copy[idx];
      if (!entry) return prev;
      entry.subCodes.push('');
      addDraftRow(entry.code, '');
      return copy;
    });
  }, [addDraftRow]);

  const removeSubCode = useCallback((idx: number, subIdx: number) => {
    setDraftCodeBook((prev) => {
      const copy = prev.map((c) => ({ code: c.code, subCodes: [...c.subCodes] }));
      const entry = copy[idx];
      if (!entry) return prev;
      const removed = entry.subCodes[subIdx] || '';
      entry.subCodes = entry.subCodes.filter((_, i) => i !== subIdx);
      if (entry.code && removed) removeDraftRows(entry.code, removed);
      return copy;
    });
  }, [removeDraftRows]);

  const reorderSubCode = useCallback((idx: number, subIdx: number, direction: 'up' | 'down') => {
    setDraftCodeBook((prev) => moveBudgetSubCode(prev, idx, subIdx, direction));
  }, []);

  const handleSubCodeDragStart = useCallback((codeIdx: number, subIdx: number) => {
    setDraggedSubCode({ codeIdx, subIdx });
    setDropTarget({ codeIdx, subIdx, position: 'before' });
  }, []);

  const handleSubCodeDragOver = useCallback((
    event: DragEvent<HTMLDivElement>,
    codeIdx: number,
    subIdx: number,
  ) => {
    if (!draggedSubCode || draggedSubCode.codeIdx !== codeIdx) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY - rect.top > rect.height / 2 ? 'after' : 'before';
    setDropTarget({ codeIdx, subIdx, position });
  }, [draggedSubCode]);

  const handleSubCodeDrop = useCallback((codeIdx: number, subIdx: number) => {
    if (!draggedSubCode || draggedSubCode.codeIdx !== codeIdx) {
      setDraggedSubCode(null);
      setDropTarget(null);
      return;
    }

    setDraftCodeBook((prev) => {
      const entry = prev[codeIdx];
      if (!entry) return prev;

      const insertIndex = dropTarget?.codeIdx === codeIdx && dropTarget.subIdx === subIdx
        ? (dropTarget.position === 'after' ? subIdx + 1 : subIdx)
        : subIdx;
      const boundedInsertIndex = Math.max(0, Math.min(insertIndex, entry.subCodes.length));
      const targetIndex = draggedSubCode.subIdx < boundedInsertIndex
        ? boundedInsertIndex - 1
        : boundedInsertIndex;

      return moveBudgetSubCodeToIndex(prev, codeIdx, draggedSubCode.subIdx, targetIndex);
    });
    setDraggedSubCode(null);
    setDropTarget(null);
  }, [draggedSubCode, dropTarget]);

  const handleSubCodeDragEnd = useCallback(() => {
    setDraggedSubCode(null);
    setDropTarget(null);
  }, []);

  const startEdit = useCallback(() => {
    const next = budgetCodeBook.flatMap((entry) => (
      entry.subCodes.map((subCode) => {
        const key = buildBudgetLabelKey(entry.code, subCode);
        const existing = planMap.get(key);
        return {
          budgetCode: entry.code,
          subCode,
          initialBudget: existing?.initialBudget ? existing.initialBudget.toLocaleString('ko-KR') : '',
          revisedBudget: existing?.revisedBudget ? existing.revisedBudget.toLocaleString('ko-KR') : '',
          note: existing?.note || '',
        };
      })
    ));
    setDraftRows(next);
    setEditMode(true);
  }, [planMap, budgetCodeBook]);

  const startCodeBookEdit = useCallback(() => {
    setDraftCodeBook(budgetCodeBook.map((c) => ({ code: c.code, subCodes: [...c.subCodes] })));
    setCodeBookEditorTab('manual');
    setCodeBookImportText('');
    setCodeBookImportFileName('');
    setCodeBookReplaceMode(false);
    setCodeBookMode(true);
  }, [budgetCodeBook]);

  const cancelEdit = useCallback(() => {
    setEditMode(false);
    setCodeBookMode(false);
    setDraftRows([]);
    setDraftCodeBook([]);
    setCodeBookEditorTab('manual');
    setCodeBookImportText('');
    setCodeBookImportFileName('');
    setCodeBookReplaceMode(false);
    setDraggedSubCode(null);
    setDropTarget(null);
  }, []);

  const applyImportedCodeBook = useCallback(() => {
    if (codeBookImportPreview.rows.length === 0) {
      toast.error('가져올 비목/세목 구조를 먼저 입력해 주세요.');
      return;
    }
    setDraftCodeBook(codeBookImportPreview.rows.map((entry) => ({
      code: entry.code,
      subCodes: [...entry.subCodes],
    })));
    setCodeBookReplaceMode(true);
    setCodeBookEditorTab('manual');
    toast.success(`비목 ${codeBookImportPreview.rows.length}개, 세목 ${codeBookImportPreview.totalPairs}건을 구조 초안으로 불러왔습니다.`);
  }, [codeBookImportPreview]);

  const handleCodeBookImportFile = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setCodeBookImportText(text);
      setCodeBookImportFileName(file.name);
      setCodeBookEditorTab('csv');
    } catch (error) {
      console.error('[PortalBudget] code book file import failed:', error);
      toast.error('CSV 파일을 읽지 못했습니다.');
    }
  }, []);

  const handleBudgetImportFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setBudgetImportLoading(true);
    try {
      const sheets = await parseLocalWorkbookFile(file);
      const preferredSheet = selectBudgetPlanImportSheet(sheets);
      setBudgetImportFileName(file.name);
      setBudgetImportSheets(sheets);
      setBudgetImportSheetName(preferredSheet?.name || sheets[0]?.name || '');
      setBudgetImportTab('file');
      if (!preferredSheet) {
        toast.error('가져올 시트를 찾지 못했습니다.');
      }
    } catch (error) {
      console.error('[PortalBudget] budget import file parse failed:', error);
      toast.error('예산 파일을 읽지 못했습니다. `.xls`/`.xlsx`/`.csv` 파일인지 확인해 주세요.');
    } finally {
      setBudgetImportLoading(false);
    }
  }, []);

  const buildCodeBookRenames = useCallback((): BudgetCodeRename[] => {
    if (!codeBookMode) return [];
    const renames: BudgetCodeRename[] = [];
    draftCodeBook.forEach((nextEntry, idx) => {
      const prevEntry = budgetCodeBook[idx];
      if (!prevEntry) return;
      const prevCode = normalizeBudgetLabel(prevEntry.code);
      const nextCode = normalizeBudgetLabel(nextEntry.code);
      if (!prevCode || !nextCode) return;
      const prevSubs = prevEntry.subCodes || [];
      const nextSubs = nextEntry.subCodes || [];
      const max = Math.min(prevSubs.length, nextSubs.length);
      for (let sidx = 0; sidx < max; sidx += 1) {
        const prevSub = normalizeBudgetLabel(prevSubs[sidx]);
        const nextSub = normalizeBudgetLabel(nextSubs[sidx]);
        if (!prevSub || !nextSub) continue;
        if (prevCode !== nextCode || prevSub !== nextSub) {
          renames.push({ fromCode: prevCode, fromSub: prevSub, toCode: nextCode, toSub: nextSub });
        }
      }
    });
    return renames;
  }, [budgetCodeBook, draftCodeBook, codeBookMode]);

  const saveSettings = useCallback(async () => {
    if (!saveBudgetPlanRows && !saveBudgetCodeBook) return;
    const normalized: BudgetPlanRow[] = editMode ? draftRows.map((row) => {
      const budgetCode = normalizeBudgetLabel(String(row.budgetCode || '').trim());
      const subCode = normalizeBudgetLabel(String(row.subCode || '').trim());
      const initial = parseNumber(row.initialBudget) ?? 0;
      const revised = parseNumber(row.revisedBudget) ?? 0;
      return {
        budgetCode,
        subCode,
        initialBudget: initial,
        revisedBudget: revised,
        ...(row.note ? { note: row.note } : {}),
      };
    }).filter((row) => row.budgetCode && row.subCode)
      .filter((row) => row.initialBudget > 0 || (row.revisedBudget ?? 0) > 0 || (row.note && row.note.trim() !== ''))
      : [];

    setSettingsSaving(true);
    try {
      if (codeBookMode && saveBudgetCodeBook && draftCodeBook.length > 0) {
        const renames = codeBookReplaceMode ? [] : buildCodeBookRenames();
        await saveBudgetCodeBook(draftCodeBook, renames);
      }
      if (editMode) {
        await saveBudgetPlanRows(normalized);
      }
      setEditMode(false);
      setCodeBookMode(false);
      setDraftRows([]);
      setDraftCodeBook([]);
      setCodeBookEditorTab('manual');
      setCodeBookImportText('');
      setCodeBookImportFileName('');
      setCodeBookReplaceMode(false);
      toast.success(codeBookMode && !editMode ? '예산 항목 구조가 저장되었습니다.' : '예산이 저장되었습니다.');
    } catch (err) {
      console.error('[PortalBudget] save failed:', err);
      toast.error(codeBookMode && !editMode ? '예산 항목 구조 저장에 실패했습니다.' : '예산 저장에 실패했습니다.');
    } finally {
      setSettingsSaving(false);
    }
  }, [draftRows, draftCodeBook, saveBudgetPlanRows, saveBudgetCodeBook, editMode, codeBookMode, buildCodeBookRenames, codeBookReplaceMode]);

  const applyBudgetImport = useCallback(async () => {
    if (!saveBudgetPlanRows || !saveBudgetCodeBook) {
      toast.error('예산 저장 기능이 연결되어 있지 않습니다.');
      return;
    }
    if (budgetImportMergePlan.importedRows.length === 0) {
      toast.error('가져올 예산 행을 먼저 준비해 주세요.');
      return;
    }

    setBudgetImportApplying(true);
    try {
      await saveBudgetPlanRows(budgetImportMergePlan.mergedRows);
      await saveBudgetCodeBook(budgetImportMergedCodeBook);
      toast.success(
        `예산 ${budgetImportMergePlan.summary.importedCount}건을 가져왔습니다. `
        + `${budgetImportMergePlan.summary.updateCount}건 갱신, `
        + `${budgetImportMergePlan.summary.createCount}건 추가, `
        + `${budgetImportMergePlan.summary.unchangedCount}건은 그대로 유지했습니다.`,
      );
      setBudgetImportOpen(false);
      resetBudgetImport();
    } catch (error) {
      console.error('[PortalBudget] budget import apply failed:', error);
      toast.error('예산 가져오기에 실패했습니다.');
    } finally {
      setBudgetImportApplying(false);
    }
  }, [
    budgetImportMergePlan,
    budgetImportMergedCodeBook,
    resetBudgetImport,
    saveBudgetCodeBook,
    saveBudgetPlanRows,
  ]);

  const budgetItems = useMemo(() => {
    const items: BudgetRow[] = activeCodeBook.flatMap((entry, codeIdx) => (
      entry.subCodes.map((subCode, subIdx) => {
        const lookupKey = buildBudgetLabelKey(entry.code, subCode);
        const plan = planMap.get(lookupKey);
        const initial = plan?.initialBudget ?? 0;
        const revised = plan?.revisedBudget ?? 0;
        const effective = revised > 0 ? revised : initial;
        const spent = spentMap.get(lookupKey) ?? 0;
        const balance = effective - spent;
        const burnRate = effective > 0 ? spent / effective : 0;
        const codeLabel = formatBudgetCodeLabel(codeIdx, entry.code);
        const subLabel = formatSubCodeLabel(codeIdx, subIdx, subCode);
        const groupId = groupIdForEntry(entry.code);
        return {
          id: lookupKey,
          projectId: myProject?.id || '',
          category: groupId,
          budgetCode: codeLabel,
          subCode: subLabel,
          calcDesc: '',
          initialBudget: initial,
          lastYearBudget: 0,
          comparison: '',
          revisedAug: revised,
          revisedOct: 0,
          planAmount: 0,
          composition: 0,
          spent,
          vatPurchase: 0,
          burnRate,
          balance,
          balanceOct: 0,
          note: plan?.note || '',
          rowType: 'ITEM',
          fixType: 'NONE',
          groupId,
          order: 0,
        } as BudgetRow;
      })
    ));

    const totalEffective = items.reduce((sum, row) => {
      const effective = row.revisedAug > 0 ? row.revisedAug : row.initialBudget;
      return sum + effective;
    }, 0);

    return items.map((row) => {
      const effective = row.revisedAug > 0 ? row.revisedAug : row.initialBudget;
      return {
        ...row,
        composition: totalEffective > 0 ? effective / totalEffective : 0,
      };
    });
  }, [planMap, spentMap, myProject?.id, activeCodeBook]);

  const groups = useMemo(() => {
    const groupMap: Record<string, { subtotal: BudgetRow; items: BudgetRow[] }> = {};
    const ungrouped: BudgetRow[] = [];
    budgetItems.forEach((row) => {
      if (!row.groupId) { ungrouped.push(row); return; }
      if (!groupMap[row.groupId]) {
        groupMap[row.groupId] = {
          subtotal: {
            ...row,
            id: `${row.groupId}-subtotal`,
            budgetCode: '',
            subCode: '',
            rowType: 'SUBTOTAL',
            fixType: 'NONE',
            spent: 0,
            burnRate: 0,
            balance: 0,
            initialBudget: 0,
            revisedAug: 0,
          } as BudgetRow,
          items: [],
        };
      }
      groupMap[row.groupId].items.push(row);
    });

    Object.values(groupMap).forEach((group) => {
      const initialSum = group.items.reduce((s, r) => s + (r.initialBudget || 0), 0);
      const revisedSum = group.items.reduce((s, r) => s + (r.revisedAug || 0), 0);
      const effectiveSum = group.items.reduce((s, r) => s + ((r.revisedAug > 0 ? r.revisedAug : r.initialBudget) || 0), 0);
      const spentSum = group.items.reduce((s, r) => s + (r.spent || 0), 0);
      group.subtotal = {
        ...group.subtotal,
        initialBudget: initialSum,
        revisedAug: revisedSum,
        spent: spentSum,
        balance: effectiveSum - spentSum,
        burnRate: effectiveSum > 0 ? spentSum / effectiveSum : 0,
      };
    });

    return { groupMap, ungrouped };
  }, [budgetItems]);

  const total = useMemo(() => {
    const initialSum = budgetItems.reduce((s, r) => s + (r.initialBudget || 0), 0);
    const revisedSum = budgetItems.reduce((s, r) => s + (r.revisedAug || 0), 0);
    const effectiveSum = budgetItems.reduce((s, r) => s + ((r.revisedAug > 0 ? r.revisedAug : r.initialBudget) || 0), 0);
    const spentSum = budgetItems.reduce((s, r) => s + (r.spent || 0), 0);
    return {
      initialBudget: initialSum,
      revisedAug: revisedSum,
      spent: spentSum,
      balance: effectiveSum - spentSum,
      burnRate: effectiveSum > 0 ? spentSum / effectiveSum : 0,
      effectiveBudget: effectiveSum,
    };
  }, [budgetItems]);

  const auxRows = useMemo(() => {
    const effectiveTotal = total.effectiveBudget || 0;
    return Object.entries(groups.groupMap).map(([gid, group]) => {
      const effective = group.subtotal.revisedAug > 0 ? group.subtotal.revisedAug : group.subtotal.initialBudget;
      return {
        label: gid || '기타',
        amount: effective,
        ratio: effectiveTotal > 0 ? effective / effectiveTotal : 0,
      };
    });
  }, [groups.groupMap, total.effectiveBudget]);

  const getEffectiveBudget = useCallback((row: BudgetRow) => {
    return row.revisedAug > 0 ? row.revisedAug : row.initialBudget;
  }, []);

  if (!meta) {
    return <div className="p-8 text-center text-muted-foreground">프로젝트를 선택해 주세요.</div>;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <PageHeader
          icon={Calculator}
          iconGradient="linear-gradient(135deg, #0d9488 0%, #059669 100%)"
          title="예산 편집"
          description={myProject ? myProject.name : '예산 현황'}
          badge={`${meta.year}년`}
          actions={(
            <div className="flex items-center gap-2">
              {editMode ? (
                <>
                  <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={cancelEdit}>
                    취소
                  </Button>
                  <Button size="sm" className="h-8 text-[12px]" onClick={saveSettings} disabled={settingsSaving}>
                    {settingsSaving ? '저장 중...' : '저장'}
                  </Button>
                </>
              ) : !codeBookMode ? (
                <>
                  <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1" onClick={openBudgetImport}>
                    <Upload className="w-3.5 h-3.5" />
                    예산 가져오기
                  </Button>
                  <Button variant="default" size="sm" className="h-8 text-[12px] shadow-sm" onClick={startEdit}>
                    예산 편집
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1" onClick={startCodeBookEdit}>
                    <Settings className="w-3.5 h-3.5" />
                    구조 관리
                  </Button>
                </>
              ) : null}
            </div>
          )}
        />

        <Dialog open={budgetImportOpen} onOpenChange={(open) => !open && closeBudgetImport()}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle className="text-[14px]">예산총괄 가져오기</DialogTitle>
            </DialogHeader>
            <div className="flex max-h-[calc(85vh-4rem)] flex-col gap-3">
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-[11px] font-medium text-foreground">예산총괄 엑셀 또는 복붙 데이터를 미리본 뒤 안전하게 반영합니다.</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  기본 동작은 merge입니다. 기존 예산 행은 유지하고, 같은 비목/세목은 갱신하며, 새 항목만 추가합니다.
                </p>
              </div>

              <Tabs
                value={budgetImportTab}
                onValueChange={(value) => setBudgetImportTab(value as BudgetPlanImportTab)}
                className="min-h-0 flex-1"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="file" className="text-[11px]">엑셀/CSV 파일</TabsTrigger>
                  <TabsTrigger value="paste" className="text-[11px]">엑셀 붙여넣기</TabsTrigger>
                </TabsList>

                <TabsContent value="file" className="space-y-3">
                  <div className="rounded-md border border-border/60 p-3 space-y-2">
                    <p className="text-[11px] font-medium">`.xls`, `.xlsx`, `.csv` 파일을 바로 읽습니다.</p>
                    <p className="text-[10px] text-muted-foreground">
                      시트가 여러 개면 예산총괄로 보이는 탭을 먼저 고르고, 필요하면 아래에서 직접 시트를 바꿀 수 있습니다.
                    </p>
                  </div>
                  <div className="rounded-md border border-dashed border-border/70 p-4">
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="block w-full text-[11px]"
                      onChange={(event) => {
                        void handleBudgetImportFile(event.target.files?.[0] || null);
                        event.currentTarget.value = '';
                      }}
                    />
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {budgetImportLoading
                        ? '파일을 읽는 중입니다...'
                        : budgetImportFileName
                          ? `${budgetImportFileName} 파일을 읽어 미리보기를 준비했습니다.`
                          : '업로드 후 아래에서 시트와 반영 요약을 확인하세요.'}
                    </p>
                  </div>
                  {budgetImportSheets.length > 1 ? (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground">가져올 시트</p>
                      <select
                        value={budgetImportSheetName}
                        onChange={(event) => setBudgetImportSheetName(event.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] outline-none"
                      >
                        {budgetImportSheets.map((sheet) => (
                          <option key={sheet.name} value={sheet.name}>
                            {sheet.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </TabsContent>

                <TabsContent value="paste" className="space-y-3">
                  <div className="rounded-md border border-border/60 p-3 space-y-2">
                    <p className="text-[11px] font-medium">예산총괄 표를 그대로 복사해서 붙여넣을 수 있습니다.</p>
                    <p className="text-[10px] text-muted-foreground">
                      `비목`, `세목`, `최초 승인 예산` 헤더가 들어 있으면 자동 인식합니다. 탭 복붙과 CSV 붙여넣기를 모두 지원합니다.
                    </p>
                    <div className="rounded-md bg-slate-950 px-3 py-2 font-mono text-[10px] text-slate-50 whitespace-pre-wrap">
                      사업비 구분{'\t'}비목{'\t'}세목{'\t'}최초 승인 예산{'\t'}변경 예산{'\n'}
                      직접사업비{'\t'}여비{'\t'}교통비{'\t'}100,000{'\t'}120,000
                    </div>
                  </div>
                  <Textarea
                    value={budgetImportText}
                    onChange={(event) => setBudgetImportText(event.target.value)}
                    placeholder={'사업비 구분\t비목\t세목\t최초 승인 예산\t변경 예산\n직접사업비\t여비\t교통비\t100,000\t120,000'}
                    className="min-h-[220px] text-[11px] font-mono"
                  />
                </TabsContent>
              </Tabs>

              <div className="rounded-md border border-border/60 p-3 text-[10px] text-muted-foreground">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>가져온 행 {budgetImportMergePlan.summary.importedCount}건</span>
                  <span>갱신 {budgetImportMergePlan.summary.updateCount}건</span>
                  <span>신규 {budgetImportMergePlan.summary.createCount}건</span>
                  <span>유지 {budgetImportMergePlan.summary.unchangedCount}건</span>
                  <span>비목 {budgetImportMergedCodeBook.length}개</span>
                  <span>세목 {budgetImportMergedSubCodeCount}건</span>
                </div>
                {budgetImportTab === 'file' && budgetImportFileName ? (
                  <p className="mt-2">
                    파일: <strong className="text-foreground">{budgetImportFileName}</strong>
                    {budgetImportSelectedSheet ? ` / 시트: ${budgetImportSelectedSheet.name}` : ''}
                  </p>
                ) : null}
                {budgetImportMatrix.length > 0 && budgetImportParsed.rows.length === 0 ? (
                  <p className="mt-2 text-rose-600">
                    예산총괄 헤더를 찾지 못했습니다. `비목`, `세목`, `최초 승인 예산` 열이 들어 있는지 확인해 주세요.
                  </p>
                ) : null}
                {budgetImportMergePlan.importedRows.length > 0 ? (
                  <p className="mt-2">
                    동일한 비목/세목 키는 덮어쓰고, 현재 화면에만 있는 기존 예산 항목은 삭제하지 않습니다.
                  </p>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border/60">
                {budgetImportMergePlan.importedRows.length > 0 ? (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="px-3 py-2 text-left" style={{ fontWeight: 600 }}>비목</th>
                        <th className="px-3 py-2 text-left" style={{ fontWeight: 600 }}>세목</th>
                        <th className="px-3 py-2 text-right" style={{ fontWeight: 600 }}>최초 승인 예산</th>
                        <th className="px-3 py-2 text-right" style={{ fontWeight: 600 }}>변경 예산</th>
                        <th className="px-3 py-2 text-left" style={{ fontWeight: 600 }}>특이사항</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budgetImportMergePlan.importedRows.slice(0, 8).map((row, rowIdx) => (
                        <tr key={`${buildBudgetLabelKey(row.budgetCode, row.subCode)}-${rowIdx}`} className="border-t border-border/40">
                          <td className="px-3 py-2">{row.budgetCode}</td>
                          <td className="px-3 py-2">{row.subCode}</td>
                          <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {fmtKRW(row.initialBudget)}
                          </td>
                          <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {row.revisedBudget ? fmtKRW(row.revisedBudget) : '—'}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{row.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex h-full min-h-[160px] items-center justify-center px-4 text-center text-[11px] text-muted-foreground">
                    파일을 올리거나 예산총괄 표를 붙여넣으면 여기에서 반영 전 미리보기를 보여줍니다.
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={closeBudgetImport}>
                  취소
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-[12px]"
                  onClick={applyBudgetImport}
                  disabled={budgetImportApplying || budgetImportMergePlan.importedRows.length === 0}
                >
                  {budgetImportApplying ? '반영 중...' : '미리본 예산 반영'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={codeBookMode} onOpenChange={(open) => !open && cancelEdit()}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle className="text-[14px]">예산 항목 구조 관리</DialogTitle>
            </DialogHeader>
            <div className="flex max-h-[calc(85vh-4rem)] flex-col gap-3">
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-[11px] font-medium text-foreground">현재 예산 표에 쓰이는 비목/세목 구조를 관리합니다.</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  숫자 편집과 별개 흐름입니다. 붙여넣기 또는 CSV 가져오기는 현재 구조 초안을 교체하고, 저장 전까지는 실제 예산에 반영되지 않습니다.
                </p>
              </div>
              <Tabs value={codeBookEditorTab} onValueChange={(value) => setCodeBookEditorTab(value as 'manual' | 'paste' | 'csv')} className="min-h-0 flex-1">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="manual" className="text-[11px]">직접 수정</TabsTrigger>
                  <TabsTrigger value="paste" className="text-[11px]">엑셀 붙여넣기</TabsTrigger>
                  <TabsTrigger value="csv" className="text-[11px]">CSV 가져오기</TabsTrigger>
                </TabsList>

                <TabsContent value="manual" className="min-h-0 flex-1 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">세목은 드래그해서 순서를 바꿀 수 있습니다.</p>
                      {codeBookReplaceMode ? (
                        <p className="text-[10px] text-amber-600">가져온 구조 초안이 반영된 상태입니다. 저장하면 현재 비목/세목 구조가 교체됩니다.</p>
                      ) : null}
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={addBudgetCode}>
                      <Plus className="w-3.5 h-3.5" />
                      비목 추가
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-scroll pr-2">
                    {draftCodeBook.map((entry, idx) => (
                      <div key={`code-${idx}`} className="rounded-md border border-border/60 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground min-w-[24px]">{idx + 1}</span>
                          <input
                            type="text"
                            value={entry.code}
                            placeholder="비목명"
                            className="flex-1 bg-transparent outline-none text-[11px] px-2 py-1 border rounded"
                            onChange={(e) => updateBudgetCode(idx, e.target.value)}
                          />
                          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => addSubCode(idx)}>
                            <Plus className="w-3 h-3" />
                            세목 추가
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => removeBudgetCode(idx)}>
                            <Trash2 className="w-3 h-3" />
                            비목 삭제
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {entry.subCodes.map((sub, sidx) => (
                            <div
                              key={`sub-${idx}-${sidx}`}
                              className={[
                                'flex items-center gap-2 rounded-md border border-transparent px-1 py-1',
                                draggedSubCode?.codeIdx === idx && draggedSubCode.subIdx === sidx ? 'opacity-50' : '',
                                dropTarget?.codeIdx === idx && dropTarget.subIdx === sidx && dropTarget.position === 'before'
                                  ? 'border-t-primary'
                                  : '',
                                dropTarget?.codeIdx === idx && dropTarget.subIdx === sidx && dropTarget.position === 'after'
                                  ? 'border-b-primary'
                                  : '',
                              ].join(' ')}
                              draggable
                              onDragStart={() => handleSubCodeDragStart(idx, sidx)}
                              onDragOver={(event) => handleSubCodeDragOver(event, idx, sidx)}
                              onDrop={() => handleSubCodeDrop(idx, sidx)}
                              onDragEnd={handleSubCodeDragEnd}
                            >
                              <button
                                type="button"
                                className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded border border-dashed border-border/80 text-muted-foreground active:cursor-grabbing"
                                aria-label="세목 순서 드래그"
                              >
                                <GripVertical className="h-3.5 w-3.5" />
                              </button>
                              <span className="text-[10px] text-muted-foreground min-w-[28px]">{idx + 1}-{sidx + 1}</span>
                              <input
                                type="text"
                                value={sub}
                                placeholder="세목명"
                                className="flex-1 bg-transparent outline-none text-[11px] px-2 py-1 border rounded"
                                onChange={(e) => updateSubCode(idx, sidx, e.target.value)}
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => reorderSubCode(idx, sidx, 'up')}
                                disabled={sidx === 0}
                                aria-label="세목 위로 이동"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => reorderSubCode(idx, sidx, 'down')}
                                disabled={sidx === entry.subCodes.length - 1}
                                aria-label="세목 아래로 이동"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </Button>
                              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => removeSubCode(idx, sidx)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                          {entry.subCodes.length === 0 && (
                            <p className="text-[10px] text-muted-foreground">세목이 없습니다.</p>
                          )}
                        </div>
                      </div>
                    ))}
                    {draftCodeBook.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">비목을 추가해 주세요.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="paste" className="space-y-3">
                  <div className="rounded-md border border-border/60 p-3 space-y-2">
                    <p className="text-[11px] font-medium">엑셀에서 두 열을 그대로 복사해 붙여넣을 수 있습니다.</p>
                    <p className="text-[10px] text-muted-foreground">
                      첫 번째 열은 비목, 두 번째 열은 세목으로 읽습니다. 헤더가 `비목 / 세목`이면 자동으로 건너뜁니다.
                    </p>
                    <div className="rounded-md bg-slate-950 px-3 py-2 font-mono text-[10px] text-slate-50 whitespace-pre-wrap">
                      비목,세목{'\n'}
                      교육운영비,강사비{'\n'}
                      교육운영비,교재비{'\n'}
                      출장비,교통비
                    </div>
                    <p className="text-[10px] text-muted-foreground">쉼표 CSV와 탭 구분 복붙 둘 다 지원합니다.</p>
                  </div>
                  <Textarea
                    value={codeBookImportText}
                    onChange={(event) => {
                      setCodeBookImportText(event.target.value);
                      setCodeBookImportFileName('');
                    }}
                    placeholder={'비목\t세목\n교육운영비\t강사비\n교육운영비\t교재비'}
                    className="min-h-[220px] text-[11px] font-mono"
                  />
                  <div className="rounded-md border border-border/60 p-3 text-[10px] text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>비목 {codeBookImportPreview.rows.length}개</span>
                      <span>세목 {codeBookImportPreview.totalPairs}건</span>
                      <span>중복 제외 {codeBookImportPreview.duplicatePairs}건</span>
                      <span>건너뜀 {codeBookImportPreview.skippedRows}건</span>
                    </div>
                    {codeBookImportPreview.samplePairs.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {codeBookImportPreview.samplePairs.map((pair) => (
                          <Badge key={`${pair.code}-${pair.subCode}`} variant="outline" className="text-[10px]">
                            {pair.code} / {pair.subCode}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      className="h-8 text-[12px]"
                      onClick={applyImportedCodeBook}
                      disabled={codeBookImportPreview.rows.length === 0}
                    >
                      가져온 구조로 교체
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="csv" className="space-y-3">
                  <div className="rounded-md border border-border/60 p-3 space-y-2">
                    <p className="text-[11px] font-medium">CSV 예시는 이 화면 안에서 바로 확인할 수 있습니다.</p>
                    <div className="rounded-md bg-slate-950 px-3 py-2 font-mono text-[10px] text-slate-50 whitespace-pre-wrap">
                      비목,세목{'\n'}
                      교육운영비,강사비{'\n'}
                      교육운영비,교재비{'\n'}
                      출장비,숙박비
                    </div>
                    <p className="text-[10px] text-muted-foreground">엑셀에서 저장한 `.csv` 또는 `.tsv` 파일을 올리면 미리보기 후 현재 구조 초안으로 교체합니다.</p>
                  </div>
                  <div className="rounded-md border border-dashed border-border/70 p-4">
                    <input
                      type="file"
                      accept=".csv,.tsv,text/csv,text/tab-separated-values"
                      className="block w-full text-[11px]"
                      onChange={(event) => {
                        void handleCodeBookImportFile(event.target.files?.[0] || null);
                        event.currentTarget.value = '';
                      }}
                    />
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {codeBookImportFileName ? `${codeBookImportFileName} 파일을 읽어 미리보기를 준비했습니다.` : '업로드 후 아래 미리보기에서 비목/세목 개수를 확인하세요.'}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 p-3 text-[10px] text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>비목 {codeBookImportPreview.rows.length}개</span>
                      <span>세목 {codeBookImportPreview.totalPairs}건</span>
                      <span>중복 제외 {codeBookImportPreview.duplicatePairs}건</span>
                      <span>건너뜀 {codeBookImportPreview.skippedRows}건</span>
                      {codeBookImportPreview.headerDetected ? <span>헤더 자동 인식</span> : null}
                    </div>
                    {codeBookImportPreview.samplePairs.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {codeBookImportPreview.samplePairs.map((pair) => (
                          <Badge key={`${pair.code}-${pair.subCode}`} variant="outline" className="text-[10px]">
                            {pair.code} / {pair.subCode}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2">파일을 올리면 여기에서 예시 행을 바로 확인할 수 있습니다.</p>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      className="h-8 text-[12px]"
                      onClick={applyImportedCodeBook}
                      disabled={codeBookImportPreview.rows.length === 0}
                    >
                      가져온 구조로 교체
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
              <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={cancelEdit}>
                  취소
                </Button>
                <Button size="sm" className="h-8 text-[12px]" onClick={saveSettings} disabled={settingsSaving}>
                  {settingsSaving ? '저장 중...' : '저장'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: '총 예산', value: fmtShort(total.effectiveBudget || 0), sub: fmtKRW(total.effectiveBudget || 0) + '원', gradient: 'linear-gradient(135deg, #4f46e5, #7c3aed)', icon: Calculator },
            { label: '집행액', value: fmtShort(total.spent || 0), sub: fmtKRW(total.spent || 0) + '원', gradient: 'linear-gradient(135deg, #e11d48, #f43f5e)', icon: Wallet },
            { label: '잔액', value: fmtShort(total.balance || 0), sub: fmtKRW(total.balance || 0) + '원', gradient: 'linear-gradient(135deg, #0d9488, #059669)', icon: TrendingUp },
            { label: '소진율', value: fmtPercent(total.burnRate || 0), sub: `${fmtKRW(total.spent || 0)} / ${fmtKRW(total.effectiveBudget || 0)}`, gradient: `linear-gradient(135deg, ${burnColor(total.burnRate || 0)}, ${burnColor(total.burnRate || 0)}88)`, icon: TrendingUp },
          ].map(k => (
            <Card key={k.label} className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: k.gradient }}>
                    <k.icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground">{k.label}</p>
                    <p className="text-[16px] truncate" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{k.value}</p>
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground mt-1.5 truncate" style={{ fontVariantNumeric: 'tabular-nums' }}>{k.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Meta Bar */}
        <Card>
          <CardContent className="p-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
              <span className="text-muted-foreground">정산: <strong className="text-foreground">{meta.basis}</strong></span>
              <span className="text-muted-foreground">펀더: <strong className="text-foreground">{meta.funder}</strong></span>
              <span className="text-muted-foreground">업데이트: <strong className="text-foreground">{meta.lastUpdated}</strong></span>
              <div className="flex items-center gap-2 ml-auto">
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/40">
                  <Lock className="w-2 h-2" /> 고정
                </span>
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300 border border-rose-200/50 dark:border-rose-800/40">
                  <SlidersHorizontal className="w-2 h-2" /> 조정가능
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 보조 테이블 */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-[12px]">예산 구성</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {auxRows.map((r, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 text-[11px]">
                  <span>{r.label}</span>
                  <div className="flex items-center gap-4" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ fontWeight: 500 }}>{fmtKRW(r.amount)}원</span>
                    <span className="text-muted-foreground w-[50px] text-right">{fmtPercent(r.ratio)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 소진율 바 총괄 */}
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px]" style={{ fontWeight: 600 }}>전체 소진율</span>
              <span className="text-[13px]" style={{ fontWeight: 700, color: burnColor(total.burnRate || 0) }}>
                {fmtPercent(total.burnRate || 0)}
              </span>
            </div>
            <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{
                width: `${Math.min((total.burnRate || 0) * 100, 100)}%`,
                background: `linear-gradient(90deg, ${burnColor(total.burnRate || 0)}, ${burnColor(total.burnRate || 0)}cc)`,
              }} />
            </div>
            <div className="flex justify-between mt-1.5 text-[9px] text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span>집행 {fmtKRW(total.spent || 0)}원</span>
              <span>잔액 {fmtKRW(total.balance || 0)}원</span>
            </div>
            <div className="mt-2.5 pt-2 border-t border-border/60">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                <span className="text-muted-foreground">총계</span>
                <span>예산 <strong>{fmtKRW(total.effectiveBudget || 0)}</strong></span>
                <span>집행 <strong style={{ color: '#e11d48' }}>{fmtKRW(total.spent || 0)}</strong></span>
                <span>잔액 <strong style={{ color: '#059669' }}>{fmtKRW(total.balance || 0)}</strong></span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── 그룹별 카드 뷰 (테이블 대체) ── */}
        <div className="space-y-3">
          {Object.entries(groups.groupMap).map(([gid, group]) => {
            const isCollapsed = collapsedGroups.has(gid);
            const sub = group.subtotal;
            const subEffective = getEffectiveBudget(sub);
            return (
              <Card key={gid} className="overflow-hidden">
                {/* 그룹 헤더 */}
                <button
                  className="w-full flex items-center gap-2 px-4 py-3 border-b border-border/50 hover:bg-muted/20 transition-colors text-left"
                  onClick={() => toggleGroup(gid)}
                >
                  {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <span className="text-[12px] flex-1" style={{ fontWeight: 600 }}>
                    {gid || '기타'}
                  </span>
                  <div className="flex items-center gap-3 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <span className="text-muted-foreground">예산 <strong className="text-foreground">{fmtShort(subEffective)}</strong></span>
                    <span className="text-muted-foreground">집행 <strong style={{ color: sub.spent > 0 ? '#e11d48' : undefined }}>{fmtShort(sub.spent)}</strong></span>
                    <span style={{ fontWeight: 600, color: burnColor(sub.burnRate) }}>{fmtPercent(sub.burnRate)}</span>
                  </div>
                </button>

                {/* 그룹 진행바 */}
                <div className="px-4 pt-1.5 pb-0.5">
                  <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${Math.min(sub.burnRate * 100, 100)}%`,
                      background: burnColor(sub.burnRate),
                    }} />
                  </div>
                </div>

                {/* 항목 테이블 */}
                {!isCollapsed && group.items.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="px-4 py-2 text-left" style={{ fontWeight: 600, minWidth: 100 }}>비목 / 세목</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>최초 예산</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>수정 예산</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>소진금액</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 50 }}>소진율</th>
                          <th className="px-3 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>잔액</th>
                          <th className="px-4 py-2 text-left hidden lg:table-cell" style={{ fontWeight: 600, minWidth: 120 }}>특이사항</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map(row => {
                          const effective = getEffectiveBudget(row);
                          const hasRevised = row.revisedAug > 0;
                          const delta = hasRevised ? row.revisedAug - row.initialBudget : 0;
                          const deltaUp = delta > 0;
                          const deltaDown = delta < 0;
                          const rowKey = buildBudgetLabelKey(row.budgetCode, row.subCode);
                          const draft = editMode
                            ? draftRows.find((r) => buildBudgetLabelKey(r.budgetCode, r.subCode) === rowKey)
                            : null;
                          return (
                          <tr
                            key={row.id}
                            className={`border-t border-border/30 transition-colors ${editMode ? '' : 'hover:bg-muted/20 cursor-pointer'}`}
                            onClick={() => {
                              if (!editMode) setSelectedRow(row);
                            }}
                          >
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <div className="min-w-0">
                                  {row.budgetCode && <p className="text-[10px] text-muted-foreground truncate">{row.budgetCode}</p>}
                                  <p className="truncate" style={{ fontWeight: 500 }}>{row.subCode}</p>
                                </div>
                                {row.fixType === 'FIXED' && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Lock className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent className="text-[10px]">고정 항목</TooltipContent>
                                  </Tooltip>
                                )}
                                {row.fixType === 'ADJUSTABLE' && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <SlidersHorizontal className="w-2.5 h-2.5 text-rose-500 shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent className="text-[10px]">조정 가능</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right align-top" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {editMode ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={draft?.initialBudget || ''}
                                  className="w-full bg-transparent outline-none text-[11px] text-right px-1 py-0.5 border rounded"
                                  onChange={(e) => {
                                    const value = formatInputLive(e.target.value);
                                    setDraftRows((prev) => prev.map((r) => (
                                      buildBudgetLabelKey(r.budgetCode, r.subCode) === rowKey
                                        ? { ...r, initialBudget: value }
                                        : r
                                    )));
                                  }}
                                />
                              ) : (
                                <div>{fmtKRW(row.initialBudget)}</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right align-top" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {editMode ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={draft?.revisedBudget || ''}
                                  className="w-full bg-transparent outline-none text-[11px] text-right px-1 py-0.5 border rounded"
                                  onChange={(e) => {
                                    const value = formatInputLive(e.target.value);
                                    setDraftRows((prev) => prev.map((r) => (
                                      buildBudgetLabelKey(r.budgetCode, r.subCode) === rowKey
                                        ? { ...r, revisedBudget: value }
                                        : r
                                    )));
                                  }}
                                />
                              ) : (
                                <div className="flex flex-col items-end leading-tight">
                                  <div>{fmtKRW(effective)}</div>
                                  {hasRevised && delta !== 0 && (
                                    <div className={`text-[9px] mt-0.5 inline-flex items-center gap-1 ${deltaUp ? 'text-emerald-600' : 'text-rose-600'}`}>
                                      {deltaUp ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                      {deltaUp ? '증액' : '감액'} {fmtKRW(Math.abs(delta))}
                                    </div>
                                  )}
                                  {hasRevised && delta === 0 && (
                                    <div className="text-[9px] mt-0.5 text-muted-foreground">유지 0</div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: row.spent > 0 ? '#e11d48' : undefined }}>
                              {fmtKRW(row.spent)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="inline-flex items-center justify-center min-w-[40px] px-1.5 py-0.5 rounded text-[9px]"
                                style={{
                                  fontWeight: 600,
                                  color: burnColor(row.burnRate),
                                  background: `${burnColor(row.burnRate)}10`,
                                }}>
                                {fmtPercent(row.burnRate)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: '#059669' }}>
                              {fmtKRW(row.balance)}
                            </td>
                            <td className={`px-4 py-2.5 max-w-[180px] ${editMode ? '' : 'hidden lg:table-cell'}`}>
                              {editMode ? (
                                <input
                                  type="text"
                                  value={draft?.note || ''}
                                  className="w-full bg-transparent outline-none text-[11px] px-2 py-1 border rounded"
                                  placeholder="특이사항"
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setDraftRows((prev) => prev.map((r) => (
                                      buildBudgetLabelKey(r.budgetCode, r.subCode) === rowKey
                                        ? { ...r, note: value }
                                        : r
                                    )));
                                  }}
                                />
                              ) : row.note ? (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <span className="text-muted-foreground truncate block text-[10px]">{row.note.slice(0, 40)}{row.note.length > 40 ? '...' : ''}</span>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-[10px] max-w-[280px]">{row.note}</TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-muted-foreground/30">—</span>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 소계 풋터 */}
                <div className="px-4 py-2.5 bg-muted/20 border-t border-border/50 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <span className="text-muted-foreground">소계</span>
                  <span>예산 <strong>{fmtKRW(subEffective)}</strong></span>
                  <span>집행 <strong style={{ color: sub.spent > 0 ? '#e11d48' : undefined }}>{fmtKRW(sub.spent)}</strong></span>
                  <span className="ml-auto" style={{ fontWeight: 600, color: '#059669' }}>잔액 {fmtKRW(sub.balance)}</span>
                </div>
              </Card>
            );
          })}

        </div>

        {/* 행 상세 모달 */}
        <Dialog open={!!selectedRow} onOpenChange={open => !open && setSelectedRow(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="text-[14px]">항목 상세</DialogTitle></DialogHeader>
            {selectedRow && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className={`text-[9px] h-4 px-1.5 ${selectedRow.fixType === 'FIXED' ? 'bg-blue-100 text-blue-700' : selectedRow.fixType === 'ADJUSTABLE' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                    {selectedRow.fixType === 'FIXED' ? '고정' : selectedRow.fixType === 'ADJUSTABLE' ? '조정가능' : '일반'}
                  </Badge>
                  {selectedRow.category && <span className="text-[10px] text-muted-foreground">{selectedRow.category}</span>}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {[
                    ['비목', selectedRow.budgetCode || '—'],
                    ['세목', selectedRow.subCode || '—'],
                    ['최초 예산', fmtKRW(selectedRow.initialBudget) + '원'],
                    ['수정 예산', selectedRow.revisedAug > 0 ? fmtKRW(selectedRow.revisedAug) + '원' : '—'],
                    ['구성비', fmtPercent(selectedRow.composition)],
                    ['소진금액', fmtKRW(selectedRow.spent) + '원'],
                    ['소진율', fmtPercent(selectedRow.burnRate)],
                    ['잔액', fmtKRW(selectedRow.balance) + '원'],
                  ].map(([l, v]) => (
                    <div key={l as string}>
                      <p className="text-[9px] text-muted-foreground mb-0.5">{l}</p>
                      <p style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{v || '—'}</p>
                    </div>
                  ))}
                </div>

                {selectedRow.note && (
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40">
                    <p className="text-[10px] text-amber-700 dark:text-amber-300" style={{ fontWeight: 600 }}>
                      <Info className="w-3 h-3 inline mr-0.5" /> 특이사항
                    </p>
                    <p className="text-[11px] mt-1 break-words">{selectedRow.note}</p>
                  </div>
                )}

                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">소진율</p>
                  <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${Math.min(selectedRow.burnRate * 100, 100)}%`,
                      background: burnColor(selectedRow.burnRate),
                    }} />
                  </div>
                  <div className="flex justify-between mt-1 text-[9px] text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <span>{fmtPercent(selectedRow.burnRate)}</span>
                    <span>잔액 {fmtKRW(selectedRow.balance)}원</span>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
