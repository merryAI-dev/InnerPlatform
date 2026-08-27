import type { ReactNode } from 'react';
import { FileX2 } from 'lucide-react';
import { cn } from './utils';

/**
 * 업무 시스템용 표.
 *
 * 머리와 몸통이 구분되지 않으면 어디까지가 라벨이고 어디부터가 값인지 매번 다시 읽어야 한다.
 * 그래서 머리는 회색 띠 + 두꺼운 아래선으로 끊고, **열마다 세로선**을 둔다 — 값이 많은 표에서
 * 세로선이 없으면 눈이 옆줄로 새어 나간다.
 *
 * DESIGN.md 의 방향(industrial / Jira-like, 장식 최소)을 따른다. 카드처럼 띄우지 않고
 * 테두리와 행 리듬으로만 구분한다.
 */

type Align = 'left' | 'center' | 'right';

const ALIGN_CLASS: Record<Align, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right tabular-nums',
};

export function DataGrid({ children, className, minWidth }: {
  children: ReactNode;
  className?: string;
  /** 열이 많은 표는 줄바꿈 대신 가로 스크롤로 다룬다. */
  minWidth?: number;
}) {
  return (
    <div className={cn('overflow-x-auto rounded-md border border-slate-300 bg-white', className)}>
      <table className="w-full border-collapse" style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}

export function DataGridHead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10">
      <tr className="border-b-2 border-slate-300 bg-slate-100">{children}</tr>
    </thead>
  );
}

export function DataGridHeadCell({
  children, align = 'left', className, width, last,
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
  width?: string;
  /** 마지막 열은 오른쪽 세로선을 긋지 않는다. */
  last?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold text-slate-700',
        !last && 'border-r border-slate-300',
        ALIGN_CLASS[align],
        width,
        className,
      )}
    >
      {children}
    </th>
  );
}

export function DataGridBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function DataGridRow({ children, onClick, className }: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        'border-b border-slate-200 last:border-b-0',
        onClick && 'cursor-pointer transition-colors duration-150 hover:bg-slate-50',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function DataGridCell({
  children, align = 'left', className, last, muted, title,
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
  last?: boolean;
  muted?: boolean;
  /** 잘린 값의 전체 내용을 마우스로 확인할 수 있게 한다. */
  title?: string;
}) {
  return (
    <td
      title={title}
      className={cn(
        'px-3 py-2.5 text-sm align-middle',
        !last && 'border-r border-slate-200',
        muted ? 'text-slate-500' : 'text-slate-900',
        ALIGN_CLASS[align],
        className,
      )}
    >
      {children}
    </td>
  );
}

/** 비어 있음을 분명히 알린다. 빈 표는 '아직 안 불러온 것' 과 구분되어야 한다. */
export function DataGridEmpty({ colSpan, message = '데이터가 존재하지 않습니다', loading = false }: {
  colSpan: number;
  message?: string;
  loading?: boolean;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-16 text-center">
        {loading ? (
          <p className="text-sm text-slate-500" role="status">불러오는 중…</p>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <FileX2 className="h-8 w-8" aria-hidden />
            <p className="text-sm">{message}</p>
          </div>
        )}
      </td>
    </tr>
  );
}
