import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectEditorWizard.tsx'), 'utf8');
const adminWizardSource = readFileSync(resolve(import.meta.dirname, 'ProjectWizard.tsx'), 'utf8');
const portalRegisterSource = readFileSync(resolve(import.meta.dirname, '../portal/PortalProjectRegister.tsx'), 'utf8');
const portalEditSource = readFileSync(resolve(import.meta.dirname, '../portal/PortalProjectEdit.tsx'), 'utf8');
const contractDocumentPolicySource = readFileSync(resolve(import.meta.dirname, '../../platform/project-contract-document-policy.ts'), 'utf8');

describe('ProjectEditorWizard dropdown contract', () => {
  it('lists the seven registration documents as one table and keeps every per-slot detail', () => {
    // 표 머리글은 이제 FORM_LABEL_CLASS(12/600) 토큰을 쓴다. 흩어진 font-medium/text-[11px]
    // 대신 라벨 역할 하나만 남기려고 바꿨고, 열 구성과 의미는 그대로다.
    expect(source).toContain('<th scope="col" className={cn(\'w-10 px-3 py-2\', FORM_LABEL_CLASS)}>#</th>');
    expect(source).toContain('첨부 상태');
    // Stacked cards hid whether a slot was still missing; each row now states it.
    expect(source).toContain("deferred ? '이후 제출(예외 처리)' : '미첨부'");
    expect(source).toContain('const unmet = isLinkSlot ? false');
    // Details that only existed inside the old card must survive in the row below.
    expect(source).toContain('const hasDetail = Boolean(uploadError || previewError || contractLocked || contractSummary)');
    expect(source).toContain('분석 요약');
    expect(source).toContain('기존 계약서는 관리자 화면에서만 제거할 수 있습니다.');
  });

  it('lets an upload in flight be cancelled and takes back one that already landed', () => {
    expect(source).toContain('const cancelProjectDocumentUpload');
    expect(source).toContain('업로드 취소');
    expect(source).toContain('documentUploadRunRef');
    // The request cannot be recalled, so a late success is undone rather than left behind.
    expect(source).toContain('if (documentUploadRunRef.current[kind] !== runId) {');
    expect(source).toContain('await onRemoveProjectDocument?.(kind);');
  });

  it('requires documents 1-2, allows document 3 to be deferred, and keeps documents 4-7 optional', () => {
    expect(source).toContain("label: '계약서 *'");
    // 필수 표시는 라벨 문자열에 붙이던 ' *' 대신 ProjectFormRow 의 required 프로퍼티가 맡는다.
    // 마커를 한 군데(강조색 `*`)에서만 그리기 위한 변경이고, 어떤 항목이 필수인지는 그대로다.
    expect(source).toContain('label="모두 싸인으로 진행하셨나요?"');
    expect(source).toContain('계약서를 써니(사업지원팀)에게 제출했습니다.');
    expect(source).toContain("label: '고객사 사업자등록증 *'");
    expect(source).toContain("label: '산출내역서(견적서) *'");
    expect(source).toContain("label: '제안서(워드)'");
    expect(source).toContain("label: '제안서(구글드라이브 링크)'");
    expect(source).toContain("label: '발표자료(구글드라이브 링크)'");
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
    // The stored value is offered back explicitly, labelled, so it is never silently lost.
    expect(source).toContain('withSavedOrgMemberOption(ledgerMemberOptions');
    expect(source).toContain('· 기존 선택');
    // Linkage is still judged against the ledger, so the unlinked warning keeps firing.
    expect(source).toContain('ledgerMemberOptions.find((member) => member.uid === draft.registeredById)');
    expect(source).toContain("onSelect({ memberName: '', memberNickname: '' })");
    expect(source).toContain('currentTeamMemberOptionExists');
    expect(source).toContain('member.memberNickname ? `${member.memberName} (${member.memberNickname})` : member.memberName');
  });

  it('uses a member select for project owner instead of free text manager input', () => {
    expect(source).toContain('사업 담당자');
    expect(source).toContain('registeredById');
    expect(source).toContain('registeredByName: member.label.replace(');
    expect(source).not.toContain('<Input value={draft.managerName}');
  });

  it('lets project registration and edit choose a designated executive approver from the member directory', () => {
    expect(source).toContain('label="최종 결재자 지정 (사업총괄)"');
    expect(source).toContain('const selectedExecutiveApprover = useMemo');
    expect(source).toContain('const executiveApproverOptions = useMemo');
    expect(source).not.toContain('requesterId?: string');
    expect(portalRegisterSource).not.toContain('requesterId={actor.uid}');
    expect(source).not.toContain('member.uid !== draft.registeredById && member.uid !== requesterId');
    expect(source).not.toContain('const isSelfExecutiveApprover = Boolean(');
    expect(source).not.toContain('사업 담당자와 최종 결재자는 달라야 합니다.');
  });

  it('drops only members marked inactive, so members without a status still appear', () => {
    // Requiring status to equal ACTIVE hid the 15 members whose document carries no status
    // field at all, which is what QA reported as missing people.
    const optionsSource = readFileSync(
      resolve(import.meta.dirname, '../../data/project-team-member-options.ts'),
      'utf8',
    );
    expect(optionsSource).toContain("if (status === 'INACTIVE' || status === 'DELETED') return;");
    expect(optionsSource).not.toContain("=== 'ACTIVE'");
    expect(source).toContain('buildOrgMemberPickerOptions(members)');
    expect(source).toContain('const executiveApproverOptions = useMemo');
  });

  it('uses a searchable team member picker for registration and edit flows', () => {
    expect(source).toContain('function TeamMemberSearchCombobox');
    expect(source).toContain('<CommandInput placeholder="이름/닉네임으로 검색" />');
    // 후보의 출처는 계정 원장(members)이고, roster 는 계정 목록이 비었을 때의 안전망이다.
    // 포털 등록 화면은 members 가 [] 로 시작하므로 roster 가 빠지면 팀원을 아예 못 고른다.
    expect(source).toContain('buildProjectTeamMemberOptions(members, roster)');
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
    // 라벨은 이제 ProjectFormRow 의 라벨 열이 그린다. 개별 <Label className="text-xs"> 는 사라졌다.
    expect(source).toContain('<ProjectFormRow label="통화">');
    expect(source).toContain('PROJECT_CURRENCY_LABELS[draft.currency]');
  });

  it('receives department options instead of mapping hardcoded options directly in the wizard UI', () => {
    expect(source).toContain('departmentOptions?: string[]');
    expect(source).toContain('dedupeProjectDepartmentLabels(departmentOptions ? departmentOptions');
    expect(source).toContain('<ProjectFormRow label="담당조직(CIC)" required');
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
    expect(source).not.toContain('<Label className="text-xs">인건비 시작월</Label>');
    expect(source).not.toContain('<Label className="text-xs">인건비 종료월</Label>');
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
    // 선금·중도금·잔금은 표의 세 행이 되어 같은 셀 코드를 돈다. 세 필드 모두 0원을 명시값으로
    // 다룬다는 계약(두 번째 인자 true)은 그대로다.
    expect(source).toContain("['contract', '선금/계약금'");
    expect(source).toContain("['interim', '중도금'");
    expect(source).toContain("['final', '잔금'");
    expect(source).toContain('formatProjectAmountInput(paymentPlan[field], true)');
  });

  it('shows annual profit rates as derived values and keys v2 settlement details to the basis', () => {
    // 연도별 수익률은 입력칸 모양을 벗고 표의 파생값 칸으로 바뀌었다. "자동 계산" 도움말을
    // 연도마다 반복하던 줄은 형태(입력칸 없음)가 대신하므로 지웠다.
    expect(source).toContain('{`${(row.profitRate * 100).toFixed(2)}%`}');
    expect(source).not.toContain('연도별 계약금액과 총수익으로 자동 계산');
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
    expect(source).toContain('label="프로젝트명"');
    expect(source).not.toContain('그룹웨어 등록명');
    expect(source).toContain('계약서에 기재된 계약명 그대로 입력');
    expect(source).toContain('띄어쓰기를 포함해 계약서 표기와 동일하게 입력해 주세요.');
    expect(source).toContain('예: 26농식품AC');
    expect(source).not.toContain('maxLength=');
    expect(source).not.toContain('프로젝트명 10자 이하');
    expect(source).not.toContain('/10자');
    expect(source).not.toContain("event.target.value.slice(0, mode === 'portal-register' ? 10 : 80)");
    expect(source).toContain('계약연도+프로젝트명 형식으로 입력해 주세요.');
    expect(source).toContain('다년도 사업은 같은 연도만 변경된 동일 프로젝트명을 사용해주세요.(재경팀이 부여하는 A_, C_와 같은 코드는 기입하지 않습니다)');
    expect(source).not.toContain('재경팀이 부여하는 프로젝트 코드는 직접 입력하지 않습니다.');
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

  /**
   * 도움말 자리가 라벨 아래에서 "입력 아래 `·` 불릿"으로 옮겨졌다.
   * 예전에는 필드마다 도움말이 위/아래로 흩어져 있었고, 이제 ProjectFormRow 의 hints 한 곳만
   * 쓴다. 문구는 한 글자도 지우지 않았고 순서(설명 → 예시)도 그대로다.
   */
  it('keeps the purpose and main-content guidance in the one shared hint slot', () => {
    const purposeField = source.slice(
      source.indexOf('label="프로젝트 목적"'),
      source.indexOf('label="프로젝트 주요 내용"'),
    );
    const mainContentField = source.slice(
      source.indexOf('label="프로젝트 주요 내용"'),
      source.indexOf('const renderContractTypeSelect'),
    );

    expect(purposeField.indexOf('어떤 대상에게 어떤 가치를 제공하는 프로젝트인지 입력')).toBeLessThan(
      purposeField.indexOf('예: CJ푸드빌 새로운 점포를 만들어갈 사내기업가 육성'),
    );
    expect(purposeField).toContain('hints={[');
    expect(purposeField).toContain('예: CJ푸드빌 새로운 점포를 만들어갈 사내기업가 육성');
    expect(mainContentField.indexOf('프로젝트 주요 수행 내용, 범위, 산출물 등 프로그램 핵심 내용 요약')).toBeLessThan(
      mainContentField.indexOf('1. 사업제안서 작성 교육'),
    );
    expect(mainContentField).toContain('hints={[');
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

  it('keeps the step navigation horizontal on desktop and stacked on mobile', () => {
    // 단계는 4개인데 칸이 5개라 마지막 한 칸이 늘 비어 있었다. 칸 수를 단계 수에 맞추고
    // 간격도 세 값 규칙(8px)으로 통일했다.
    expect(source).toContain('grid gap-2 lg:grid-cols-4');
    expect(source).not.toContain('grid gap-1.5 lg:grid-cols-5');
    expect(source).not.toContain('lg:grid-cols-[220px_minmax(0,1fr)]');
  });

  it('warns users to verify the uploaded contract before saving', () => {
    expect(source).toContain('등록하려는 계약서가 맞는지 꼭 확인해주세요!');
    // rose 와 red 가 같은 "주의" 뜻으로 섞여 쓰이고 있었다. 색 하나에 뜻 하나만 두려고
    // 오류·주의는 red 로 모았다.
    expect(source).toContain('descriptionClassName="text-red-700"');
    expect(source).not.toContain('rose-');
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
    expect(source).not.toContain('인건비 투입 종료월은 시작월 이후여야 합니다.');
    expect(source).toContain('운영매니저 1인 이상');
    expect(source).toContain("const requiresSettlementConfirmations = usesRegistrationV2 ? draft.basis !== 'NONE' : draft.settlementType !== 'NONE'");
    expect(source).not.toContain('정산 기준이 정산없음인 사업은 인건비·고객사 정산 확인을 입력하지 않습니다.');
    expect(source).toContain('md:grid-cols-3');
    expect(source).not.toContain('xl:grid-cols-[132px_minmax(0,1.4fr)_minmax(0,1fr)_110px_120px_140px_140px]');
    expect(source).not.toContain('alternativeDocumentAttached');
    expect(source).not.toContain('특이사항 (메모란)');
    expect(source).not.toContain('lg:sticky lg:bottom-4');
    expect(source).not.toContain('발주처');
    expect(source).toMatch(/number: 4,\s+label: '제안서\(워드\)'/);
    expect(source).toMatch(/number: 5,\s+label: '제안서\(구글드라이브 링크\)'/);
    expect(source).toMatch(/number: 6,\s+label: '발표자료\(구글드라이브 링크\)'/);
    expect(source).toContain('{usesRegistrationV2 ? (');
    // The seven slots render as one table instead of stacked cards.
    expect(source).toContain('renderRegistrationDocumentTable');
    expect(source).toContain('{slot.description}');
    expect(source).toContain('isValidDriveUrl(draft.registrationConfirmations.proposalPptOriginal)');
    expect(source).toMatch(/number: 7,\s+label: 'RFP'/);
    expect(source).toContain('title="연도별 계약·재무"');
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
    expect(source).toContain('label="선금·중도금 합계 70% 미만 사유"');
    expect(source).toContain('최종 저장 후 사업관리 폴더가 자동 생성');
  });

  it('merges payment fields into the contract-finance step and removes retired registration fields', () => {
    expect(source).not.toContain("{ id: 'payment', label: '입금/정산'");
    expect(source).not.toContain("if (step.id === 'payment')");
    expect(source).toContain('renderPaymentFields(row, index)');
    // 단년 계약의 입금 계획도 다른 묶음과 같은 섹션 껍데기를 쓴다. 렌더 조건은 그대로다.
    expect(source).toContain('{!hasMultiYearContract ? (');
    expect(source).toContain('<ProjectFormSection title="입금 계획">');
    expect(source).not.toContain('최종 입금 메모');
    expect(source).not.toContain('기타 참고사항');
    expect(source).not.toContain('등록 전 확인사항');
    expect(source).not.toContain('renderRegistrationConfirmations');
    expect(source).not.toContain("issues.push({ step: 'payment'");
    expect(source).toContain('총실비(원가)');
    expect(source).toContain('ACCOUNT_TYPE_LABELS');
    expect(source).toContain('INTEREST_REFUND_POLICY_LABELS');
    expect(source).not.toContain('최종 입금 재무주차');
    expect(source).not.toContain('placeholder="예: 26-8-1"');
    expect(source).toContain('const effectivePaymentPlan = hasMultiYearContract');
    expect(source).toContain('total.contract + (row.paymentPlan?.contract || 0)');
    expect(source).toContain('년 선금·중도금 합계 70% 미만 사유`}');
    expect(source).toContain("updateFinancialYear(financialYearIndex!, 'advanceInterimBelow70Reason'");
    expect(source).not.toContain('년 계약/재무 정산 완료');
    expect(source).toContain('(기존값 · 선택 불가)');
    expect(source).toContain('disabled>{member.role}');
    expect(source).not.toContain('최종 입금 주차 ${row.finalPaymentExpectedWeek || \'-\'}');
    expect(source).not.toContain('disabled={!financeWeekYear}');
    expect(source).not.toContain('계약 종료일을 입력하면 재무주차를 선택할 수 있습니다.');
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
    expect(source).toContain('disabled={readOnly || !!busyActionId || action.disabled}');
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
    expect(source).toContain("toast.error('첨부파일 처리를 완료한 뒤 최종 저장해 주세요.')");
  });

  it('keeps the final save button pressable and explains every reason it cannot submit yet', () => {
    expect(source).toContain('disabled={readOnly || !!busyActionId || action.disabled}');
    expect(source).toContain('const submitBlocked = !canSubmit || Boolean(submitBlockedStatusReason);');
    expect(source).toContain('if (submitBlocked) {');
    expect(source).toContain('setSubmitBlockedNotice(true);');
    expect(source).toContain("'첨부파일을 처리하고 있습니다. 처리가 끝난 뒤 최종 저장해 주세요.'");
    expect(source).toContain("'업로드하지 못한 첨부파일이 있습니다. 해당 파일을 다시 첨부해 주세요.'");
    expect(source).toContain("'임시저장을 진행하고 있습니다. 잠시 후 다시 시도해 주세요.'");
    expect(source).toContain('아직 최종 저장할 수 없습니다');
    expect(source).toContain('최종 저장 전 확인이 필요합니다');
    expect(source).toContain('setStepIndex(Math.max(0, STEPS.findIndex((step) => step.id === issue.step)))');
    expect(source).toContain('단계로 이동');
    expect(source).toContain('{stepIndex === STEPS.length - 1 && !readOnly ? (');
    expect(source).toContain('if (!submitBlocked) setSubmitBlockedNotice(false);');
  });

  it('shows the blocking reason only beside the final save button, not at the top of the review step', () => {
    expect(source).not.toContain('입력이 필요합니다.');
    expect(source.match(/renderSubmitBlockers\(\)/g)).toHaveLength(1);
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

/**
 * 화면 골격 계약. 이 블록은 "저장되는 값"이 아니라 "보여주는 방식"만 고정한다.
 * 45개 필드가 각자 크기·간격·색을 정하던 상태로 돌아가지 않게 막는 것이 목적이다.
 */
describe('ProjectEditorWizard form skeleton contract', () => {
  // 토큰 정의부(주석 포함)를 빼고 실제 렌더 코드만 검사한다.
  const renderBody = source.slice(source.indexOf('function getProjectEditorAutosaveStorageKey'));

  it('routes every field through one row component instead of per-field markup', () => {
    expect(source).toContain('function ProjectFormRow(');
    expect(source).toContain('function ProjectFormSection(');
    // 라벨·필수·부연·도움말·오류의 자리를 한 번만 정한다.
    expect(source).toContain('hints?: ReactNode[];');
    expect(source).toContain('errors?: string[];');
    expect(source).toContain('lg:grid-cols-[168px_minmax(0,1fr)]');
    // 라벨 열이 고정폭이라 `*` 가 저절로 세로 정렬된다. 왼쪽 세로 마커는 두지 않는다.
    expect(source).not.toContain('border-l-4');
  });

  it('keeps type to four roles and spacing to three values', () => {
    expect(source).toContain("const FORM_SECTION_CLASS = 'text-[14px] font-bold");
    expect(source).toContain("const FORM_LABEL_CLASS = 'text-[12px] font-semibold");
    expect(source).toContain("const FORM_VALUE_CLASS = 'text-[13px]'");
    expect(source).toContain("const FORM_NUMERIC_VALUE_CLASS = 'text-[13px] tabular-nums'");
    expect(source).toContain("const FORM_HINT_CLASS = 'text-[11px] font-normal");
    // text-xs 와 text-[12px] 는 같은 12px 를 두 이름으로 부르던 중복이었다. 이름을 하나로 모았다.
    expect(renderBody).not.toContain('text-xs');
    expect(renderBody).not.toContain('text-[10px]');
    expect(renderBody).not.toContain("'text-[12px]");
    expect(source).toContain("const FORM_FIELD_STACK_CLASS = 'space-y-4'");
    expect(source).toContain("const FORM_SECTION_STACK_CLASS = 'space-y-6'");
  });

  it('gives the accent colour exactly one meaning and keeps errors red', () => {
    // 필수 마커 · 포커스 링 · 활성 단계 칩. 그 밖에는 회색조를 쓴다.
    expect(source).toContain("'[&_[data-slot=input]]:focus-visible:ring-[#0176D3]/25'");
    expect(source).toContain("required ? <span className=\"ml-0.5 text-[#0176D3]\">*</span> : null");
    expect(source).toContain("active\n                      ? 'border-[#0176D3] bg-[#0176D3]/5 text-[#0176D3]'");
    expect(source).not.toContain('rose-');
  });

  it('strips the input shell from every calculated value', () => {
    expect(source).toContain('function ProjectComputedValue(');
    expect(source).toContain('계산됨');
    // readOnly 입력칸을 흐린 배경으로 위장하던 처리를 없앴다.
    expect(source).not.toContain('bg-muted/40');
    expect(source).not.toContain('총수익 / 계약금액 기준 자동 계산');
    expect(source).toContain('<ProjectComputedValue value={profitRateLabel');
  });

  it('adds a remaining-count badge to the step chips without touching the verdict', () => {
    expect(source).toContain('const canSubmit = submitIssues.length === 0;');
    expect(source).toContain('const stepIssueCounts = useMemo(');
    expect(source).toContain('submitIssues.forEach((issue) => { counts[issue.step] += 1; });');
    expect(source).toContain('이 단계에 남은 필수 항목');
    expect(source).toContain('onClick={() => setStepIndex(index)}');
  });

  it('repeats the submit-issue wording beside the field and scrolls to it', () => {
    expect(source).toContain('const issueLabelSet = useMemo(');
    expect(source).toContain('const fieldIssues = useCallback(');
    expect(source).toContain('errors={fieldIssues(\'프로젝트명\')}');
    expect(source).toContain('data-issue-label');
    expect(source).toContain("row.scrollIntoView({ block: 'center', behavior: 'smooth' })");
    expect(source).toContain('const goToIssue = (issue: { step: ProjectEditorStep; label: string }) =>');
    expect(source).toContain('onClick={() => goToIssue(issue)}');
  });

  it('reads the multi-year finance as one table whose total row replaces the top inputs', () => {
    expect(source).toContain('const renderAnnualFinanceTable = ');
    expect(source).toContain('const annualTotalsOwnAmounts = usesRegistrationV2 && hasMultiYearContract');
    expect(source).toContain('>연도</th>');
    expect(source).toContain('>합계</th>');
    expect(source).toContain("'px-3 py-2.5 text-right font-semibold text-[#0176D3]'");
    // 다년 계약에서 총계 입력칸은 사라졌지만 단년 계약에서는 그대로 입력한다.
    expect(source).toContain('formatProjectAmountInput(draft.contractAmount, hasContractAmountInput)');
    expect(source).toContain('금액을 계약서와 대조하여 확인했습니다.');
  });

  it('shows a read-only Korean unit beside amounts without touching the stored value', () => {
    expect(source).toContain('function formatKoreanAmountUnit(');
    expect(source).toContain("[100000000, '억']");
    expect(source).toContain('const amountHint = (value: number, entered: boolean, prefix = \'\')');
    // 저장은 여전히 parseProjectAmountInput 이 만든 원 단위 숫자다.
    expect(source).toContain('parseProjectAmountInput(rawValue)');
  });

  it('opens each step with a single "prepare this" note', () => {
    expect(source).toContain('const STEP_PREPARATION_NOTES');
    expect(source).toContain('이 단계에서 준비할 것');
    expect(source).toContain('STEP_PREPARATION_NOTES[step.id].map((note)');
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
