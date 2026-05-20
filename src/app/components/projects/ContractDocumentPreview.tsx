import { ExternalLink, FileText } from 'lucide-react';
import type { FileAttachment } from '../../data/types';
import { Button } from '../ui/button';

type ContractDocumentPreviewAttachment = Pick<FileAttachment, 'name' | 'downloadURL' | 'contentType'>;

interface ContractDocumentPreviewProps {
  document?: ContractDocumentPreviewAttachment | null;
  title?: string;
  description?: string;
  descriptionClassName?: string;
  className?: string;
}

function isPdfDocument(document: ContractDocumentPreviewAttachment) {
  const contentType = String(document.contentType || '').toLowerCase();
  const fileName = String(document.name || '').toLowerCase();
  return contentType.includes('pdf') || fileName.endsWith('.pdf');
}

export function ContractDocumentPreview({
  document,
  title = '계약서 원문',
  description = '업로드된 PDF를 화면 안에서 바로 확인합니다.',
  descriptionClassName = 'text-slate-600',
  className = '',
}: ContractDocumentPreviewProps) {
  const downloadURL = String(document?.downloadURL || '').trim();
  const canPreviewPdf = !!document && !!downloadURL && isPdfDocument(document);

  return (
    <div className={`overflow-hidden rounded-3xl border border-slate-200 bg-white ${className}`} data-testid="contract-document-preview">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-950">{title}</p>
            <p className={`mt-1 text-[11px] leading-5 ${descriptionClassName}`}>{description}</p>
            {document?.name ? (
              <p className="mt-2 truncate text-[12px] font-medium text-slate-800">{document.name}</p>
            ) : null}
          </div>
        </div>
        {downloadURL ? (
          <Button asChild variant="outline" className="h-9 shrink-0 gap-1.5 rounded-full px-4 text-[12px]">
            <a href={downloadURL} target="_blank" rel="noreferrer">
              새 탭
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : null}
      </div>

      {canPreviewPdf ? (
        <iframe
          title={`${document.name || '계약서'} PDF 미리보기`}
          src={downloadURL}
          className="h-[min(72vh,760px)] min-h-[520px] w-full border-0 bg-slate-100"
          loading="lazy"
        />
      ) : (
        <div className="flex min-h-[220px] items-center justify-center bg-slate-50 px-5 py-8 text-center">
          <div>
            <p className="text-[13px] font-semibold text-slate-800">
              {downloadURL ? '이 파일 형식은 화면 미리보기를 지원하지 않습니다.' : '첨부된 계약서 파일이 없습니다.'}
            </p>
            <p className="mt-2 text-[12px] text-slate-500">
              {downloadURL ? '새 탭에서 원문 파일을 확인해 주세요.' : '계약서가 첨부되면 이 영역에 PDF 원문이 표시됩니다.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
