import { describe, expect, it } from 'vitest';
import { buildProjectPatchFromChangeRequestPayload } from '../../../../server/bff/routes/projects.mjs';
import { createProjectEditorDraft } from '../../platform/project-editor';
import type { Project } from '../../data/types';
import { projectCheckoutFileStatus } from './ProjectListPage';

describe('Project Check out behavior', () => {
  it('clears hidden settlement-only completion when a project has no settlement', () => {
    const draft = createProjectEditorDraft({
      registrationRequirementsVersion: 2,
      basis: 'NONE',
      checkout: {
        finalPaymentReceived: true,
        bankBalanceZero: true,
        performanceCertificateReceived: true,
        performanceCertificateDocumentApplicable: false,
        taxInvoiceEvidenceConfirmed: false,
        finalSettlementReportConfirmed: true,
        usbEvidenceSubmitted: true,
        evidenceDeletedAfterUsb: true,
      },
    });

    expect(draft.checkout).toMatchObject({
      finalPaymentReceived: true,
      finalSettlementReportConfirmed: false,
      usbEvidenceSubmitted: false,
      evidenceDeletedAfterUsb: false,
    });
  });

  it('shows an approved canonical upload as attached even when legacy applicability is false', () => {
    const document = { path: 'orgs/mysc/project-registration-documents/project-a/tax-invoices.pdf' };
    const canonical = buildProjectPatchFromChangeRequestPayload({
      registrationRequirementsVersion: 2,
      status: 'COMPLETED',
      settlementType: 'TYPE1',
      basis: '공급가액',
      checkout: {
        finalPaymentReceived: true,
        bankBalanceZero: true,
        performanceCertificateReceived: true,
        performanceCertificateDocumentApplicable: false,
        taxInvoiceEvidenceConfirmed: false,
        finalSettlementReportConfirmed: false,
        usbEvidenceSubmitted: false,
        evidenceDeletedAfterUsb: false,
      },
      taxInvoiceDocument: document,
    }, { id: 'project-a' }) as Project;

    expect(canonical.taxInvoiceDocument).toEqual(document);
    expect(projectCheckoutFileStatus(false, Boolean(canonical.taxInvoiceDocument?.path))).toBe('첨부 완료');
    expect(projectCheckoutFileStatus(true, false)).toBe('미첨부');
    expect(projectCheckoutFileStatus(false, false)).toBe('해당 없음');
  });
});
