import { useRef, useState } from 'react';
import { FileCheck2, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadPersonHrEvidenceViaBff } from '../../lib/project-request-attachment-client';
import type { ActorLike } from '../../lib/platform-bff-client';
import {
  createPersonProfessionalProfileClient,
  type ProfessionalProfileEvidenceRef,
} from '../../lib/person-professional-profile-client';
import { Button } from '../ui/button';

/**
 * 증빙 첨부 한 칸.
 *
 * 파일은 저장 버튼과 별개로 곧장 스토리지에 올라가고, 프로필에는 참조만 붙는다. 그래서
 * 올린 뒤 저장을 누르지 않으면 참조가 안 남는다 — 그 사실을 문구로 알린다.
 *
 * 증빙은 민감 개인정보라 미리보기 링크를 만들지 않는다. 볼 때마다 BFF 가 권한을 확인한다.
 */

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.heic,.docx';

function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function EvidenceAttachment({
  tenantId,
  actor,
  personId,
  label,
  evidence,
  disabled,
  readOnly,
  onChange,
}: {
  tenantId: string;
  actor: ActorLike;
  personId: string;
  label: string;
  evidence: ProfessionalProfileEvidenceRef | null | undefined;
  disabled: boolean;
  readOnly: boolean;
  onChange: (next: ProfessionalProfileEvidenceRef | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<'upload' | 'open' | null>(null);

  const upload = async (file: File) => {
    setBusy('upload');
    try {
      const client = createPersonProfessionalProfileClient({ tenantId, actor });
      const ref = await client.uploadEvidence(personId, file);
      onChange(ref);
      toast.success('증빙을 올렸습니다. 저장을 눌러야 인사정보에 붙습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '증빙을 올리지 못했습니다.');
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const open = async () => {
    if (!evidence?.path) return;
    setBusy('open');
    try {
      const { blob } = await downloadPersonHrEvidenceViaBff({
        tenantId, actor, personId, path: evidence.path,
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // 새 탭이 읽고 난 뒤 정리한다. 바로 해제하면 빈 탭이 뜬다.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error('증빙을 열지 못했습니다.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label={`${label} 증빙 파일 선택`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {evidence?.path ? (
        <>
          <Button
            type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]"
            disabled={busy !== null} onClick={() => void open()}
          >
            {busy === 'open' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileCheck2 className="h-3 w-3 text-emerald-600" />}
            {evidence.name || '증빙'}
            {evidence.size ? <span className="text-slate-400">{formatSize(evidence.size)}</span> : null}
          </Button>
          {!readOnly ? (
            <Button
              type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-slate-500"
              disabled={disabled || busy !== null} aria-label={`${label} 증빙 제거`}
              onClick={() => onChange(null)}
            >
              <Trash2 className="h-3 w-3" /> 증빙 제거
            </Button>
          ) : null}
        </>
      ) : readOnly ? (
        <span className="text-[11px] text-slate-400">증빙 없음</span>
      ) : (
        <Button
          type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]"
          disabled={disabled || busy !== null} onClick={() => inputRef.current?.click()}
        >
          {busy === 'upload' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
          {busy === 'upload' ? '올리는 중…' : '증빙 첨부'}
        </Button>
      )}
    </div>
  );
}
