import { describe, expect, it } from 'vitest';
import type { FileAttachment } from '../data/types';
import {
  buildContractDocumentEditPolicy,
  isSameContractDocument,
} from './project-contract-document-policy';

const initialDocument: FileAttachment = {
  path: 'orgs/mysc/project-request-contracts/u-1/contract-a.pdf',
  name: 'contract-a.pdf',
  downloadURL: 'https://example.com/a.pdf',
  contentType: 'application/pdf',
  size: 1000,
  uploadedAt: '2026-05-27T00:00:00.000Z',
  uploadedBy: 'u-1',
};

const replacementDocument: FileAttachment = {
  ...initialDocument,
  path: 'orgs/mysc/project-request-contracts/u-1/contract-b.pdf',
  name: 'contract-b.pdf',
  downloadURL: 'https://example.com/b.pdf',
  uploadedAt: '2026-05-27T01:00:00.000Z',
};

describe('project-contract-document-policy', () => {
  it('compares persisted contract documents by stable storage identity', () => {
    expect(isSameContractDocument({ ...initialDocument }, initialDocument)).toBe(true);
    expect(isSameContractDocument(replacementDocument, initialDocument)).toBe(false);
    expect(isSameContractDocument(null, null)).toBe(true);
    expect(isSameContractDocument(undefined, null)).toBe(false);
  });

  it('locks an existing PM portal contract document against deletion', () => {
    const policy = buildContractDocumentEditPolicy({
      current: initialDocument,
      initial: initialDocument,
      canRemoveExistingContractDocument: false,
    });

    expect(policy.canRemoveCurrentContractDocument).toBe(false);
    expect(policy.isExistingContractDocumentLocked).toBe(true);
  });

  it('allows PM portal users to cancel a replacement without deleting the original document', () => {
    const policy = buildContractDocumentEditPolicy({
      current: replacementDocument,
      initial: initialDocument,
      canRemoveExistingContractDocument: false,
    });

    expect(policy.canRemoveCurrentContractDocument).toBe(true);
    expect(policy.isExistingContractDocumentLocked).toBe(false);
    expect(policy.removeButtonLabel).toBe('교체 취소');
  });

  it('allows admins to remove existing contract documents', () => {
    const policy = buildContractDocumentEditPolicy({
      current: initialDocument,
      initial: initialDocument,
      canRemoveExistingContractDocument: true,
    });

    expect(policy.canRemoveCurrentContractDocument).toBe(true);
    expect(policy.isExistingContractDocumentLocked).toBe(false);
    expect(policy.removeButtonLabel).toBe('첨부 제거');
  });
});
