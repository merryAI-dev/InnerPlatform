import { useCallback, useMemo, useState } from 'react';
import {
  Upload, CheckCircle2, XCircle, AlertTriangle, ArrowLeftRight, Filter,
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { useAppStore } from '../../data/store';
import { parseCsv } from '../../platform/csv-utils';
import {
  autoMatchBankTransactions,
  parseBankCsv,
  type BankTransaction,
  type ReconciliationMatch,
} from '../../platform/bank-reconciliation';
import { PageHeader } from '../layout/PageHeader';

function fmtShort(n: number) {
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + '억';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + '만';
  return n.toLocaleString();
}

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  MATCHED: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', label: '매칭' },
  UNMATCHED_BANK: { bg: 'bg-rose-50 dark:bg-rose-950/30', text: 'text-rose-700 dark:text-rose-400', label: '은행만' },
  UNMATCHED_SYSTEM: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', label: '시스템만' },
};

export function BankReconciliationPage() {
  const { transactions, projects } = useAppStore();
  const [bankTxs, setBankTxs] = useState<BankTransaction[]>([]);
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [fileName, setFileName] = useState('');

  const filteredSystemTxs = useMemo(() => {
    let txs = transactions.filter(t => t.state !== 'REJECTED');
    if (projectFilter !== 'ALL') txs = txs.filter(t => t.projectId === projectFilter);
    return txs;
  }, [transactions, projectFilter]);

  const matches = useMemo<ReconciliationMatch[]>(() => {
    if (bankTxs.length === 0) return [];
    return autoMatchBankTransactions(bankTxs, filteredSystemTxs);
  }, [bankTxs, filteredSystemTxs]);

  const filteredMatches = useMemo(() => {
    if (statusFilter === 'ALL') return matches;
    return matches.filter(m => m.status === statusFilter);
  }, [matches, statusFilter]);

  const stats = useMemo(() => ({
    matched: matches.filter(m => m.status === 'MATCHED').length,
    unmatchedBank: matches.filter(m => m.status === 'UNMATCHED_BANK').length,
    unmatchedSystem: matches.filter(m => m.status === 'UNMATCHED_SYSTEM').length,
    total: matches.length,
  }), [matches]);

  const projectMap = useMemo(() => {
    const m: Record<string, string> = {};
    projects.forEach(p => { m[p.id] = p.name; });
    return m;
  }, [projects]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const matrix = parseCsv(text);
      const parsed = parseBankCsv(matrix);
      setBankTxs(parsed);
    };
    reader.readAsText(file, 'UTF-8');
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ArrowLeftRight}
        iconGradient="linear-gradient(135deg, #0891b2, #06b6d4)"
        title="은행 거래내역 대조"
        description="은행 CSV를 업로드하여 시스템 거래와 자동 매칭합니다"
        badge={stats.unmatchedBank + stats.unmatchedSystem > 0 ? `${stats.unmatchedBank + stats.unmatchedSystem}건 미매칭` : undefined}
        badgeVariant={stats.unmatchedBank + stats.unmatchedSystem > 0 ? 'default' : 'secondary'}
      />

      {/* Upload + Filter */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-lg border border-border/40 bg-card shadow-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <div className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] hover:bg-primary/90 transition-colors" style={{ fontWeight: 600 }}>
            <Upload className="w-3.5 h-3.5" />
            은행 CSV 업로드
          </div>
          <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
        </label>
        {fileName && (
          <span className="text-[11px] text-muted-foreground">{fileName} ({bankTxs.length}건)</span>
        )}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-auto mr-1">
          <Filter className="w-3.5 h-3.5" />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-8 w-[180px] text-[11px]"><SelectValue placeholder="프로젝트" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 프로젝트</SelectItem>
            {projects.map(p => (
              <SelectItem key={p.id} value={p.id} className="text-[11px]">{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[140px] text-[11px]"><SelectValue placeholder="상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 상태</SelectItem>
            <SelectItem value="MATCHED">매칭</SelectItem>
            <SelectItem value="UNMATCHED_BANK">은행만</SelectItem>
            <SelectItem value="UNMATCHED_SYSTEM">시스템만</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      {bankTxs.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: CheckCircle2, label: '매칭', value: stats.matched, color: '#059669' },
            { icon: XCircle, label: '은행만(미매칭)', value: stats.unmatchedBank, color: '#e11d48' },
            { icon: AlertTriangle, label: '시스템만(미매칭)', value: stats.unmatchedSystem, color: '#d97706' },
          ].map(s => (
            <Card key={s.label} className="shadow-sm border-border/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: s.color + '14' }}>
                    <s.icon className="w-4.5 h-4.5" style={{ color: s.color }} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground" style={{ fontWeight: 500 }}>{s.label}</p>
                    <p className="text-[20px]" style={{ fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                      {s.value}<span className="text-[12px]" style={{ fontWeight: 500 }}>건</span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* No data state */}
      {bankTxs.length === 0 && (
        <Card className="shadow-sm border-border/50">
          <CardContent className="py-16 text-center">
            <ArrowLeftRight className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-[14px] text-muted-foreground mb-1" style={{ fontWeight: 600 }}>은행 CSV를 업로드해주세요</p>
            <p className="text-[12px] text-muted-foreground/60">
              은행 거래내역 CSV를 업로드하면 시스템 거래와 자동으로 대조합니다
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results Table */}
      {bankTxs.length > 0 && (
        <Card className="shadow-sm border-border/50">
          <CardContent className="pt-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] w-[60px]">상태</TableHead>
                    <TableHead className="text-[10px]">신뢰도</TableHead>
                    <TableHead className="text-[10px] min-w-[80px]">은행 일자</TableHead>
                    <TableHead className="text-[10px] min-w-[120px]">은행 적요</TableHead>
                    <TableHead className="text-right text-[10px]">은행 금액</TableHead>
                    <TableHead className="text-[10px] text-center">↔</TableHead>
                    <TableHead className="text-[10px] min-w-[80px]">시스템 일자</TableHead>
                    <TableHead className="text-[10px] min-w-[100px]">프로젝트</TableHead>
                    <TableHead className="text-[10px]">거래처</TableHead>
                    <TableHead className="text-right text-[10px]">시스템 금액</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMatches.map((m, idx) => {
                    const st = STATUS_STYLE[m.status];
                    return (
                      <TableRow key={idx} className="h-9">
                        <TableCell className="py-1">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md ${st.bg} ${st.text}`} style={{ fontWeight: 500 }}>
                            {st.label}
                          </span>
                        </TableCell>
                        <TableCell className="py-1 text-[10px] text-muted-foreground tabular-nums">
                          {m.confidence > 0 ? `${Math.round(m.confidence * 100)}%` : '-'}
                        </TableCell>
                        {/* Bank side */}
                        <TableCell className="py-1 text-[10px] text-muted-foreground whitespace-nowrap">
                          {m.bankTx?.date || '-'}
                        </TableCell>
                        <TableCell className="py-1 text-[11px] max-w-[150px] truncate">
                          {m.bankTx?.description || '-'}
                        </TableCell>
                        <TableCell className="py-1 text-right text-[11px] tabular-nums whitespace-nowrap" style={{ fontWeight: 700 }}>
                          {m.bankTx ? (
                            <span className={m.bankTx.direction === 'IN' ? 'text-emerald-600' : 'text-rose-600'}>
                              {m.bankTx.direction === 'IN' ? '+' : '-'}{fmtShort(m.bankTx.amount)}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="py-1 text-center text-[10px] text-muted-foreground/40">↔</TableCell>
                        {/* System side */}
                        <TableCell className="py-1 text-[10px] text-muted-foreground whitespace-nowrap">
                          {m.systemTx?.dateTime.slice(0, 10) || '-'}
                        </TableCell>
                        <TableCell className="py-1 text-[11px] max-w-[100px] truncate" style={{ fontWeight: 500 }}>
                          {m.systemTx ? projectMap[m.systemTx.projectId] || '-' : '-'}
                        </TableCell>
                        <TableCell className="py-1 text-[11px]">
                          {m.systemTx?.counterparty || '-'}
                        </TableCell>
                        <TableCell className="py-1 text-right text-[11px] tabular-nums whitespace-nowrap" style={{ fontWeight: 700 }}>
                          {m.systemTx ? (
                            <span className={m.systemTx.direction === 'IN' ? 'text-emerald-600' : 'text-rose-600'}>
                              {m.systemTx.direction === 'IN' ? '+' : '-'}{fmtShort(m.systemTx.amounts.bankAmount)}
                            </span>
                          ) : '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredMatches.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-10 text-[13px] text-muted-foreground">
                        매칭 결과가 없습니다
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
