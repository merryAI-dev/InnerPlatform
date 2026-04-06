import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Clock3, FileWarning, Wallet } from 'lucide-react';
import type { BankImportIntakeItem, CashflowCategory } from '../../data/types';
import { CASHFLOW_CATEGORY_LABELS } from '../../data/types';
import { isBankImportManualFieldsComplete } from '../../platform/bank-import-triage';
import { groupExpenseIntakeItemsForSurface, resolveBankImportWizardStatus } from '../../platform/bank-intake-surface';
import { resolveEvidenceChecklist } from '../../platform/evidence-helpers';
import { resolveEvidenceRequiredDesc } from '../../platform/settlement-sheet-prepare';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

interface BankImportTriageWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: BankImportIntakeItem[];
  onSaveDraft: (id: string, updates: Partial<BankImportIntakeItem>) => Promise<void>;
  onProjectItem: (id: string, updates?: Partial<BankImportIntakeItem>) => Promise<void>;
  onSyncEvidence?: (id: string, updates: Partial<BankImportIntakeItem>) => Promise<void>;
  evidenceRequiredMap: Record<string, string>;
}

const CASHFLOW_OPTIONS: CashflowCategory[] = [
  'CONTRACT_PAYMENT',
  'INTERIM_PAYMENT',
  'FINAL_PAYMENT',
  'LABOR_COST',
  'OUTSOURCING',
  'EQUIPMENT',
  'TRAVEL',
  'SUPPLIES',
  'COMMUNICATION',
  'RENT',
  'UTILITY',
  'TAX_PAYMENT',
  'VAT_REFUND',
  'INSURANCE',
  'MISC_INCOME',
  'MISC_EXPENSE',
];

function formatMoney(value: number): string {
  return value.toLocaleString('ko-KR');
}

function getMatchTone(item: BankImportIntakeItem) {
  if (item.matchState === 'REVIEW_REQUIRED') {
    return {
      label: '검토 필요',
      badgeClass: 'border-rose-200 bg-rose-50 text-rose-700',
      icon: FileWarning,
    };
  }
  return {
    label: '입력 필요',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: Clock3,
  };
}

export function BankImportTriageWizard({
  open,
  onOpenChange,
  items,
  onSaveDraft,
  onProjectItem,
  onSyncEvidence,
  evidenceRequiredMap,
}: BankImportTriageWizardProps) {
  const groupedItems = useMemo(() => groupExpenseIntakeItemsForSurface(items), [items]);
  const wizardItems = useMemo(() => [
    ...groupedItems.needsClassification,
    ...groupedItems.reviewRequired,
    ...groupedItems.pendingEvidence,
  ], [groupedItems]);
  const [selectedId, setSelectedId] = useState<string | null>(wizardItems[0]?.id || null);
  const [drafts, setDrafts] = useState<Record<string, BankImportIntakeItem['manualFields']>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!wizardItems.some((item) => item.id === selectedId)) {
      setSelectedId(wizardItems[0]?.id || null);
    }
  }, [selectedId, wizardItems]);

  useEffect(() => {
    if (!open) return;
    setSelectedId((prev) => prev || wizardItems[0]?.id || null);
  }, [open, wizardItems]);

  const selectedItem = wizardItems.find((item) => item.id === selectedId) || wizardItems[0] || null;
  const activeManualFields = selectedItem
    ? {
      ...selectedItem.manualFields,
      ...(drafts[selectedItem.id] || {}),
    }
    : null;
  const requiredEvidenceDesc = selectedItem && activeManualFields
    ? resolveEvidenceRequiredDesc(
      evidenceRequiredMap,
      activeManualFields.budgetCategory || '',
      activeManualFields.budgetSubCategory || '',
    )
    : '';
  const evidenceChecklist = useMemo(() => resolveEvidenceChecklist({
    evidenceRequiredDesc: requiredEvidenceDesc,
    evidenceCompletedDesc: activeManualFields?.evidenceCompletedDesc || '',
    evidenceCompletedManualDesc: activeManualFields?.evidenceCompletedDesc || '',
    evidenceAutoListedDesc: '',
    evidenceDriveLink: '',
    evidenceDriveFolderId: '',
  }), [activeManualFields?.evidenceCompletedDesc, requiredEvidenceDesc]);

  const completedCount = wizardItems.filter((item) => isBankImportManualFieldsComplete({
    ...item.manualFields,
    ...(drafts[item.id] || {}),
  })).length;
  const selectedStatus = selectedItem ? resolveBankImportWizardStatus({
    ...selectedItem,
    manualFields: activeManualFields || selectedItem.manualFields,
  }) : null;

  const advanceSelection = () => {
    if (!selectedItem) return;
    const currentIndex = wizardItems.findIndex((item) => item.id === selectedItem.id);
    const nextItem = wizardItems[currentIndex + 1] || null;
    if (nextItem) {
      setSelectedId(nextItem.id);
    } else {
      onOpenChange(false);
    }
  };

  const saveCurrentDraft = async (advanceAfterSave: boolean) => {
    if (!selectedItem) return;
    const nextManualFields = {
      ...selectedItem.manualFields,
      ...(drafts[selectedItem.id] || {}),
    };
    setSavingId(selectedItem.id);
    try {
      await onSaveDraft(selectedItem.id, {
        manualFields: nextManualFields,
        updatedAt: new Date().toISOString(),
      });
      if (advanceAfterSave) {
        advanceSelection();
      }
    } finally {
      setSavingId(null);
    }
  };

  const projectCurrentItem = async () => {
    if (!selectedItem) return;
    const nextManualFields = {
      ...selectedItem.manualFields,
      ...(drafts[selectedItem.id] || {}),
    };
    setSavingId(selectedItem.id);
    try {
      if (selectedStatus === 'PROJECTED_PENDING_EVIDENCE' && onSyncEvidence) {
        await onSyncEvidence(selectedItem.id, {
          manualFields: nextManualFields,
          updatedAt: new Date().toISOString(),
        });
      } else if (isBankImportManualFieldsComplete(nextManualFields)) {
        await onProjectItem(selectedItem.id, {
          manualFields: nextManualFields,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await onSaveDraft(selectedItem.id, {
          manualFields: nextManualFields,
          updatedAt: new Date().toISOString(),
        });
      }
      advanceSelection();
    } finally {
      setSavingId(null);
    }
  };

  const skipEvidenceForNow = () => {
    advanceSelection();
  };

  const renderSection = (title: string, itemsForSection: BankImportIntakeItem[], emptyText: string) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</p>
        <Badge variant="outline" className="text-[10px]">{itemsForSection.length}</Badge>
      </div>
      {itemsForSection.length === 0 ? (
        <Card className="border-slate-200 bg-slate-50/70 shadow-none">
          <CardContent className="p-3 text-[11px] leading-5 text-slate-500">
            {emptyText}
          </CardContent>
        </Card>
      ) : itemsForSection.map((item, index) => {
        const tone = getMatchTone(item);
        const ToneIcon = tone.icon;
        const isSelected = item.id === selectedItem?.id;
        const status = resolveBankImportWizardStatus({
          ...item,
          manualFields: {
            ...item.manualFields,
            ...(drafts[item.id] || {}),
          },
        });
        const statusLabel = status === 'PROJECTED_PENDING_EVIDENCE'
          ? '증빙 이어서'
          : status === 'READY_TO_PROJECT'
            ? '반영 준비'
            : tone.label;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelectedId(item.id)}
            data-testid={`bank-import-triage-item-${item.id}`}
            className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
              isSelected
                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`text-[10px] ${isSelected ? 'border-white/20 bg-white/10 text-white' : tone.badgeClass}`}>
                    <ToneIcon className="mr-1 h-3 w-3" />
                    {statusLabel}
                  </Badge>
                </div>
                <div>
                  <p className={`text-[12px] font-semibold ${isSelected ? 'text-white' : 'text-slate-950'}`}>
                    {index + 1}. {item.bankSnapshot.counterparty || '거래처 미확인'}
                  </p>
                  <p className={`text-[11px] ${isSelected ? 'text-slate-200' : 'text-slate-500'}`}>
                    {item.bankSnapshot.dateTime} · {formatMoney(Math.abs(item.bankSnapshot.signedAmount))}원
                  </p>
                </div>
              </div>
              <ArrowRight className={`h-4 w-4 ${isSelected ? 'text-slate-200' : 'text-slate-400'}`} />
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="bank-import-triage-wizard"
        className="!top-0 !left-0 !translate-x-0 !translate-y-0 !w-screen !max-w-none sm:!max-w-none !h-[100dvh] rounded-none border-0 p-0 gap-0 overflow-hidden data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100"
      >
        <DialogHeader className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-slate-950">
                  신규 거래 입력 Queue
                </DialogTitle>
                <Badge variant="outline" className="text-[10px]">
                  {completedCount} / {wizardItems.length} 분류 완료
                </Badge>
              </div>
              <DialogDescription className="text-[12px] leading-6 text-slate-600">
                이번 업로드에서 사람이 실제로 판단해야 하는 거래만 모았습니다. 여기서 분류를 저장하고, 전체 정산대장은 예외 수정용으로만 남깁니다.
              </DialogDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              나중에 이어서 하기
            </Button>
          </div>
        </DialogHeader>

        <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] bg-slate-50">
          <div className="border-r border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <Card className="border-amber-200 bg-amber-50/70 shadow-none">
                  <CardContent className="p-3">
                    <p className="text-[11px] text-amber-700">입력 필요</p>
                    <p className="mt-1 text-[18px] font-semibold text-slate-950">
                      {wizardItems.filter((item) => item.matchState === 'PENDING_INPUT').length}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-rose-200 bg-rose-50/70 shadow-none">
                  <CardContent className="p-3">
                    <p className="text-[11px] text-rose-700">검토 필요</p>
                    <p className="mt-1 text-[18px] font-semibold text-slate-950">
                      {wizardItems.filter((item) => item.matchState === 'REVIEW_REQUIRED').length}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
            <div className="h-[calc(100%-96px)] overflow-y-auto px-3 py-3">
              <div className="space-y-4">
                {wizardItems.length === 0 ? (
                  <Card className="border-emerald-200 bg-emerald-50/70 shadow-none">
                    <CardContent className="p-4 text-[12px] leading-6 text-emerald-900">
                      이번 업로드에서 바로 사람이 처리할 거래는 없습니다.
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {renderSection('분류 필요', groupedItems.needsClassification, '바로 입력이 필요한 거래가 없습니다.')}
                    {renderSection('검토 필요', groupedItems.reviewRequired, '검토가 필요한 거래가 없습니다.')}
                    {renderSection('증빙 미완료', groupedItems.pendingEvidence, '증빙 continuation이 필요한 거래가 없습니다.')}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            {!selectedItem || !activeManualFields ? (
              <div className="flex h-full items-center justify-center px-8">
                <div className="max-w-md text-center">
                  <p className="text-[16px] font-semibold text-slate-950">처리할 거래를 선택하세요</p>
                  <p className="mt-2 text-[13px] leading-6 text-slate-500">
                    좌측 목록에서 신규 거래나 검토 필요 거래를 선택하면, 여기서 필요한 필드만 입력할 수 있습니다.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-6">
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                    <div className="space-y-5">
                      <Card className="border-slate-200 shadow-none">
                        <CardContent className="space-y-4 p-5">
                          <div className="flex items-center gap-2">
                            <Wallet className="h-4 w-4 text-slate-500" />
                            <p className="text-[13px] font-semibold text-slate-950">은행 원본</p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[11px] text-slate-500">거래일시</p>
                              <p className="mt-1 text-[13px] font-medium text-slate-950">{selectedItem.bankSnapshot.dateTime || '-'}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[11px] text-slate-500">거래처</p>
                              <p className="mt-1 text-[13px] font-medium text-slate-950">{selectedItem.bankSnapshot.counterparty || '-'}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[11px] text-slate-500">입출금액</p>
                              <p className="mt-1 text-[13px] font-medium text-slate-950">
                                {selectedItem.bankSnapshot.signedAmount < 0 ? '-' : '+'}
                                {formatMoney(Math.abs(selectedItem.bankSnapshot.signedAmount))}원
                              </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[11px] text-slate-500">통장잔액</p>
                              <p className="mt-1 text-[13px] font-medium text-slate-950">{formatMoney(selectedItem.bankSnapshot.balanceAfter)}원</p>
                            </div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-[11px] text-slate-500">원본 적요</p>
                            <p className="mt-1 text-[13px] leading-6 text-slate-900">{selectedItem.bankSnapshot.memo || '원본 메모 없음'}</p>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-slate-200 shadow-none">
                        <CardContent className="space-y-4 p-5">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-slate-500" />
                            <p className="text-[13px] font-semibold text-slate-950">사람이 입력해야 하는 필드</p>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-2">
                              <span className="text-[11px] font-medium text-slate-600">사업비 사용액</span>
                              <input
                                data-testid="bank-import-expense-amount"
                                value={activeManualFields.expenseAmount ?? ''}
                                onChange={(event) => setDrafts((prev) => ({
                                  ...prev,
                                  [selectedItem.id]: {
                                    ...activeManualFields,
                                    expenseAmount: Number.parseInt(event.target.value.replace(/[^0-9-]/g, ''), 10) || 0,
                                  },
                                }))}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none ring-0 transition focus:border-slate-400"
                                inputMode="numeric"
                                placeholder="예: 15000"
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-medium text-slate-600">비목</span>
                              <input
                                data-testid="bank-import-budget-category"
                                value={activeManualFields.budgetCategory || ''}
                                onChange={(event) => setDrafts((prev) => ({
                                  ...prev,
                                  [selectedItem.id]: {
                                    ...activeManualFields,
                                    budgetCategory: event.target.value,
                                  },
                                }))}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-slate-400"
                                placeholder="예: 여비"
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-medium text-slate-600">세목</span>
                              <input
                                data-testid="bank-import-budget-subcategory"
                                value={activeManualFields.budgetSubCategory || ''}
                                onChange={(event) => setDrafts((prev) => ({
                                  ...prev,
                                  [selectedItem.id]: {
                                    ...activeManualFields,
                                    budgetSubCategory: event.target.value,
                                  },
                                }))}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-slate-400"
                                placeholder="예: 교통비"
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-medium text-slate-600">cashflow 항목</span>
                              <select
                                data-testid="bank-import-cashflow-category"
                                value={activeManualFields.cashflowCategory || ''}
                                onChange={(event) => setDrafts((prev) => ({
                                  ...prev,
                                  [selectedItem.id]: {
                                    ...activeManualFields,
                                    cashflowCategory: event.target.value as CashflowCategory,
                                  },
                                }))}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-slate-400"
                              >
                                <option value="">선택하세요</option>
                                {CASHFLOW_OPTIONS.map((option) => (
                                  <option key={option} value={option}>
                                    {CASHFLOW_CATEGORY_LABELS[option]}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <label className="space-y-2">
                            <span className="text-[11px] font-medium text-slate-600">메모</span>
                            <textarea
                              data-testid="bank-import-memo"
                              value={activeManualFields.memo || ''}
                              onChange={(event) => setDrafts((prev) => ({
                                ...prev,
                                [selectedItem.id]: {
                                  ...activeManualFields,
                                  memo: event.target.value,
                                },
                              }))}
                              className="min-h-[90px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-slate-400"
                              placeholder="이 거래에만 필요한 사람 메모를 남깁니다."
                            />
                          </label>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="space-y-5">
                      <Card className="border-slate-200 shadow-none">
                        <CardContent className="space-y-3 p-5">
                          <p className="text-[13px] font-semibold text-slate-950">현재 상태</p>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                              <span className="text-[12px] text-slate-600">매칭 상태</span>
                              <Badge className={getMatchTone(selectedItem).badgeClass}>{getMatchTone(selectedItem).label}</Badge>
                            </div>
                          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                              <span className="text-[12px] text-slate-600">주간 반영 상태</span>
                              <Badge variant="outline">{selectedStatus || selectedItem.projectionStatus}</Badge>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                              <span className="text-[12px] text-slate-600">증빙 상태</span>
                              <Badge variant="outline">{selectedItem.evidenceStatus}</Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-slate-200 shadow-none">
                        <CardContent className="space-y-3 p-5">
                          <p className="text-[13px] font-semibold text-slate-950">증빙 체크리스트</p>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-[11px] text-slate-500">필수 증빙</p>
                            <p className="mt-1 text-[12px] leading-6 text-slate-900">
                              {requiredEvidenceDesc || '현재 분류 기준으로 자동 판단된 필수 증빙이 없습니다.'}
                            </p>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                              <p className="text-[11px] text-slate-500">완료된 증빙</p>
                              <p className="mt-1 text-[12px] leading-6 text-slate-900">
                                {evidenceChecklist.completed.join(', ') || '아직 없음'}
                              </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                              <p className="text-[11px] text-slate-500">아직 필요한 증빙</p>
                              <p className="mt-1 text-[12px] leading-6 text-slate-900">
                                {evidenceChecklist.missing.join(', ') || '없음'}
                              </p>
                            </div>
                          </div>
                          <label className="space-y-2">
                            <span className="text-[11px] font-medium text-slate-600">구비 완료된 증빙자료 리스트</span>
                            <textarea
                              data-testid="bank-import-evidence-completed"
                              value={activeManualFields.evidenceCompletedDesc || ''}
                              onChange={(event) => setDrafts((prev) => ({
                                ...prev,
                                [selectedItem.id]: {
                                  ...activeManualFields,
                                  evidenceCompletedDesc: event.target.value,
                                },
                              }))}
                              className="min-h-[72px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-slate-400"
                              placeholder="예: 출장신청서, 영수증"
                            />
                          </label>
                          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[11px] leading-5 text-slate-600">
                            증빙은 같은 루프에서 이어서 처리할 수 있지만 주간 반영의 blocker는 아닙니다. 지금은 완료 목록을 먼저 기록하고, 실제 파일 업로드는 이어지는 단계에서 계속해도 됩니다.
                          </div>
                          {selectedItem.reviewReasons.length > 0 && (
                            <ul className="space-y-2">
                              {selectedItem.reviewReasons.map((reason) => (
                                <li key={reason} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
                                  {reason}
                                </li>
                              ))}
                            </ul>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-white px-6 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] text-slate-500">
                      {selectedStatus === 'PROJECTED_PENDING_EVIDENCE'
                        ? '주간 반영은 이미 끝났고, 지금은 증빙 continuation만 남아 있습니다.'
                        : '필수 입력을 저장하면 이 거래는 안전하게 주간 정산 projection으로 이어집니다.'}
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedStatus === 'PROJECTED_PENDING_EVIDENCE' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={savingId === selectedItem.id}
                          onClick={skipEvidenceForNow}
                        >
                          증빙은 나중에
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                        최소화
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={savingId === selectedItem.id}
                        data-testid="bank-import-save-draft"
                        onClick={() => void saveCurrentDraft(false)}
                      >
                        {savingId === selectedItem.id ? '저장 중...' : '임시 저장'}
                      </Button>
                      <Button
                        size="sm"
                        disabled={savingId === selectedItem.id}
                        data-testid="bank-import-project-next"
                        onClick={() => void projectCurrentItem()}
                      >
                        {selectedStatus === 'PROJECTED_PENDING_EVIDENCE'
                          ? (wizardItems.findIndex((item) => item.id === selectedItem.id) === wizardItems.length - 1 ? '증빙 저장 후 닫기' : '증빙 저장 후 다음 거래')
                          : isBankImportManualFieldsComplete(activeManualFields)
                            ? (wizardItems.findIndex((item) => item.id === selectedItem.id) === wizardItems.length - 1 ? '주간 반영 후 닫기' : '주간 반영 후 다음 거래')
                            : (wizardItems.findIndex((item) => item.id === selectedItem.id) === wizardItems.length - 1 ? '저장 후 닫기' : '저장 후 다음 거래')}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
