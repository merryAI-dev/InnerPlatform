import { MessageSquare } from 'lucide-react';

export function CellCommentButton({
  count,
  disabled,
  onClick,
}: {
  count: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={disabled ? '저장 후 메모를 남길 수 있습니다' : '셀 메모 열기'}
      aria-label="셀 메모 열기"
      disabled={disabled}
      className={`absolute top-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-md border text-[10px] transition ${
        count > 0
          ? 'border-amber-300 bg-amber-50 text-amber-700 opacity-100'
          : 'border-transparent bg-background/90 text-muted-foreground opacity-0 group-hover:opacity-100'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-border hover:text-foreground'}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <MessageSquare className="h-3.5 w-3.5" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold leading-none text-white">
          {count}
        </span>
      )}
    </button>
  );
}
