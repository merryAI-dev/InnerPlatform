import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import '../styles/index.css';
import { SettlementLedgerPage } from '../app/components/cashflow/SettlementLedgerPage';
import type { ImportRow } from '../app/platform/settlement-csv';
import type { Transaction } from '../app/data/types';

function SettlementSmokeHarness() {
  const [transactions, setTransactions] = useState<Transaction[]>([
    {
      id: 'smoke-tx-1',
      ledgerId: 'smoke-ledger',
      projectId: 'smoke-project',
      state: 'DRAFT',
      dateTime: '2026-03-05',
      weekCode: '2026-03 1주',
      direction: 'OUT',
      method: 'CORP_CARD_1',
      cashflowCategory: 'OUTSOURCING',
      cashflowLabel: '직접사업비(공급가액)',
      budgetCategory: '2.1',
      budgetSubCategory: '2.1.1',
      budgetSubSubCategory: '',
      counterparty: '외주 파트너',
      memo: '행사 운영비',
      internalMemo: '행사 운영비',
      bankMemo: '은행 원문 적요',
      amounts: {
        bankAmount: 11000,
        depositAmount: 0,
        expenseAmount: 11000,
        supplyAmount: 10000,
        vatIn: 1000,
        vatOut: 0,
        vatRefund: 0,
        balanceAfter: 250000,
      },
      evidenceRequired: ['계산서'],
      evidenceStatus: 'PARTIAL',
      evidenceMissing: ['세금계산서'],
      attachmentsCount: 1,
      evidenceDriveLink: 'https://drive.google.com/file/d/smoke-evidence/view',
      settlementProgress: 'INCOMPLETE',
      settlementNote: '확인 대기',
      createdBy: 'pm-smoke',
      createdAt: '2026-03-05T00:00:00Z',
      updatedBy: 'pm-smoke',
      updatedAt: '2026-03-05T00:00:00Z',
    },
  ]);
  const [sheetRows, setSheetRows] = useState<ImportRow[] | null>(null);

  const evidenceRequiredMap = useMemo(
    () => ({
      '2.1|2.1.1': '계산서, 세금계산서',
    }),
    [],
  );

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 text-slate-900">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Playwright smoke</p>
          <h1 className="text-2xl font-black tracking-tight">사업비 입력(주간)</h1>
          <p className="text-sm text-slate-600">
            헤더는 그대로 두고 지출구분, 내용 상태, 행 삽입, 공급가액 보조 계산을 검증합니다.
          </p>
        </header>

        <SettlementLedgerPage
          projectId="smoke-project"
          projectName="Smoke Project"
          transactions={transactions}
          defaultLedgerId="smoke-ledger"
          onAddTransaction={(tx) => setTransactions((prev) => [...prev, tx])}
          onUpdateTransaction={(id, updates) => {
            setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, ...updates } : tx)));
          }}
          evidenceRequiredMap={evidenceRequiredMap}
          onSaveEvidenceRequiredMap={() => Promise.resolve()}
          sheetRows={sheetRows}
          onSaveSheetRows={async (rows) => {
            setSheetRows(rows);
          }}
          currentUserName="Smoke PM"
          userRole="pm"
        />
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing root container');
}

createRoot(root).render(<SettlementSmokeHarness />);
