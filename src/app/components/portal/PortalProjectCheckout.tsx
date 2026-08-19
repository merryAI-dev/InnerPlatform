import { useMemo } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Circle, FileText, AlertTriangle } from 'lucide-react';
import { usePortalStore } from '../../data/portal-store';
import type { Project } from '../../data/types';

/**
 * 종료사업 체크아웃.
 *
 * 체크 항목과 증빙은 예전부터 프로젝트에 저장돼 왔지만 그것을 한자리에서 확인하는 화면이
 * 없었다. 등록 편집기 안에 묻혀 있었고 그나마 상태가 완료일 때만 열렸다. 사업을 끝낼 때
 * "무엇이 남았는지" 를 묻는 자리를 여기 하나로 둔다.
 */

type CheckItem = { label: string; done: boolean; note?: string };
type UploadItem = { label: string; attached: boolean; note?: string };

function readChecklist(project: Project): CheckItem[] {
  const checkout = project.checkout;
  return [
    { label: '잔금 입금 완료', done: checkout?.finalPaymentReceived === true },
    { label: '사업비 통장 0원', done: checkout?.bankBalanceZero === true },
    {
      label: '용역수행실적증명서 원본 제출',
      done: checkout?.performanceCertificateReceived === true,
      note: '원본 수령 시 최소 5부. 전자플랫폼(e나라도움 · KOICA · 온드림 등)은 업로드로 마무리합니다.',
    },
  ];
}

function readUploads(project: Project): UploadItem[] {
  const checkout = project.checkout;
  return [
    {
      label: '사업 관련 발행 세금계산서 PDF',
      attached: Boolean(project.taxInvoiceDocument?.path),
      note: checkout?.taxInvoiceEvidenceConfirmed ? '해당 사업으로 표시됨' : '해당 시에만 제출합니다.',
    },
    {
      label: '고객사 용역수행실적증명서 PDF',
      attached: Boolean(project.performanceCertificateDocument?.path),
      note: checkout?.performanceCertificateDocumentApplicable ? '해당 사업으로 표시됨' : '해당 시에만 제출합니다.',
    },
    {
      label: '회계사 최종 정산리포트',
      attached: Boolean(project.finalSettlementReportDocument?.path),
      note: checkout?.finalSettlementReportConfirmed ? '해당 사업으로 표시됨' : '회계사 정산 사업만 해당합니다.',
    },
  ];
}

export function PortalProjectCheckout() {
  const { activeProjectId, projects } = usePortalStore();
  const project = useMemo(
    () => projects.find((candidate) => candidate.id === activeProjectId) || null,
    [activeProjectId, projects],
  );

  const checklist = useMemo(() => (project ? readChecklist(project) : []), [project]);
  const uploads = useMemo(() => (project ? readUploads(project) : []), [project]);

  if (!project) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-[13px] text-slate-500">
        먼저 사업을 선택해 주세요.
      </div>
    );
  }

  const settlementClosed = project.checkout?.usbEvidenceSubmitted === true;
  const evidenceDeleted = project.checkout?.evidenceDeletedAfterUsb === true;
  const remaining = checklist.filter((item) => !item.done).length
    + uploads.filter((item) => !item.attached).length;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-[20px] font-semibold text-slate-900">종료사업 체크아웃</h1>
        <p className="text-[13px] text-slate-600">
          사업이 마무리된 뒤 최종 마무리 액션을 취했는지, 받아야 할 서류는 받았는지 확인합니다.
        </p>
        <p className="text-[13px] text-slate-500">{project.name}</p>
      </header>

      {remaining > 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>아직 확인되지 않은 항목이 {remaining}개 있습니다.</span>
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>체크아웃 항목이 모두 확인되었습니다.</span>
        </p>
      )}

      <section className="space-y-3">
        <h2 className="border-b border-slate-200 pb-2 text-[12px] font-semibold text-slate-700">체크리스트</h2>
        <ul className="space-y-2">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-[13px]">
              {item.done
                ? <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[#047857]" />
                : <Circle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
              <span className="min-w-0">
                <span className={item.done ? 'text-slate-900' : 'text-slate-600'}>{item.label}</span>
                {item.note ? <span className="mt-0.5 block text-[12px] text-slate-500">{item.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="border-b border-slate-200 pb-2 text-[12px] font-semibold text-slate-700">업로드</h2>
        <ul className="space-y-2">
          {uploads.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-[13px]">
              <FileText aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${item.attached ? 'text-[#047857]' : 'text-slate-300'}`} />
              <span className="min-w-0">
                <span className={item.attached ? 'text-slate-900' : 'text-slate-600'}>{item.label}</span>
                <span className="ml-2 text-[12px] text-slate-500">{item.attached ? '첨부됨' : '미첨부'}</span>
                {item.note ? <span className="mt-0.5 block text-[12px] text-slate-500">{item.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="border-b border-slate-200 pb-2 text-[12px] font-semibold text-slate-700">정산사업 마감</h2>
        <ul className="space-y-2 text-[13px]">
          <li className="flex items-start gap-2">
            {settlementClosed
              ? <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[#047857]" />
              : <Circle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
            <span>정산 자료 USB 저장 후 재경팀 제출</span>
          </li>
          <li className="flex items-start gap-2">
            {evidenceDeleted
              ? <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[#047857]" />
              : <Circle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
            <span>증빙자료 삭제 (사용내역은 그대로 유지)</span>
          </li>
        </ul>
      </section>

      <p className="text-[13px] text-slate-600">
        체크와 증빙은{' '}
        <Link className="font-medium text-[#0176D3] underline underline-offset-2" to={`/portal/edit-project/${project.id}`}>
          프로젝트 수정
        </Link>
        {' '}화면에서 입력합니다.
      </p>
    </div>
  );
}
