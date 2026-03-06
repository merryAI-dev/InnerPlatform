import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Save, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { usePortalStore } from '../../data/portal-store';
import { normalizeBankStatementMatrix, type BankStatementRow } from '../../platform/bank-statement';
import { normalizeKey, parseCsv, parseNumber } from '../../platform/csv-utils';

export function PortalBankStatementPage() {
  const { portalUser, myProject, bankStatementRows, saveBankStatementRows } = usePortalStore();
  const [columns, setColumns] = useState<string[]>(bankStatementRows?.columns || []);
  const [rows, setRows] = useState<BankStatementRow[]>(bankStatementRows?.rows || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectName = myProject?.name || '내 사업';
  const ready = useMemo(() => Boolean(portalUser?.projectId), [portalUser?.projectId]);
  const amountColIdxs = useMemo(() => {
    return new Set(
      columns.map((col, idx) => ({ col, idx }))
        .filter(({ col }) => {
          const key = normalizeKey(col);
          return key.includes(normalizeKey('입금')) || key.includes(normalizeKey('출금')) || key.includes(normalizeKey('잔액'));
        })
        .map(({ idx }) => idx),
    );
  }, [columns]);

  const formatAmount = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const num = parseNumber(trimmed);
    if (num == null) return trimmed;
    return num.toLocaleString('ko-KR');
  }, []);

  const formatAmountRow = useCallback((row: BankStatementRow) => {
    const cells = row.cells.map((cell, idx) => (amountColIdxs.has(idx) ? formatAmount(cell) : cell));
    return { ...row, cells };
  }, [amountColIdxs, formatAmount]);

  useEffect(() => {
    if (dirty) return;
    if (bankStatementRows?.rows && bankStatementRows.rows.length > 0) {
      setColumns(bankStatementRows.columns || []);
      setRows(bankStatementRows.rows.map(formatAmountRow));
      return;
    }
    setColumns([]);
    setRows([]);
  }, [bankStatementRows, dirty, formatAmountRow]);

  const parseExcelToMatrix = useCallback(async (file: File): Promise<string[][]> => {
    const XLSX = await import('xlsx');
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
      setColumns(result.columns);
      setRows(result.rows.map(formatAmountRow));
      setDirty(true);
    } catch (err) {
      console.error('[BankStatement] upload parse failed:', err);
      toast.error('파일을 읽지 못했습니다. `.xls`/`.xlsx`/`.csv` 파일인지 확인해 주세요.');
    }
  }, [parseExcelToMatrix, formatAmountRow]);

  const addRow = useCallback(() => {
    if (columns.length === 0) {
      toast.message('먼저 통장내역 파일을 업로드해 주세요.');
      return;
    }
    const next = [...rows, { tempId: `bank-${Date.now()}`, cells: columns.map(() => '') }];
    setRows(next);
    setDirty(true);
  }, [rows, columns]);

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

  const handleSave = useCallback(async () => {
    if (!saveBankStatementRows) {
      toast.error('저장 기능이 연결되어 있지 않습니다.');
      return;
    }
    setSaving(true);
    try {
      await saveBankStatementRows({ columns, rows });
      setDirty(false);
      toast.success('통장내역을 저장했습니다.');
    } catch (err) {
      console.error('[BankStatement] save failed:', err);
      toast.error('통장내역 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [columns, rows, saveBankStatementRows]);

  if (!ready) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px]" style={{ fontWeight: 700 }}>통장내역</h1>
          <p className="text-[12px] text-muted-foreground">{projectName} · 카드/통장 내역 업로드</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={dirty ? 'destructive' : 'secondary'} className="text-[10px]">
            {dirty ? '변경됨' : '저장됨'}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> 엑셀 업로드
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file);
              e.currentTarget.value = '';
            }}
          />
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" /> 행 추가
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            저장
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10 bg-muted/60">
                <tr>
                  {columns.map((col, idx) => (
                    <th key={idx} className="px-2 py-1 text-left border-b border-r font-medium whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(1, columns.length)} className="text-center text-[12px] text-muted-foreground py-10">
                      엑셀 파일을 업로드하세요.
                    </td>
                  </tr>
                )}
                {rows.map((row, rowIdx) => (
                  <tr key={row.tempId || rowIdx} className="border-t border-border/30">
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
    </div>
  );
}
