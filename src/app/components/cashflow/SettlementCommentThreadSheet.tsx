import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Comment } from '../../data/types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { Textarea } from '../ui/textarea';

export interface ActiveCommentAnchor {
  transactionId: string;
  fieldKey: string;
  fieldLabel: string;
  rowLabel: string;
}

function formatCommentTime(value: string): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '';
}

export function SettlementCommentThreadSheet({
  anchor,
  comments,
  open,
  projectId,
  currentUserId,
  currentUserName,
  onClose,
  onAddComment,
}: {
  anchor: ActiveCommentAnchor | null;
  comments: Comment[];
  open: boolean;
  projectId: string;
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onAddComment?: (comment: Comment) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setDraft('');
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (!anchor || !onAddComment) return;
    const content = draft.trim();
    if (!content) return;

    setSaving(true);
    try {
      const isSheetRowComment = anchor.transactionId.startsWith('sheet-row:');
      await onAddComment({
        id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        transactionId: anchor.transactionId,
        projectId,
        targetType: isSheetRowComment ? 'expense_sheet_row' : 'transaction',
        ...(isSheetRowComment ? { sheetRowId: anchor.transactionId } : {}),
        authorId: currentUserId || currentUserName,
        authorName: currentUserName,
        fieldKey: anchor.fieldKey,
        fieldLabel: anchor.fieldLabel,
        content,
        createdAt: new Date().toISOString(),
      });
      setDraft('');
      toast.success('메모를 남겼습니다.');
    } catch (error) {
      console.error('[SettlementLedger] add comment failed:', error);
      toast.error('메모 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [anchor, currentUserId, currentUserName, draft, onAddComment, projectId]);

  return (
    <Sheet modal={false} open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent side="right" showOverlay={false} className="w-[420px] sm:max-w-[420px] gap-0">
        <SheetHeader className="border-b">
          <SheetTitle className="text-[14px]">셀 메모</SheetTitle>
          <SheetDescription className="text-[11px]">
            {anchor ? `${anchor.rowLabel} · ${anchor.fieldLabel}` : '메모를 남길 셀을 선택하세요.'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {comments.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-6 text-[12px] text-muted-foreground">
              아직 메모가 없습니다. 아래 입력창에 첫 메모를 남겨보세요.
            </div>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-2xl border bg-background px-3 py-2.5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold">{comment.authorName}</span>
                    <span className="text-[10px] text-muted-foreground">{formatCommentTime(comment.createdAt)}</span>
                  </div>
                  {comment.fieldLabel && (
                    <Badge variant="secondary" className="mt-2 text-[9px]">{comment.fieldLabel}</Badge>
                  )}
                  <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5">{comment.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t px-4 py-4 space-y-2">
          <Textarea
            value={draft}
            placeholder="이 셀에 남길 메모를 적어주세요"
            className="min-h-24 text-[12px]"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">Cmd/Ctrl + Enter로 저장</span>
            <Button size="sm" className="h-8 text-[11px]" disabled={!draft.trim() || saving || !anchor || !onAddComment} onClick={() => void handleSubmit()}>
              {saving ? '저장중...' : '메모 남기기'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
