import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectEditorWizard.tsx'), 'utf8');
const adminWizardSource = readFileSync(resolve(import.meta.dirname, 'ProjectWizard.tsx'), 'utf8');
const portalRegisterSource = readFileSync(resolve(import.meta.dirname, '../portal/PortalProjectRegister.tsx'), 'utf8');
const contractDocumentPolicySource = readFileSync(resolve(import.meta.dirname, '../../platform/project-contract-document-policy.ts'), 'utf8');

describe('ProjectEditorWizard dropdown contract', () => {
  it('renders editor dropdowns from canonical option maps instead of surface-local labels', () => {
    expect(source).toContain('getProjectTypeSelectableOptions');
    expect(source).toContain('PROJECT_TYPE_LABELS[type]');
    expect(source).toContain('getProjectContractTypeSelectableOptions');
    expect(source).toContain('normalizeProjectContractType');
    expect(source).toContain('SETTLEMENT_TYPE_LABELS');
    expect(source).toContain('BASIS_LABELS');
    expect(source).toContain('ACCOUNT_TYPE_LABELS');
    expect(source).toContain('PROJECT_FUND_INPUT_MODE_LABELS');
    expect(source).toContain('PROJECT_CURRENCY_LABELS');
    expect(source).toContain('ContractDocumentPreview');
    expect(source).toContain('draft.contractDocument');
    expect(source).not.toContain('<Input value={draft.contractType}');
  });

  it('keeps select values representable in their option lists', () => {
    expect(source).toContain('const ownerOptions = useMemo');
    expect(source).toContain('const selectedOwner = useMemo');
    expect(source).toContain('const hasUnlinkedStoredOwner');
    expect(source).toContain('구성원 원장에서 선택');
    expect(source).not.toContain('<SelectItem value="none">선택 안 함</SelectItem>');
    expect(source).not.toContain('uid: draft.registeredById');
    expect(source).toContain("onSelect({ memberName: '', memberNickname: '' })");
    expect(source).toContain('currentTeamMemberOptionExists');
    expect(source).toContain('member.memberNickname ? `${member.memberName} (${member.memberNickname})` : member.memberName');
  });

  it('uses a member select for project owner instead of free text manager input', () => {
    expect(source).toContain('사업 담당자');
    expect(source).toContain('registeredById');
    expect(source).toContain('registeredByName: member.name || member.email || member.uid');
    expect(source).not.toContain('<Input value={draft.managerName}');
  });

  it('uses a searchable team member picker for registration and edit flows', () => {
    expect(source).toContain('function TeamMemberSearchCombobox');
    expect(source).toContain('<CommandInput placeholder="이름/닉네임으로 검색" />');
    expect(source).toContain('PROJECT_TEAM_MEMBER_OPTIONS.length}명 중 검색');
    expect(source).toContain('<TeamMemberSearchCombobox');
    expect(source).toContain("aria-label={selectedLabel ? `팀원 선택: ${selectedLabel}` : '팀원 검색'}");
    expect(source).toContain('selectedNames={selectedNames}');
    expect(source).toContain('이미 추가됨');
    expect(source).not.toContain("value={member.memberName || 'none'}");
  });

  it('allows manual team member identity entry when the picker is missing a member', () => {
    expect(source).toContain('팀원 검색');
    expect(source).toContain('직접 입력');
    expect(source).toContain('placeholder="이름(별명)"');
    expect(source).toContain('parseProjectTeamMemberIdentityInput');
    expect(source).toContain("inputMode: 'manual'");
  });

  it('uses project operations terminology and exposes currency selection', () => {
    expect(source).toContain('서류상 참여인력');
    expect(source).toContain("{ id: 'team', label: '팀/인력', icon: Users }");
    expect(source).not.toContain('<Label className="text-xs">팀원 구성</Label>');
    expect(source).toContain('<Label className="text-xs">통화</Label>');
    expect(source).toContain('PROJECT_CURRENCY_LABELS[draft.currency]');
  });

  it('receives department options instead of mapping hardcoded options directly in the wizard UI', () => {
    expect(source).toContain('departmentOptions?: string[]');
    expect(source).toContain('dedupeProjectDepartmentLabels(departmentOptions ? departmentOptions');
    expect(source).toContain('<Label className="text-xs">담당조직(CIC) *</Label>');
    expect(source).toContain('<SelectValue placeholder="담당조직 선택" />');
    expect(source).not.toContain('PROJECT_DEPARTMENT_OPTIONS.map((department)');
    expect(adminWizardSource).toContain('useProjectDepartmentSettings');
    expect(adminWizardSource).toContain('departmentOptions={departmentOptions}');
  });

  it('keeps manual team member input bound to the raw typed value instead of reparsing formatted text', () => {
    expect(source).toContain('formatTeamMemberIdentityInput(member)');
    expect(source).toContain('identityInput: event.target.value');
    expect(source).toContain('value={member.identityInput ?? formatTeamMemberIdentityInput(member)}');
  });

  it('does not key editable team member rows by typed member name', () => {
    expect(source).toContain("key={`team-member-${index}`}");
    expect(source).not.toContain("key={`${member.memberName || 'member'}-${index}`}");
  });

  it('keeps the team step focused on CIC and member assignments without duplicate organization fields', () => {
    expect(source).not.toContain('<Label className="text-xs">사내기업팀</Label>');
    expect(source).not.toContain("<Input value={draft.teamName}");
    expect(source).not.toContain('<Label className="text-xs">참여기업 조건</Label>');
    expect(source).not.toContain("<Input value={draft.participantCondition}");
    expect(source).not.toContain('<ReviewRow label="사내기업팀"');
    expect(source).not.toContain('<ReviewRow label="참여 조건"');
  });

  it('keeps team member add rows editable and aligns the add button with the primary next action', () => {
    const addTeamMemberBlock = source.slice(source.indexOf('const addTeamMember'), source.indexOf('const updateTeamMember'));

    expect(source).toContain('createProjectEditorWizardDraft');
    expect(source).toContain('normalizeProjectTeamMemberDraftRows');
    expect(addTeamMemberBlock).toContain('teamMembersDetailed: [...prev.teamMembersDetailed, createEmptyTeamMember()]');
    expect(addTeamMemberBlock).not.toContain('createProjectEditorDraft');
    expect(source).toContain('인건비 시작월');
    expect(source).toContain('인건비 종료월');
    expect(source).toContain('laborAllocationStartMonth');
    expect(source).toContain('laborAllocationEndMonth');
    expect(source).toContain('<Plus className="h-4 w-4" />');
    expect(source).toContain('<Button type="button" onClick={addTeamMember} className="gap-2">');
    expect(source).not.toContain('variant="outline" size="sm" onClick={addTeamMember}');
  });

  it('treats zero-won payment split values as explicit editable values', () => {
    expect(source).toContain('formatProjectAmountInput(draft.contractAmount, hasContractAmountInput)');
    expect(source).toContain('formatProjectAmountInput(draft.salesVatAmount, hasSalesVatAmountInput)');
    expect(source).toContain('formatProjectAmountInput(draft.totalRevenueAmount, hasTotalRevenueAmountInput)');
    expect(source).toContain('formatProjectAmountInput(draft.supportAmount, hasSupportAmountInput)');
    expect(source).toContain('formatProjectAmountInput(draft.budgetCurrentYear, draft.budgetCurrentYear > 0)');
    expect(source).toContain('formatProjectAmountInput(draft.taxInvoiceAmount, draft.taxInvoiceAmount > 0)');
    expect(source).toContain('formatProjectAmountInput(draft.paymentPlan.contract, true)');
    expect(source).toContain('formatProjectAmountInput(draft.paymentPlan.interim, true)');
    expect(source).toContain('formatProjectAmountInput(draft.paymentPlan.final, true)');
  });

  it('keeps portal edit drafts stable when async listener data refreshes', () => {
    expect(source).toContain('const lastResetKeyRef = useRef<string | null>(null)');
    expect(source).toContain("const resetKey = `${draftKey}::${autosave?.key || ''}`");
    expect(source).toContain('shouldResetProjectEditorDraft({');
    expect(source).toContain('lastPersistedFingerprint: lastPersistedFingerprintRef.current');
    expect(source).toContain('incomingFingerprint: initialDraftFingerprint');
    expect(source).not.toContain('lastInitialDraftFingerprintRef');
  });

  it('keeps project and groupware names separate without touching the team step', () => {
    expect(source).toContain('프로젝트명 *');
    expect(source).toContain("그룹웨어 등록명{usesRegistrationV2 ? ' *' : ''}");
    expect(source).toContain("{ id: 'team', label: '팀/인력', icon: Users }");
    expect(source).toContain("onChange={(event) => update('groupwareName', event.target.value)}");
    expect(source).not.toContain('const updateProjectName = (value: string)');
  });

  it('warns users to verify the uploaded contract before saving', () => {
    expect(source).toContain('등록하려는 계약서가 맞는지 꼭 확인해주세요!');
    expect(source).toContain('descriptionClassName="text-rose-600"');
    expect(source).not.toContain('업로드된 PDF를 마지막 확인 단계에서 바로 봅니다.');
  });

  it('supports contract PDF upload before saving registration or edit drafts', () => {
    expect(source).toContain('onContractFileUpload');
    expect(source).toContain('onProjectDocumentFileUpload');
    expect(source).toContain('handleProjectDocumentSelect');
    expect(source).toContain('PROJECT_REQUEST_DOCUMENT_UPLOAD_MAX_SIZE_BYTES');
    expect(source).toContain('PROJECT_REQUEST_DOCUMENT_UPLOAD_MAX_SIZE_LABEL');
    expect(source).toContain('mergeContractAnalysisIntoDraft');
    expect(source).toContain('contractAnalysisMergeMode');
    expect(source).toContain("contractAnalysisMergeMode === 'none'");
    expect(source).toContain('입력값은 자동으로 바꾸지 않습니다.');
    expect(source).toContain('`${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 업로드`');
    expect(source).toContain('`${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 교체`');
    expect(source).toContain('견적서 PDF');
    expect(source).toContain('제안서 PDF');
    expect(source).toContain('quoteDocument');
    expect(source).toContain('proposalDocument');
    expect(source).toContain('buildContractDocumentEditPolicy');
    expect(contractDocumentPolicySource).toContain('첨부 제거');
    expect(source).toContain('canRemoveContractDocument');
    expect(source).toContain('기존 계약서는 관리자 화면에서만 제거할 수 있습니다.');
    expect(contractDocumentPolicySource).toContain('교체 취소');
  });

  it('renders registration v2 requirements and completed-project checkout without a new route', () => {
    expect(portalRegisterSource).toContain('registrationRequirementsVersion: 2');
    expect(source).toContain("'customer_business_registration'");
    expect(source).toContain("'proposal_word_original'");
    expect(source).toContain("'proposal_ppt_original'");
    expect(source).toContain("'presentation_ppt_original'");
    expect(source).toContain("'rfp_request_evidence'");
    expect(source).toContain('미첨부 사유 / 해당 없음 *');
    expect(source).toContain('등록 첨부 7종');
    expect(source).toContain('발주처 사업자등록증 PDF');
    expect(source).toContain('연도별 계약·재무 *');
    expect(source).toContain('계약기간 전체 연도별 재무 확인');
    expect(source).toContain('4대보험 포함 확인');
    expect(source).toContain('퇴직급여 포함 확인');
    expect(source).toContain('모두싸인으로 계약했나요? *');
    expect(source).toContain('종료사업 체크아웃');
    expect(source).toContain("'performance_certificate'");
    expect(source).toContain("'tax_invoice'");
    expect(source).toContain("'final_settlement_report'");
    expect(source).toContain('evidenceDeletedAfterUsb');
    expect(source).toContain('SETTLEMENT_SYSTEM_LABELS');
    expect(source).toContain('LABOR_SETTLEMENT_BASIS_LABELS');
    expect(source).toContain('PROJECT_TEAM_MEMBER_ROLES');
    expect(source).toContain('paymentExpectedMonths');
    expect(source).toContain('선금·중도금 합계 70% 미만 사유 *');
    expect(source).toContain('최종 저장 후 사업관리 폴더가 자동 생성');
  });

  it('wires admin project editor to contract upload without automatic analysis merge', () => {
    expect(adminWizardSource).toContain('uploadProjectRequestContractFile');
    expect(adminWizardSource).not.toContain('uploadProjectRequestSupplementalDocumentFile');
    expect(adminWizardSource).toContain('handleContractFileUpload');
    expect(adminWizardSource).not.toContain('handleProjectDocumentFileUpload');
    expect(adminWizardSource).toContain('onContractFileUpload={handleContractFileUpload}');
    expect(adminWizardSource).not.toContain('onProjectDocumentFileUpload={handleProjectDocumentFileUpload}');
    expect(adminWizardSource).toContain('contractAnalysisMergeMode="none"');
    expect(adminWizardSource).toContain('canRemoveContractDocument');
  });

  it('shows supplemental project documents only when a BFF-backed upload callback exists', () => {
    expect(source).toContain('const registrationDocumentKinds = onProjectDocumentFileUpload');
    expect(source).toContain("REGISTRATION_DOCUMENT_KINDS.filter((kind) => kind === 'contract')");
    expect(source).toContain('const checkoutDocumentKinds = onProjectDocumentFileUpload ? CHECKOUT_DOCUMENT_KINDS : []');
    expect(source).toContain('registrationDocumentKinds.map((kind) => renderProjectDocumentUpload(kind))');
    expect(source).toContain('checkoutDocumentKinds.map((kind) => renderProjectDocumentUpload(kind))');
  });

  it('keeps private edit inputs read-only without disabling step navigation', () => {
    expect(source).toContain('readOnly?: boolean');
    expect(source).toContain('<fieldset disabled={readOnly} className="contents">');
    expect(source).toContain('disabled={readOnly || autosaveState');
    expect(source).toContain("disabled={readOnly || autosaveState === 'saving' || !!busyActionId");
    expect(source).toContain('shouldResetProjectEditorDraft({');
    expect(source).toContain('autosave?.onSave, draftKey, readOnly');
  });

  it('keeps failed attachment files retryable and clears the input only after success', () => {
    expect(source).toContain('retryDocumentFileRef');
    expect(source).toContain('processProjectDocument(kind, retryFile');
    expect(source).toContain('다시 시도`');
    expect(source).toContain('if (input) input.value =');
    expect(source).not.toContain('finally {\n      input.value =');
  });

  it('blocks unload and navigation while input, upload, a retry file, or an active edit session remains', () => {
    expect(source).not.toContain('usePortalNavigationGuard');
    expect(source).toContain('useBlocker(shouldConfirmExit)');
    expect(source).toContain("window.addEventListener('beforeunload'");
    expect(source).toContain('hasUnsavedInput || uploadInProgress || hasPendingRetryFile');
    expect(source).toContain('saveDraftAndRelease');
  });

  it('never double-submits or final-submits after the latest private draft save fails', () => {
    expect(source).toContain('if (submitInFlightRef.current) return');
    expect(source).toContain("throw new Error('최신 입력을 임시저장하지 못해 최종 저장을 중단했습니다.')");
    expect(source.indexOf('persistAutosaveSnapshot(draft, stepIndex)')).toBeLessThan(source.indexOf('await onSubmit(createProjectEditorDraft(draft), actionId)'));
  });

  it('does not offer a local-only attachment removal in private registration drafts', () => {
    expect(source).toContain('canRemoveProjectDocuments?: boolean');
    expect(source).toContain('const canRemove = canRemoveProjectDocuments &&');
    expect(portalRegisterSource).toContain('canRemoveProjectDocuments={false}');
    expect(source).toContain("privateDraftAttachment={mode === 'portal-register'");
  });
});

describe('ProjectEditorWizard safe exit contract', () => {
  it('offers continue, discard, and private-save choices before releasing the edit session', () => {
    expect(source).toContain('onLeave?: () => void | Promise<void>;');
    expect(source).toContain('수정 세션을 종료할까요?');
    expect(source).toContain('계속 작성');
    expect(source).toContain('저장하지 않고 종료');
    expect(source).toContain('임시저장 후 종료');
    expect(source).not.toContain('window.confirm');
    expect(source).toContain('await persistAutosaveSnapshot(draft, stepIndex)');
    expect(source).toContain('await onLeave?.();');
  });
});
