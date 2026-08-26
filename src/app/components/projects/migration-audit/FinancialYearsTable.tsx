import { Fragment } from 'react';
import type { Project } from '../../../data/types';

type FinancialYearRow = NonNullable<Project['financialYears']>[number];

function money(value?: number) {
  return Number.isFinite(value) ? `${Number(value).toLocaleString('ko-KR')}원` : '-';
}

/**
 * 결재 문서의 연도별 계약/재무. 한 줄 문자열로 이으면 다년도 사업은 읽을 수 없어
 * 표 안의 표로 그린다. 입금 예정월은 금액 아래 작은 글씨로 붙인다.
 */
export function FinancialYearsTable({ years }: { years?: FinancialYearRow[] }) {
  const rows = Array.isArray(years) ? years : [];
  if (rows.length === 0) return <span className="text-slate-400">-</span>;
  const paymentCell = (amount?: number, month?: string) => (
    <div className="text-right">
      <p>{money(amount)}</p>
      {month ? <p className="text-[10px] text-slate-500">{month}</p> : null}
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[11px] leading-5">
        <thead>
          <tr className="border-b border-slate-400 bg-slate-50 text-slate-700">
            <th className="border-r border-slate-300 px-2 py-1.5 text-left font-semibold">연도</th>
            <th className="border-r border-slate-300 px-2 py-1.5 text-right font-semibold">계약금액</th>
            <th className="border-r border-slate-300 px-2 py-1.5 text-right font-semibold">총수익</th>
            <th className="border-r border-slate-300 px-2 py-1.5 text-right font-semibold">총실비(원가)</th>
            <th className="border-r border-slate-300 px-2 py-1.5 text-right font-semibold">지원금</th>
            <th className="border-r border-slate-300 px-2 py-1.5 text-right font-semibold">선금</th>
            <th className="border-r border-slate-300 px-2 py-1.5 text-right font-semibold">중도금</th>
            <th className="border-r border-slate-300 px-2 py-1.5 text-right font-semibold">잔금</th>
            <th className="px-2 py-1.5 text-center font-semibold">정산</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.year}>
              <tr className="border-b border-slate-200 last:border-b-0">
                <th scope="row" className="whitespace-nowrap border-r border-slate-300 px-2 py-1.5 text-left font-semibold text-slate-900">
                  {row.year}년
                </th>
                <td className="border-r border-slate-300 px-2 py-1.5 text-right">{money(row.contractAmount)}</td>
                <td className="border-r border-slate-300 px-2 py-1.5 text-right">{money(row.totalRevenueAmount)}</td>
                <td className="border-r border-slate-300 px-2 py-1.5 text-right">{money(row.totalActualCost)}</td>
                <td className="border-r border-slate-300 px-2 py-1.5 text-right">{money(row.supportAmount)}</td>
                <td className="border-r border-slate-300 px-2 py-1.5">{paymentCell(row.paymentPlan?.contract, row.paymentExpectedMonths?.contract)}</td>
                <td className="border-r border-slate-300 px-2 py-1.5">{paymentCell(row.paymentPlan?.interim, row.paymentExpectedMonths?.interim)}</td>
                <td className="border-r border-slate-300 px-2 py-1.5">{paymentCell(row.paymentPlan?.final, row.paymentExpectedMonths?.final)}</td>
                <td className="px-2 py-1.5 text-center">{row.isSettled ? '완료' : '미완료'}</td>
              </tr>
              {String(row.advanceInterimBelow70Reason || '').trim() ? (
                <tr className="border-b border-slate-200 last:border-b-0">
                  <td colSpan={9} className="bg-amber-50/60 px-2 py-1.5 text-[10px] text-amber-900">
                    {row.year}년 선금·중도금 70% 미만 사유 · {row.advanceInterimBelow70Reason}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
