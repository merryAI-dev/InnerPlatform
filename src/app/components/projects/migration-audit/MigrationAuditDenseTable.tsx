import type { MigrationAuditDenseRow } from '../../../platform/project-migration-console';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/table';
import type { ProjectMigrationStatus } from '../../../platform/project-migration-audit';

const STATUS_META: Record<ProjectMigrationStatus, { label: string; className: string }> = {
  REGISTERED: {
    label: '완료',
    className: 'bg-emerald-100 text-emerald-700',
  },
  CANDIDATE: {
    label: '후보 있음',
    className: 'bg-amber-100 text-amber-700',
  },
  MISSING: {
    label: '미등록',
    className: 'bg-rose-100 text-rose-700',
  },
};

interface MigrationAuditDenseTableProps {
  rows: MigrationAuditDenseRow[];
  selectedRecordId: string | null;
  onSelectRecord: (id: string) => void;
  onOpenProject: (projectId: string) => void;
}

export function MigrationAuditDenseTable({
  rows,
  selectedRecordId,
  onSelectRecord,
  onOpenProject,
}: MigrationAuditDenseTableProps) {
  return (
    <Card className="border-slate-200/80 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200 pb-4">
        <CardTitle className="text-[14px] font-semibold">통합대조표</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[88px]">상태</TableHead>
              <TableHead className="min-w-[100px]">등록 조직</TableHead>
              <TableHead className="min-w-[220px]">원본 사업명</TableHead>
              <TableHead className="min-w-[220px]">현재 플랫폼 프로젝트</TableHead>
              <TableHead className="min-w-[80px] text-center">후보 수</TableHead>
              <TableHead className="min-w-[180px]">마지막 액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const statusMeta = STATUS_META[row.status];
              const selected = row.recordId && row.recordId === selectedRecordId;
              return (
                <TableRow
                  key={row.id}
                  className={selected ? 'bg-slate-50' : undefined}
                  data-testid={`migration-audit-dense-row-${row.id}`}
                >
                  <TableCell>
                    <Badge className={`border-0 ${statusMeta.className}`}>{statusMeta.label}</Badge>
                  </TableCell>
                  <TableCell className="text-[11px] text-slate-600">{row.cic}</TableCell>
                  <TableCell className="text-[12px] font-medium text-slate-950">
                    {row.recordId ? (
                      <button type="button" className="text-left hover:underline" onClick={() => onSelectRecord(row.recordId!)}>
                        {row.sourceName}
                      </button>
                    ) : row.sourceName}
                  </TableCell>
                  <TableCell className="text-[12px] text-slate-700">
                    {row.projectId ? (
                      <Button variant="link" className="h-auto p-0 text-[12px]" onClick={() => onOpenProject(row.projectId!)}>
                        {row.projectLabel}
                      </Button>
                    ) : row.projectLabel}
                  </TableCell>
                  <TableCell className="text-center text-[12px] text-slate-600">{row.candidateCount}</TableCell>
                  <TableCell className="text-[11px] text-slate-500">{row.lastActionLabel}</TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-[12px] text-muted-foreground">
                  현재 필터 기준으로 표시할 이관 점검 row가 없습니다.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
