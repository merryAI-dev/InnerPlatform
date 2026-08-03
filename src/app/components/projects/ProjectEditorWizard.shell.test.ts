import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectEditorWizard.tsx'), 'utf8');
const adminWizardSource = readFileSync(resolve(import.meta.dirname, 'ProjectWizard.tsx'), 'utf8');
const portalRegisterSource = readFileSync(resolve(import.meta.dirname, '../portal/PortalProjectRegister.tsx'), 'utf8');
const portalEditSource = readFileSync(resolve(import.meta.dirname, '../portal/PortalProjectEdit.tsx'), 'utf8');
const contractDocumentPolicySource = readFileSync(resolve(import.meta.dirname, '../../platform/project-contract-document-policy.ts'), 'utf8');

describe('ProjectEditorWizard dropdown contract', () => {
  it('requires documents 1-2, allows document 3 to be deferred, and keeps documents 4-7 optional', () => {
    expect(source).toContain("label: '계약서 *'");
    expect(source).toContain("description: '계약서 써니(사업지원팀)에게 제출했습니다.'");
    expect(source).toContain("label: '고객사 사업자등록증 *'");
    expect(source).toContain("label: '산출내역서(견적서) *'");
    expect(source).toContain("label: '제안서(워드)'");
    expect(source).toContain("label: '제안서(PPT 원본)'");
    expect(source).toContain("label: '발표자료(PPT 원본)'");
    expect(source).toContain("label: 'RFP'");
    expect(source.match(/description: '있을 시'/g)).toHaveLength(3);
    expect(source).toContain("description: '없으면 사업요청사항을 확인할 수 있는 메일 본문 등 첨부'");
    expect(source).toContain("&& (draft.quoteDocument || draft.quoteSubmissionDeferred)");
    expect(source).toContain("mode === 'portal-register' && !hasRequiredRegistrationDocuments");
    expect(source).not.toContain("kinds: ['proposal', 'rfp_request_evidence']");
    expect(source).not.toContain('제안서와 RFP/요청 메일 중 하나만 남겨주세요.');
    expect(source).toContain('산출내역서(견적서) 이후 제출(예외 처리)');
    expect(source).toContain("!draft.quoteDocument && !draft.quoteSubmissionDeferred");
    expect(source).not.toContain("if (!draft.proposalWordOriginalDocument)");
  });

  it('lets the portal shell own the page title without rendering a duplicate editor header', () => {
    expect(source.match(/>\{title\}<\/h1>/g)).toHaveLength(1);
    expect(source).toContain('{embeddedInShell ? (');
    expect(source).toContain('<div className="flex justify-end">');
  });

  it('renders editor dropdowns from canonical option maps instead of surface-local labels', () => {
    expect(source).toContain('getProjectTypeSelectableOptions');
    expect(source).toContain('PROJECT_TYPE_LABELS[type]');
    expect(source).toContain('getProjectContractTypeSelectableOptions');
    expect(source).toContain('normalizeProjectContractType');
    expect(source).toContain('SETTLEMENT_TYPE_LABELS');
    expect(source).toContain('BASIS_LABELS');
    expect(source).toContain('ACCOUNT_TYPE_LABELS');
    expect(source).toContain('PROJECT_CURRENCY_LABELS');
    expect(source).toContain('ContractDocumentPreview');
    expect(source).toContain('draft.contractDocument');
    expect(source).not.toContain('<Input value={draft.contractType}');
  });

  it('uses the PPT settlement-system options and keeps a selected legacy value representable', () => {
    expect(source).toContain('PROJECT_SETTLEMENT_SYSTEM_CODES');
    expect(source).toContain('PROJECT_SETTLEMENT_SYSTEM_CODES.includes(draft.settlementSystem)');
    expect(source).toContain('[draft.settlementSystem]');
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

  it('lets project registration and edit choose a designated executive approver from the member directory', () => {
    expect(source).toContain('지정 결재자 *');
    expect(source).toContain('const selectedExecutiveApprover = useMemo');
    expect(source).toContain('const executiveApproverOptions = useMemo');
    expect(source).toContain('requesterId?: string');
    expect(source).toContain('member.uid !== draft.registeredById && member.uid !== requesterId');
    expect(portalRegisterSource).toContain('requesterId={actor.uid}');
    expect(source).toContain('requesterId, ownerOptions');
    expect(source).toContain('const isSelfExecutiveApprover = Boolean(');
    expect(source).toContain('사업 담당자와 지정 결재자는 달라야 합니다.');
  });

  it('offers only active members as project owners and designated executive approvers', () => {
    const ownerOptionsBlock = source.slice(
      source.indexOf('const ownerOptions = useMemo'),
      source.indexOf('const selectedOwner = useMemo'),
    );

    expect(ownerOptionsBlock).toContain("String(member.status || '').trim().toUpperCase() === 'ACTIVE'");
    expect(source).toContain('const executiveApproverOptions = useMemo');
    expect(source).toContain('requesterId, ownerOptions');
  });

  it('uses a searchable team member picker for registration and edit flows', () => {
    expect(source).toContain('function TeamMemberSearchCombobox');
    expect(source).toContain('<CommandInput placeholder="이름/닉네임으로 검색" />');
    expect(source).toContain('buildProjectTeamMemberOptions(members)');
    expect(source).toContain('options.length}명 중 검색');
    expect(source).toContain('options={availableTeamMemberOptions}');
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
    expect(source).toContain('참여인력 (서류상·실제)');
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
    expect(source).toContain('formatProjectAmountInput(paymentPlan.contract, true)');
    expect(source).toContain('formatProjectAmountInput(paymentPlan.interim, true)');
    expect(source).toContain('formatProjectAmountInput(paymentPlan.final, true)');
  });

  it('shows annual profit rates as derived values and keys v2 settlement details to the basis', () => {
    expect(source).toContain('연도별 계약금액과 총수익으로 자동 계산');
    expect(source).toContain('value={`${(row.profitRate * 100).toFixed(2)}%`}');
    expect(source).not.toContain("updateFinancialYear(\n                      index,\n                      'profitRate'");
    expect(source).toContain("const settlementDetailsEnabled = usesRegistrationV2 ? draft.basis !== 'NONE' : draft.settlementType !== 'NONE'");
    expect(source).toContain("requiresSettlementConfirmations ? (");
    expect(source).toContain('정산 기준이 정산없음이면 통장·정산 시스템 입력이 필요하지 않습니다.');
  });

  it('renders the PPT v2 business-type and settlement-basis options without removed values', () => {
    expect(source).toContain("usesRegistrationV2 ? '사업유형' : '정산 유형'");
    expect(source).toContain("usesRegistrationV2 && draft.settlementType === 'NONE' ? undefined : draft.settlementType");
    expect(source).toContain(".filter(([key]) => !usesRegistrationV2 || key !== 'NONE')");
    expect(source).toContain(".filter(([key]) => usesRegistrationV2 ? key !== '기타' : key !== 'NONE')");
    expect(source).toContain("if (draft.settlementType === 'NONE') issues.push({ step: 'financial', label: '사업유형' })");
    expect(source).toContain("value={REGISTRATION_V2_BASIS_LABELS[draft.basis as Exclude<Basis, '기타'>]}");
  });

  it('balances the desktop review grid without changing the DOM reading order', () => {
    expect(source).not.toContain('className="contents lg:block lg:space-y-4"');
    expect(source).toContain('<Card className="shadow-none lg:col-start-1 lg:row-start-1 lg:self-start">');
    expect(source).toContain('<Card className="shadow-none lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">');
    expect(source).toContain('<Card className="shadow-none lg:col-start-1 lg:row-start-2 lg:self-start">');
    expect(source).toContain('<Card className="shadow-none lg:col-start-1 lg:row-start-3 lg:self-start">');

    const basicIndex = source.indexOf('>기본 정보</CardTitle>');
    const financialIndex = source.indexOf('>계약/재무</CardTitle>');
    const teamIndex = source.indexOf('>팀/인력</CardTitle>');
    const paymentIndex = source.indexOf('>입금/정산</CardTitle>');
    expect(basicIndex).toBeGreaterThan(-1);
    expect(basicIndex).toBeLessThan(financialIndex);
    expect(financialIndex).toBeLessThan(teamIndex);
    expect(paymentIndex).toBe(-1);
  });

  it('keeps portal edit drafts stable when async listener data refreshes', () => {
    expect(source).toContain('const lastResetKeyRef = useRef<string | null>(null)');
    expect(source).toContain("const resetKey = `${draftKey}::${autosave?.key || ''}`");
    expect(source).toContain('shouldResetProjectEditorDraft({');
    expect(source).toContain('lastPersistedFingerprint: lastPersistedFingerprintRef.current');
    expect(source).toContain('incomingFingerprint: initialDraftFingerprint');
    expect(source).not.toContain('lastInitialDraftFingerprintRef');
  });

  it('upgrades restored portal autosaves to the registration-v2 contract', () => {
    expect(source).toContain('function normalizeRestoredProjectEditorDraft');
    expect(source).toContain("mode === 'portal-register' || mode === 'portal-edit'");
    expect(source).toContain('registrationRequirementsVersion: 2');
    expect(source).toContain('normalizeRestoredProjectEditorDraft(restoreCandidate.draft, mode)');
  });

  it('uses the project name as the single PPT registration name', () => {
    expect(source).toContain('프로젝트명 *');
    expect(source).not.toContain('그룹웨어 등록명');
    expect(source).toContain('계약서에 기재된 계약명 그대로 입력');
    expect(source).toContain('띄어쓰기를 포함해 계약서 표기와 동일하게 입력해 주세요.');
    expect(source).toContain('예: 26농식품AC');
    expect(source).not.toContain('maxLength=');
    expect(source).not.toContain('프로젝트명 10자 이하');
    expect(source).not.toContain('/10자');
    expect(source).not.toContain("event.target.value.slice(0, mode === 'portal-register' ? 10 : 80)");
    expect(source).toContain('계약연도+프로젝트명 형식으로 입력해 주세요.');
    expect(source).toContain('재경팀이 부여하는 프로젝트 코드는 직접 입력하지 않습니다.');
    expect(source).toContain('다년도 사업은 같은 프로젝트명을 사용해 주세요.');
    expect(source).toContain('사업자등록증상 법인명을 띄어쓰기까지 동일하게 입력해 주세요.');
    expect(source).toContain('어떤 대상에게 어떤 가치를 제공하는 프로젝트인지 입력');
    expect(source).toContain('CJ푸드빌 새로운 점포를 만들어갈 사내기업가 육성');
    expect(source).toContain('프로젝트 주요 수행 내용');
    expect(source).toContain('1. 사업제안서 작성 교육');
    expect(source).toContain('2. 사업제안서 작성 - 25개팀 이상 1:1 코칭');
    expect(source).toContain('3. 선정된 10개 팀 사업제안 구체화 1:1 컨설팅');
    expect(source).toContain("{ id: 'team', label: '팀/인력', icon: Users }");
    expect(source).not.toContain('const updateProjectName = (value: string)');
  });

  it('shows persistent guidance below the purpose and main-content labels', () => {
    const purposeField = source.slice(
      source.indexOf('<Label className="text-xs">프로젝트 목적'),
      source.indexOf('<Label className="text-xs">프로젝트 주요 내용'),
    );
    const mainContentField = source.slice(
      source.indexOf('<Label className="text-xs">프로젝트 주요 내용'),
      source.indexOf('const renderContractTypeSelect'),
    );

    expect(purposeField.indexOf('어떤 대상에게 어떤 가치를 제공하는 프로젝트인지 입력')).toBeLessThan(
      purposeField.indexOf('<Textarea'),
    );
    expect(purposeField).toContain('<p className="mt-1 text-[11px] leading-5 text-muted-foreground">');
    expect(purposeField).toContain('예: CJ푸드빌 새로운 점포를 만들어갈 사내기업가 육성');
    expect(mainContentField.indexOf('프로젝트 주요 수행 내용, 범위, 산출물 등 프로그램 핵심 내용 요약')).toBeLessThan(
      mainContentField.indexOf('<Textarea'),
    );
    expect(mainContentField).toContain('<p className="mt-1 text-[11px] leading-5 text-muted-foreground">');
    expect(mainContentField).toContain('<span className="block">1. 사업제안서 작성 교육</span>');
    expect(mainContentField).toContain('<span className="block">2. 사업제안서 작성 - 25개팀 이상 1:1 코칭</span>');
    expect(mainContentField).toContain('<span className="block">3. 선정된 10개 팀 사업제안 구체화 1:1 컨설팅</span>');
    expect(purposeField).not.toContain('placeholder=');
    expect(mainContentField).not.toContain('placeholder=');
    expect(portalRegisterSource).toContain('<ProjectEditorWizard');
    expect(portalEditSource).toContain('<ProjectEditorWizard');
  });

  it('uses the PPT financial total labels in both entry and review surfaces', () => {
    expect(source).toContain('총매출부가세');
    expect(source).toContain('총지원금');
    expect(source).toContain('총수익률');
    expect(source).not.toContain('label="매출 부가세"');
    expect(source).not.toContain('label="지원금"');
    expect(source).not.toContain('label="수익률"');
  });

  it('keeps the PPT five-step navigation horizontal on desktop and stacked on mobile', () => {
    expect(source).toContain('lg:grid-cols-5');
    expect(source).toContain('grid gap-1.5 lg:grid-cols-5');
    expect(source).not.toContain('lg:grid-cols-[220px_minmax(0,1fr)]');
  });

  it('warns users to verify the uploaded contract before saving', () => {
    expect(source).toContain('등록하려는 계약서가 맞는지 꼭 확인해주세요!');
    expect(source).toContain('descriptionClassName="text-rose-600"');
    expect(source).not.toContain('업로드된 PDF를 마지막 확인 단계에서 바로 봅니다.');
    expect(source).toContain('documentPreviewUrls?: Partial<Record<ProjectRequestDocumentKind, string>>');
    expect(source).toContain('documentPreviewStates?: Partial<Record<ProjectRequestDocumentKind');
    expect(source).toContain('onLoadDocumentPreview?: (kind: ProjectRequestDocumentKind)');
    expect(source).toContain('documentPreviewUrls?.[kind] || document.downloadURL');
    expect(source).toContain('원문 불러오기');
    expect(source).toContain('원문 다시 불러오기');
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
    expect(source).toContain('산출내역서(견적서) PDF');
    expect(source).toContain('제안서 PDF');
    expect(source).toContain('quoteDocument');
    expect(source).toContain('proposalDocument');
    expect(source).toContain('buildContractDocumentEditPolicy');
    expect(contractDocumentPolicySource).toContain('첨부 제거');
    expect(source).toContain('canRemoveContractDocument');
    expect(source).toContain('기존 계약서는 관리자 화면에서만 제거할 수 있습니다.');
    expect(contractDocumentPolicySource).toContain('교체 취소');
  });

  it('keeps the PPT registration attachment contract and completed-project checkout without a new route', () => {
    expect(portalRegisterSource).toContain('registrationRequirementsVersion: 2');
    expect(source).toContain("'customer_business_registration'");
    expect(source).toContain("'proposal'");
    expect(source).toContain("'rfp_request_evidence'");
    expect(source).toContain("'proposal_word_original'");
    expect(source).toContain("'proposal_ppt_original'");
    expect(source).toContain("'presentation_ppt_original'");
    expect(source).toContain('등록 제출서류 7종');
    expect(source).toContain('stacked');
    expect(source).toContain("className=\"grid gap-1.5 text-left\"");
    expect(source).toContain('1~2번은 필수, 3번은 첨부 또는 이후 제출');
    expect(source).toContain('등록 제출서류');
    expect(source).toContain("if (draft.settlementType === 'NONE') issues.push({ step: 'financial', label: '사업유형' })");
    expect(source).toContain('고객사 사업자등록증 PDF');
    expect(source).toContain('계약 종료일은 시작일 이후여야 합니다.');
    expect(source).toContain('인건비 투입 종료월은 시작월 이후여야 합니다.');
    expect(source).toContain('실제 투입 운영 매니저 1인 이상');
    expect(source).toContain("const requiresSettlementConfirmations = usesRegistrationV2 ? draft.basis !== 'NONE' : draft.settlementType !== 'NONE'");
    expect(source).not.toContain('정산 기준이 정산없음인 사업은 인건비·고객사 정산 확인을 입력하지 않습니다.');
    expect(source).toContain('md:grid-cols-2 xl:grid-cols-4');
    expect(source).not.toContain('xl:grid-cols-[132px_minmax(0,1.4fr)_minmax(0,1fr)_110px_120px_140px_140px]');
    expect(source).not.toContain('alternativeDocumentAttached');
    expect(source).not.toContain('특이사항 (메모란)');
    expect(source).not.toContain('lg:sticky lg:bottom-4');
    expect(source).not.toContain('발주처');
    expect(source).toMatch(/number: 4,\s+label: '제안서\(워드\)'/);
    expect(source).toMatch(/number: 5,\s+label: '제안서\(PPT 원본\)'/);
    expect(source).toMatch(/number: 6,\s+label: '발표자료\(PPT 원본\)'/);
    expect(source).toMatch(/number: 7,\s+label: 'RFP'/);
    expect(source).toContain('연도별 계약·재무 *');
    expect(source).toContain('계약기간 전체 연도별 재무 확인');
    expect(source).not.toContain('4대보험 포함 확인');
    expect(source).not.toContain('퇴직급여 포함 확인');
    expect(source).not.toContain('모두싸인으로 계약했나요? *');
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

  it('merges payment fields into the contract-finance step and removes retired registration fields', () => {
    expect(source).not.toContain("{ id: 'payment', label: '입금/정산'");
    expect(source).not.toContain("if (step.id === 'payment')");
    expect(source).toContain('renderPaymentFields(row, index)');
    expect(source).toContain('!hasMultiYearContract ? renderPaymentFields() : null');
    expect(source).not.toContain('최종 입금 메모');
    expect(source).not.toContain('기타 참고사항');
    expect(source).not.toContain('등록 전 확인사항');
    expect(source).not.toContain('renderRegistrationConfirmations');
    expect(source).not.toContain("issues.push({ step: 'payment'");
    expect(source).toContain('총실비(원가)');
    expect(source).toContain('ACCOUNT_TYPE_LABELS');
    expect(source).toContain('INTEREST_REFUND_POLICY_LABELS');
    expect(source).toContain('최종 입금 재무주차');
    expect(source).toContain('placeholder="예: 26-8-1"');
    expect(source).toContain('const effectivePaymentPlan = hasMultiYearContract');
    expect(source).toContain('total.contract + (row.paymentPlan?.contract || 0)');
    expect(source).toContain('년 선금·중도금 합계 70% 미만 사유 *');
    expect(source).toContain("updateFinancialYear(financialYearIndex!, 'advanceInterimBelow70Reason'");
    expect(source).toContain("updateFinancialYear(financialYearIndex!, 'isSettled'");
    expect(source).toContain('(기존값 · 선택 불가)');
    expect(source).toContain('disabled>{member.role}');
    expect(source).toContain('최종 입금 주차 ${row.finalPaymentExpectedWeek || \'-\'}');
    expect(source).toContain('disabled={!financeWeekYear}');
    expect(source).toContain('계약 종료일을 입력하면 재무주차를 선택할 수 있습니다.');
    expect(source).not.toContain('입금계획');
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
    expect(source).toContain('if (onProjectDocumentFileUpload) {');
    expect(source).toContain('registrationDocumentKinds.map((kind) => renderProjectDocumentUpload(kind))');
    expect(source).toContain('checkoutDocumentKinds.map((kind) => renderProjectDocumentUpload(kind))');
  });

  it('keeps private edit inputs read-only without disabling step navigation', () => {
    expect(source).toContain('readOnly?: boolean');
    expect(source).toContain('<fieldset disabled={readOnly} className="contents">');
    expect(source).toContain('disabled={readOnly || autosaveState');
    expect(source).toContain("disabled={readOnly || autosaveState === 'saving' || uploadInProgress || hasPendingRetryFile || !!busyActionId");
    expect(source).toContain('shouldResetProjectEditorDraft({');
    expect(source).toContain('autosave?.onSave, draftKey, hasPendingRetryFile, hasRequiredRegistrationDocuments, mode, readOnly, uploadInProgress');
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

  it('never saves or submits a stale snapshot while an attachment mutation is in flight', () => {
    expect(source).toContain('if (uploadInProgress || hasPendingRetryFile) return false;');
    expect(source).toContain("toast.error('첨부파일 처리를 완료한 뒤 임시저장해 주세요.')");
    expect(source).toContain("toast.error('첨부파일 처리를 완료한 뒤 최종 저장해 주세요.')");
    expect(source).toContain("disabled={readOnly || autosaveState === 'saving' || uploadInProgress || hasPendingRetryFile || (mode === 'portal-register' && !hasRequiredRegistrationDocuments)}");
    expect(source).toContain("disabled={readOnly || autosaveState === 'saving' || uploadInProgress || hasPendingRetryFile || !!busyActionId || action.disabled || !canSubmit}");
  });

  it('removes private registration attachments through the owner-authorized draft API before clearing local state', () => {
    expect(source).toContain('canRemoveProjectDocuments?: boolean');
    expect(source).toContain('onRemoveProjectDocument?: (kind: ProjectRequestDocumentKind) => void | Promise<void>;');
    expect(source).toContain('const canRemove = canRemoveProjectDocuments &&');
    expect(source).toContain('await onRemoveProjectDocument?.(kind)');
    expect(portalRegisterSource).toContain('canRemoveProjectDocuments');
    expect(portalRegisterSource).toContain('onRemoveProjectDocument={removeDocument}');
    expect(portalRegisterSource).toContain('draftClient.removeAttachment(record.draftId, ownership');
    expect(source).toContain('privateDraftAttachment={Boolean(documentPreviewStates?.contract)');
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
