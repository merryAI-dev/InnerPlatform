import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Save, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { usePortalStore } from '../../data/portal-store';
import {
  BANK_STATEMENT_COLUMNS,
  normalizeBankStatementMatrix,
  type BankStatementRow,
} from '../../platform/bank-statement';
import { parseCsv } from '../../platform/csv-utils';

export function PortalBankStatementPage() {
  const { portalUser, myProject, bankStatementRows, saveBankStatementRows } = usePortalStore();
  const [rows, setRows] = useState<BankStatementRow[]>(bankStatementRows || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectName = myProject?.name || '내 사업';
  const ready = useMemo(() => Boolean(portalUser?.projectId), [portalUser?.projectId]);

  useEffect(() => {
    if (dirty) return;
    if (bankStatementRows) {
      setRows(bankStatementRows);
    }
  }, [bankStatementRows, dirty]);

  const parseExcelToMatrix = useCallback(async (file: File): Promise<string[][]> => {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return [];

    const cellToString = (value: unknown): string => {
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
    };

    const matrix: string[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        row.push(cellToString(ws.getCell(r, c).value));
      }
      matrix.push(row);
    }
    return matrix;
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    let matrix: string[][] = [];
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      matrix = await parseExcelToMatrix(file);
    } else if (name.endsWith('.csv')) {
      const text = await file.text();
      matrix = parseCsv(text);
    } else {
      toast.error('CSV 또는 XLSX 파일만 업로드할 수 있습니다.');
      return;
    }
    const result = normalizeBankStatementMatrix(matrix);
    setRows(result.rows);
    setDirty(true);
  }, [parseExcelToMatrix]);

  const addRow = useCallback(() => {
    const next = [...rows, { tempId: `bank-${Date.now()}`, cells: BANK_STATEMENT_COLUMNS.map(() => '') }];
    setRows(next);
    setDirty(true);
  }, [rows]);

  const updateCell = useCallback((rowIdx: number, colIdx: number, value: string) => {
    setRows((prev) => prev.map((row, i) => {
      if (i !== rowIdx) return row;
      const cells = [...row.cells];
      cells[colIdx] = value;
      return { ...row, cells };
    }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!saveBankStatementRows) {
      toast.error('저장 기능이 연결되어 있지 않습니다.');
      return;
    }
    setSaving(true);
    try {
      await saveBankStatementRows(rows);
      setDirty(false);
      toast.success('통장내역을 저장했습니다.');
    } catch (err) {
      console.error('[BankStatement] save failed:', err);
      toast.error('통장내역 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [rows, saveBankStatementRows]);

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
                  {BANK_STATEMENT_COLUMNS.map((col, idx) => (
                    <th key={idx} className="px-2 py-1 text-left border-b border-r font-medium whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={BANK_STATEMENT_COLUMNS.length} className="text-center text-[12px] text-muted-foreground py-10">
                      엑셀 파일을 업로드하거나 행을 추가하세요.
                    </td>
                  </tr>
                )}
                {rows.map((row, rowIdx) => (
                  <tr key={row.tempId || rowIdx} className="border-t border-border/30">
                    {BANK_STATEMENT_COLUMNS.map((_, colIdx) => (
                      <td key={colIdx} className="px-1.5 py-1 border-r border-border/30">
                        <input
                          type="text"
                          value={row.cells[colIdx] || ''}
                          className="w-full bg-transparent outline-none text-[11px]"
                          onChange={(e) => updateCell(rowIdx, colIdx, e.target.value)}
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
