import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, FileWarning, Wallet } from 'lucide-react';
import type { BankImportIntakeItem, CashflowCategory } from '../../data/types';
import { CASHFLOW_CATEGORY_LABELS } from '../../data/types';
import { isBankImportManualFieldsComplete, selectWizardIntakeItems } from '../../platform/bank-import-triage';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

interface BankImportTriageWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: BankImportIntakeItem[];
  onSaveDraft: (id: string, updates: Partial<BankImportIntakeItem>) => Promise<void>;
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
}: BankImportTriageWizardProps) {
  const wizardItems = useMemo(() => selectWizardIntakeItems(items), [items]);
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

  const completedCount = wizardItems.filter((item) => isBankImportManualFieldsComplete({
    ...item.manualFields,
    ...(drafts[item.id] || {}),
  })).length;

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
        const currentIndex = wizardItems.findIndex((item) => item.id === selectedItem.id);
        const nextItem = wizardItems[currentIndex + 1] || null;
        if (nextItem) {
          setSelectedId(nextItem.id);
        } else {
          onOpenChange(false);
        }
      }
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1200px] w-[calc(100vw-2rem)] h-[min(88vh,860px)] overflow-hidden p-0 gap-0">
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
              <div className="space-y-2">
                {wizardItems.length === 0 ? (
                  <Card className="border-emerald-200 bg-emerald-50/70 shadow-none">
                    <CardContent className="p-4 text-[12px] leading-6 text-emerald-900">
                      이번 업로드에서 바로 사람이 처리할 거래는 없습니다.
                    </CardContent>
                  </Card>
                ) : wizardItems.map((item, index) => {
                  const tone = getMatchTone(item);
                  const ToneIcon = tone.icon;
                  const isSelected = item.id === selectedItem?.id;
                  const isComplete = isBankImportManualFieldsComplete({
                    ...item.manualFields,
                    ...(drafts[item.id] || {}),
                  });
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
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
                              {tone.label}
                            </Badge>
                            {isComplete && (
                              <Badge className={isSelected ? 'border-emerald-300/20 bg-emerald-400/15 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                저장 준비
                              </Badge>
                            )}
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
                              <Badge variant="outline">{selectedItem.projectionStatus}</Badge>
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
                          <p className="text-[13px] font-semibold text-slate-950">운영 메모</p>
                          {selectedItem.reviewReasons.length > 0 ? (
                            <ul className="space-y-2">
                              {selectedItem.reviewReasons.map((reason) => (
                                <li key={reason} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
                                  {reason}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] leading-6 text-slate-600">
                              이번 단계에서는 필수 입력을 먼저 저장하고, 증빙 업로드는 다음 단계에서 같은 흐름에 이어 붙입니다.
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-white px-6 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] text-slate-500">
                      필수 입력을 저장하면 이 거래는 다음 단계에서 안전하게 주간 정산 projection으로 이어집니다.
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                        최소화
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={savingId === selectedItem.id}
                        onClick={() => void saveCurrentDraft(false)}
                      >
                        {savingId === selectedItem.id ? '저장 중...' : '임시 저장'}
                      </Button>
                      <Button
                        size="sm"
                        disabled={savingId === selectedItem.id}
                        onClick={() => void saveCurrentDraft(true)}
                      >
                        {wizardItems.findIndex((item) => item.id === selectedItem.id) === wizardItems.length - 1 ? '저장 후 닫기' : '저장 후 다음 거래'}
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
