import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectEditorWizard.tsx'), 'utf8');

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
    expect(source).toContain('ContractDocumentPreview');
    expect(source).toContain('draft.contractDocument');
    expect(source).not.toContain('<Input value={draft.contractType}');
  });

  it('keeps select values representable in their option lists', () => {
    expect(source).toContain('const managerOptions = useMemo');
    expect(source).toContain('uid: draft.managerId');
    expect(source).toContain("if (value === 'none')");
    expect(source).toContain("onSelect({ memberName: '', memberNickname: '' })");
    expect(source).toContain('currentTeamMemberOptionExists');
    expect(source).toContain('member.memberNickname ? `${member.memberName} (${member.memberNickname})` : member.memberName');
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
    expect(source).toContain('<Plus className="h-4 w-4" />');
    expect(source).toContain('<Button type="button" onClick={addTeamMember} className="gap-2">');
    expect(source).not.toContain('variant="outline" size="sm" onClick={addTeamMember}');
  });

  it('treats zero-won payment split values as explicit editable values', () => {
    expect(source).toContain('formatProjectAmountInput(draft.paymentPlan.contract, true)');
    expect(source).toContain('formatProjectAmountInput(draft.paymentPlan.interim, true)');
    expect(source).toContain('formatProjectAmountInput(draft.paymentPlan.final, true)');
  });

  it('warns users to verify the uploaded contract before saving', () => {
    expect(source).toContain('등록하려는 계약서가 맞는지 꼭 확인해주세요!');
    expect(source).toContain('descriptionClassName="text-rose-600"');
    expect(source).not.toContain('업로드된 PDF를 마지막 확인 단계에서 바로 봅니다.');
  });
});
