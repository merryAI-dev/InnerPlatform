import { describe, expect, it } from 'vitest';
import {
  buildProjectPatchFromChangeRequestPayload,
  normalizeProjectOrganizationLabel,
} from './routes/projects.mjs';

describe('BFF project change request payload merge', () => {
  it('turns an approved change request payload into a concrete project patch', () => {
    const patch = buildProjectPatchFromChangeRequestPayload({
      name: '2026 CTS2 수정',
      officialContractName: '2026 CTS2 공식 계약명',
      type: 'D1',
      status: 'IN_PROGRESS',
      phase: 'CONFIRMED',
      description: '수정 설명',
      clientOrg: 'KOICA',
      department: '개발협력센터',
      contractAmount: 1230000,
      salesVatAmount: 0,
      totalRevenueAmount: 300000,
      supportAmount: 0,
      contractStart: '2026-01-01',
      contractEnd: '2026-12-31',
      finalPaymentExpectedWeek: '26-12-4',
      settlementType: 'TYPE1',
      basis: '공급가액',
      accountType: 'OPERATING',
      managerId: 'u-berry',
      managerName: '김인효(베리)',
      teamName: '개발협력센터',
      note: '승인 전 수정값',
      finalPaymentExpectedWeek: '26-12-4',
      teamMembersDetailed: [
        { memberName: '김인효', memberNickname: '베리', role: 'PM', participationRate: 50 },
      ],
    }, {
      name: '2026 CTS2',
      managerId: 'u-old',
      managerName: '이전 담당자',
      department: 'CIC2',
      paymentPlan: { contract: 0, interim: 0, final: 0 },
    });

    expect(patch).toMatchObject({
      name: '2026 CTS2 수정',
      officialContractName: '2026 CTS2 공식 계약명',
      clientOrg: 'KOICA',
      department: '개발협력센터',
      cic: '개발협력센터',
      registeredById: 'u-berry',
      registeredByName: '김인효(베리)',
      managerId: 'u-berry',
      managerName: '김인효(베리)',
      note: '승인 전 수정값',
    });
    expect(patch.teamMembersDetailed).toHaveLength(1);
  });

  it('canonicalizes CIC and Team organization labels before persistence', () => {
    expect(normalizeProjectOrganizationLabel('CIC 2')).toBe('CIC2');
    expect(normalizeProjectOrganizationLabel('AXR Team')).toBe('AXR팀');

    expect(buildProjectPatchFromChangeRequestPayload({ department: 'CIC 2' }, {})).toMatchObject({
      department: 'CIC2',
      cic: 'CIC2',
    });
    expect(buildProjectPatchFromChangeRequestPayload({ department: 'AXR Team' }, {})).toMatchObject({
      department: 'AXR팀',
      cic: 'AXR팀',
    });
  });
});
