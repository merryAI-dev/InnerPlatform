import type { FileAttachment } from '../data/types';

export interface ContractDocumentEditPolicy {
  canRemoveExistingContractDocument: boolean;
  isCurrentContractDocumentInitial: boolean;
  canRemoveCurrentContractDocument: boolean;
  isExistingContractDocumentLocked: boolean;
  removeButtonLabel: '첨부 제거' | '교체 취소';
}

export function isSameContractDocument(
  current: FileAttachment | null | undefined,
  initial: FileAttachment | null | undefined,
) {
  if (!current || !initial) return current === initial;
  return current.path === initial.path
    && current.downloadURL === initial.downloadURL
    && current.uploadedAt === initial.uploadedAt;
}

export function buildContractDocumentEditPolicy(params: {
  current: FileAttachment | null | undefined;
  initial: FileAttachment | null | undefined;
  canRemoveExistingContractDocument: boolean;
}): ContractDocumentEditPolicy {
  const isCurrentContractDocumentInitial = isSameContractDocument(params.current, params.initial);
  const canRemoveCurrentContractDocument = Boolean(
    params.current && (params.canRemoveExistingContractDocument || !isCurrentContractDocumentInitial),
  );
  const isExistingContractDocumentLocked = Boolean(
    params.current
      && params.initial
      && isCurrentContractDocumentInitial
      && !params.canRemoveExistingContractDocument,
  );

  return {
    canRemoveExistingContractDocument: params.canRemoveExistingContractDocument,
    isCurrentContractDocumentInitial,
    canRemoveCurrentContractDocument,
    isExistingContractDocumentLocked,
    removeButtonLabel: params.initial && !params.canRemoveExistingContractDocument ? '교체 취소' : '첨부 제거',
  };
}
