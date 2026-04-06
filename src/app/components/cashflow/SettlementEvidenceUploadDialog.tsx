import { useMemo } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { EVIDENCE_DOCUMENT_CATEGORIES } from '../../platform/drive-evidence';

export interface EvidenceUploadDraft {
  id: string;
  file: File;
  objectUrl: string;
  category: string;
  parserCategory: string;
  requiredCategory: string;
  suggestedFileName: string;
  reviewedFileName: string;
  previewType: 'pdf' | 'image' | 'other';
}

export function SettlementEvidenceUploadDialog({
  open,
  uploadDrafts,
  activeUploadDraftId,
  uploadingEvidence,
  onOpenChange,
  onPickFiles,
  onCancel,
  onConfirm,
  onSelectDraft,
  onUpdateDraftCategory,
  onUpdateDraftFileName,
  onResetDraftFileName,
}: {
  open: boolean;
  uploadDrafts: EvidenceUploadDraft[];
  activeUploadDraftId: string;
  uploadingEvidence: boolean;
  onOpenChange: (open: boolean) => void;
  onPickFiles: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onSelectDraft: (id: string) => void;
  onUpdateDraftCategory: (id: string, category: string) => void;
  onUpdateDraftFileName: (id: string, nextFileName: string) => void;
  onResetDraftFileName: (id: string) => void;
}) {
  const activeUploadDraft = useMemo(
    () => uploadDrafts.find((draft) => draft.id === activeUploadDraftId) || uploadDrafts[0] || null,
    [activeUploadDraftId, uploadDrafts],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[92vh] w-[96vw] max-w-[96vw] gap-0 overflow-hidden p-0 sm:max-w-[96vw]">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>증빙 업로드 검토</DialogTitle>
              <DialogDescription>
                좌측에서 파일을 확인하고, 우측에서 자동 분류 결과를 수정한 뒤 업로드하세요.
              </DialogDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onPickFiles} disabled={uploadingEvidence}>
              파일 선택
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden px-6 py-4">
          <div className="grid h-full gap-4 lg:grid-cols-[minmax(0,1.4fr)_380px]">
            <div className="min-h-0 rounded-xl border bg-slate-50/60 p-3">
              {activeUploadDraft ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold">{activeUploadDraft.file.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {(activeUploadDraft.file.size / 1024).toFixed(1)} KB · {activeUploadDraft.file.type || 'application/octet-stream'}
                      </p>
                    </div>
                    <span className="rounded-full border bg-background px-2 py-1 text-[10px] text-muted-foreground">
                      파일명 자동분류
                    </span>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2 text-[11px]">
                    <p className="text-[10px] font-semibold text-muted-foreground">원본 파일명</p>
                    <p className="mt-1 break-all">{activeUploadDraft.file.name}</p>
                  </div>
                  <div className="flex-1 overflow-hidden rounded-lg border bg-background">
                    {activeUploadDraft.previewType === 'pdf' ? (
                      <iframe
                        title={activeUploadDraft.file.name}
                        src={activeUploadDraft.objectUrl}
                        className="h-full min-h-[420px] w-full"
                      />
                    ) : activeUploadDraft.previewType === 'image' ? (
                      <img
                        src={activeUploadDraft.objectUrl}
                        alt={activeUploadDraft.file.name}
                        className="h-full min-h-[420px] w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
                        브라우저 미리보기를 지원하지 않는 형식입니다. 업로드 후 Drive 링크에서 원본을 확인하세요.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-[12px] text-muted-foreground">
                  <p>업로드할 파일을 선택하세요.</p>
                  <Button type="button" variant="outline" size="sm" onClick={onPickFiles} disabled={uploadingEvidence}>
                    파일 선택
                  </Button>
                </div>
              )}
            </div>
            <div className="flex min-h-0 flex-col gap-3">
              <div className="rounded-xl border bg-background p-3">
                <p className="text-[12px] font-semibold">파싱 결과</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  파일명과 운영 규칙으로 자동 분류했습니다. 목록에 없는 증빙 종류는 아래에서 직접 입력해 주세요.
                </p>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                {uploadDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    role="button"
                    tabIndex={0}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      activeUploadDraft?.id === draft.id
                        ? 'border-teal-400 bg-teal-50/70'
                        : 'border-border bg-background hover:bg-muted/40'
                    }`}
                    onClick={() => onSelectDraft(draft.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectDraft(draft.id);
                      }
                    }}
                  >
                    <p className="truncate text-[12px] font-medium">{draft.file.name}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      자동분류: {draft.parserCategory}
                    </p>
                    {draft.requiredCategory && (
                      <p className="mt-1 text-[10px] text-teal-700">
                        필수 목록 일치: {draft.requiredCategory}
                      </p>
                    )}
                    <div className="mt-2 space-y-1.5">
                      <div>
                        <label className="mb-1 block text-[10px] text-muted-foreground">권장 파일명</label>
                        <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-[10px] break-all">
                          {draft.suggestedFileName}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] text-muted-foreground">최종 업로드 파일명</label>
                        <input
                          type="text"
                          value={draft.reviewedFileName}
                          className="h-8 w-full rounded-md border bg-background px-2 text-[11px]"
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => onUpdateDraftFileName(draft.id, event.target.value)}
                        />
                        <div className="mt-1 flex justify-end">
                          <button
                            type="button"
                            className="text-[10px] text-teal-700 underline underline-offset-2"
                            onClick={(event) => {
                              event.stopPropagation();
                              onResetDraftFileName(draft.id);
                            }}
                          >
                            권장안 다시 적용
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="mb-1 block text-[10px] text-muted-foreground">문서 종류</label>
                      <input
                        list="evidence-document-categories"
                        value={draft.category}
                        className="h-8 w-full rounded-md border bg-background px-2 text-[11px]"
                        placeholder="목록에서 고르거나 직접 입력"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => onUpdateDraftCategory(draft.id, event.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <datalist id="evidence-document-categories">
          {EVIDENCE_DOCUMENT_CATEGORIES.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={onCancel} disabled={uploadingEvidence}>
            취소
          </Button>
          <Button onClick={onConfirm} disabled={uploadingEvidence || uploadDrafts.length === 0}>
            {uploadingEvidence ? '업로드 중...' : `선택한 ${uploadDrafts.length}건 업로드`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
