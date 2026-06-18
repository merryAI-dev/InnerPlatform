import { ArrowDown, CheckCircle2, FileSpreadsheet, HelpCircle, RefreshCcw, Save, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

interface CashflowGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FLOW_STEPS = [
  {
    icon: FileSpreadsheet,
    label: 'Projection 작성',
    title: '계획값을 먼저 서버 기준본으로 만듭니다.',
    description: '기존 시트 가져오기 또는 직접 입력 후 주차별 작성완료를 눌러 Projection 업데이트 상태를 남깁니다.',
  },
  {
    icon: RefreshCcw,
    label: 'Actual 불러오기',
    title: '주간 사업비 입력표에서 실제값을 계산합니다.',
    description: '정산/사업비 입력표에 저장된 입금·지출을 읽어 캐시플로 Actual 칸에 채웁니다.',
  },
  {
    icon: Save,
    label: 'Actual 저장',
    title: '화면 기준값을 확정 저장합니다.',
    description: '불러온 값은 미리보기 단계입니다. Actual 저장을 눌러야 다음 접속과 다른 화면에 같은 값이 보입니다.',
  },
  {
    icon: ShieldCheck,
    label: '제출·결산',
    title: '주차 상태를 잠그고 운영 흐름을 넘깁니다.',
    description: 'PM은 작성완료, finance/admin은 제출현황과 Actual 상태를 확인한 뒤 결산완료를 진행합니다.',
  },
];

const GUIDE_SECTIONS = [
  {
    badge: '원칙 1. 두 기준값 분리',
    title: 'Projection과 Actual은 서로 덮어쓰지 않습니다.',
    body: 'Projection은 계획 기준, Actual은 정산/사업비 입력 기준입니다. 비교 모드는 두 값을 같은 주차 구조에서 나란히 보는 화면이며, 저장 버튼도 각각의 기준값에만 반영됩니다.',
  },
  {
    badge: '원칙 2. 불러오기와 저장 분리',
    title: 'Actual 불러오기는 계산, Actual 저장은 확정입니다.',
    body: 'Actual 불러오기는 현재 사업비 입력표를 기준으로 화면 값을 갱신합니다. 운영 기준본으로 반영하려면 반드시 Actual 저장까지 실행해야 합니다.',
  },
  {
    badge: '원칙 3. 결산 전 체크',
    title: '결산완료 전에는 제출현황과 주차 상태를 함께 봅니다.',
    body: 'Projection 업데이트와 사업비 입력 체크가 모두 완료된 주차만 결산 흐름에 올리는 것이 기본입니다. 일부 검토 상태는 경고로 안내하되, 권한자는 필요한 경우 진행할 수 있습니다.',
  },
];

export function CashflowGuideButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-[12px]"
      onClick={onClick}
    >
      <HelpCircle className="h-3.5 w-3.5" />
      가이드
    </Button>
  );
}

export function CashflowGuideDialog({ open, onOpenChange }: CashflowGuideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(1120px,calc(100vw-32px))] max-w-none gap-0 overflow-hidden rounded-[24px] border-0 bg-white p-0 text-slate-950 shadow-2xl">
        <div className="max-h-[calc(100dvh-32px)] overflow-y-auto">
          <DialogHeader className="px-6 pb-5 pt-8 text-left sm:px-10 sm:pt-10">
            <p className="text-[13px] font-extrabold text-blue-600">Cashflow Guide</p>
            <DialogTitle className="max-w-[760px] text-[26px] font-extrabold leading-[1.35] tracking-normal text-slate-950 sm:text-[32px]">
              캐시플로우 입력과 결산 흐름을 같은 기준으로 맞춥니다
            </DialogTitle>
            <DialogDescription className="max-w-[680px] text-[13px] leading-6 text-slate-500">
              Projection, Actual, 제출현황, 결산완료가 각각 어떤 값을 확정하는지 운영자가 빠르게 확인하는 안내입니다.
            </DialogDescription>
            <div className="mt-4 grid max-w-[720px] gap-2 rounded-xl bg-slate-50 px-4 py-3 sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-bold text-blue-600">대상</p>
                <p className="mt-1 text-[13px] font-bold">PM · finance · admin</p>
              </div>
              <div>
                <p className="text-[11px] font-bold text-blue-600">주기</p>
                <p className="mt-1 text-[13px] font-bold">월별 주차 관리</p>
              </div>
              <div>
                <p className="text-[11px] font-bold text-blue-600">기준값</p>
                <p className="mt-1 text-[13px] font-bold">Firestore 서버 기준본</p>
              </div>
            </div>
          </DialogHeader>

          <main className="space-y-8 px-6 pb-8 sm:px-10">
            <section className="rounded-[24px] bg-slate-50 px-5 py-6 sm:px-8">
              <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="inline-flex rounded-md bg-blue-600 px-3 py-2 text-[12px] font-extrabold text-white">
                    운영 순서도
                  </p>
                  <h2 className="mt-4 max-w-[540px] text-[22px] font-extrabold leading-[1.4] tracking-normal sm:text-[26px]">
                    실제 반영은 저장 버튼 기준으로 끊어서 확인합니다
                  </h2>
                </div>
                <p className="max-w-[360px] text-[12px] leading-5 text-slate-500">
                  각 단계는 화면 값과 서버 기준값이 달라질 수 있는 지점을 명확히 분리합니다.
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-4">
                {FLOW_STEPS.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <div key={step.label} className="relative rounded-2xl bg-white p-4 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                          {step.label}
                        </span>
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                          <Icon className="h-4 w-4" />
                        </span>
                      </div>
                      <h3 className="text-[15px] font-extrabold leading-6 tracking-normal text-slate-950">{step.title}</h3>
                      <p className="mt-3 text-[12px] leading-5 text-slate-500">{step.description}</p>
                      {index < FLOW_STEPS.length - 1 && (
                        <ArrowDown className="absolute -bottom-5 left-1/2 z-10 h-5 w-5 -translate-x-1/2 text-slate-300 lg:-right-5 lg:bottom-auto lg:left-auto lg:top-1/2 lg:-translate-y-1/2 lg:rotate-[-90deg]" />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {GUIDE_SECTIONS.map((section, index) => (
              <section key={section.badge} className="grid gap-6 rounded-[24px] bg-slate-50 px-5 py-6 sm:px-8 lg:grid-cols-[1fr_1.1fr]">
                <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                  <p className="inline-flex rounded-md bg-blue-600 px-3 py-2 text-[12px] font-extrabold text-white">
                    {section.badge}
                  </p>
                  <h2 className="mt-5 text-[22px] font-extrabold leading-[1.45] tracking-normal text-slate-950 sm:text-[25px]">
                    {section.title}
                  </h2>
                  <p className="mt-24 text-[12px] leading-6 text-slate-600 sm:mt-28">
                    {section.body}
                  </p>
                </div>
                <div className="flex items-center justify-center rounded-[20px] bg-white p-5 shadow-sm">
                  <div className="w-full max-w-[420px] space-y-3">
                    <div className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                      <span className="text-[12px] font-bold text-slate-500">화면에서 보이는 값</span>
                      <span className="text-[13px] font-extrabold text-slate-950">편집/계산 중</span>
                    </div>
                    <div className="flex items-center justify-center">
                      <ArrowDown className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                      <span className="text-[12px] font-bold text-blue-700">저장 액션</span>
                      <span className="text-[13px] font-extrabold text-blue-700">서버 기준본 반영</span>
                    </div>
                    <div className="flex items-center justify-center">
                      <ArrowDown className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                      <span className="text-[12px] font-bold text-emerald-700">운영 상태</span>
                      <span className="inline-flex items-center gap-1 text-[13px] font-extrabold text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        제출/결산 판단
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            ))}
          </main>

          <DialogFooter className="sticky bottom-0 border-t border-slate-100 bg-white/95 px-6 py-4 backdrop-blur sm:px-10">
            <Button type="button" className="h-9 text-[12px]" onClick={() => onOpenChange(false)}>
              확인
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
