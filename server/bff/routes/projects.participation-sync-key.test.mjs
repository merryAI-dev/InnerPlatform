import { describe, expect, it } from 'vitest';
import {
  buildProjectTeamMemberSyncKeys,
  syncProjectParticipationEntries,
} from './projects.mjs';

function createParticipationSyncDb(initial = {}) {
  const store = new Map(Object.entries(initial));
  const refFor = (path) => ({ path, id: path.split('/').pop() });
  return {
    store,
    db: {
      collection(path) {
        if (path.endsWith('/members')) {
          return {
            get: async () => ({ docs: [] }),
          };
        }
        if (path.endsWith('/partEntries')) {
          return {
            doc: (id) => refFor(`${path}/${id}`),
            where: () => ({
              get: async () => ({
                docs: [...store.entries()]
                  .filter(([key, value]) => key.startsWith(`${path}/`) && value.projectId)
                  .map(([key, value]) => ({
                    id: key.slice(path.length + 1),
                    ref: refFor(key),
                    data: () => value,
                  })),
              }),
            }),
          };
        }
        throw new Error(`unexpected collection: ${path}`);
      },
      batch() {
        const operations = [];
        return {
          set: (ref, value, options) => operations.push({ kind: 'set', ref, value, options }),
          delete: (ref) => operations.push({ kind: 'delete', ref }),
          commit: async () => {
            for (const operation of operations) {
              if (operation.kind === 'delete') {
                store.delete(operation.ref.path);
              } else if (operation.options?.merge) {
                store.set(operation.ref.path, { ...(store.get(operation.ref.path) || {}), ...operation.value });
              } else {
                store.set(operation.ref.path, structuredClone(operation.value));
              }
            }
          },
        };
      },
    },
  };
}

// 참여행 문서 ID 가 이 키로 만들어진다(`pte-{사업}-{키}`). 키가 바뀌면 연결이 끊기고,
// 키가 겹치면 참여행이 서로 덮어써 참여율이 사라진다. 두 가지를 함께 지킨다.
describe('참여행 연결 키', () => {
  it('역할을 넣지 않는다 - 역할명을 고쳐도 같은 사람의 연결이 유지되어야 한다', () => {
    const before = buildProjectTeamMemberSyncKeys([
      { memberName: '김정태', memberNickname: '에이블', role: '사업 총괄' },
    ]);
    const afterRoleRename = buildProjectTeamMemberSyncKeys([
      { memberName: '김정태', memberNickname: '에이블', role: '총괄책임자' },
    ]);
    expect(before).toEqual(['에이블']);
    expect(afterRoleRename).toEqual(before);
  });

  it('닉네임이 없으면 이름으로 만든다', () => {
    expect(buildProjectTeamMemberSyncKeys([{ memberName: '노성진', role: '사업총괄' }])).toEqual(['노성진']);
  });

  it('한 사업에 같은 사람이 두 역할로 있으면 그때만 역할을 덧붙인다', () => {
    expect(buildProjectTeamMemberSyncKeys([
      { memberNickname: '에이블', role: '사업총괄' },
      { memberNickname: '에이블', role: '서류총괄' },
      { memberNickname: '유자', role: '실무책임자' },
    ])).toEqual(['에이블__사업총괄', '에이블__서류총괄', '유자']);
  });

  it('같은 사람이 같은 역할로 재투입되면 시작월로 stint를 구분한다', () => {
    expect(buildProjectTeamMemberSyncKeys([
      {
        memberNickname: '에이블', role: '연구', laborAllocationStartMonth: '2026-01',
        monthlyRates: { '2026-01': 20 },
      },
      {
        memberNickname: '에이블', role: '연구', laborAllocationStartMonth: '2026-04',
        monthlyRates: { '2026-04': 20 },
      },
    ])).toEqual(['에이블__2026-01', '에이블__2026-04']);
  });

  it('기존 비시트 중복 역할 키는 시작월이 있어도 역할 기준을 유지한다', () => {
    expect(buildProjectTeamMemberSyncKeys([
      { memberNickname: '에이블', role: '사업총괄', laborAllocationStartMonth: '2026-01' },
      { memberNickname: '에이블', role: '서류총괄', laborAllocationStartMonth: '2026-04' },
    ])).toEqual(['에이블__사업총괄', '에이블__서류총괄']);
  });

  it('시트 stint는 한 건일 때부터 시작월을 써서 재투입 추가 뒤에도 첫 문서 ID가 유지된다', () => {
    const firstStint = {
      memberName: '김정태',
      memberNickname: '에이블',
      role: '',
      laborAllocationStartMonth: '2026-01',
      monthlyRates: { '2026-01': 20 },
    };
    const before = buildProjectTeamMemberSyncKeys([firstStint]);
    const after = buildProjectTeamMemberSyncKeys([
      firstStint,
      {
        ...firstStint,
        laborAllocationStartMonth: '2026-04',
        monthlyRates: { '2026-04': 20 },
      },
    ]);

    expect(before).toEqual(['에이블__2026-01']);
    expect(after).toEqual(['에이블__2026-01', '에이블__2026-04']);
  });

  it('미정-N 닉네임에 이름이 있으면 실제 이름과 시작월로 시트 stint 키를 만든다', () => {
    expect(buildProjectTeamMemberSyncKeys([{
      memberName: '김혜령',
      memberNickname: '미정-1',
      laborAllocationStartMonth: '2026-03',
      monthlyRates: { '2026-03': 30 },
    }])).toEqual(['김혜령__2026-03']);
  });

  it('겹치는 사람의 키가 서로 달라 참여행이 덮어써지지 않는다', () => {
    const keys = buildProjectTeamMemberSyncKeys([
      { memberNickname: '에이블', role: '사업총괄' },
      { memberNickname: '에이블', role: '서류총괄' },
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('사람도 역할도 비어 있으면 자리표시자로 채워 키가 빈 문자열이 되지 않는다', () => {
    expect(buildProjectTeamMemberSyncKeys([{}, {}])).toEqual(['member__role', 'member__role']);
  });

  it('명단이 비었거나 배열이 아니면 빈 결과를 준다', () => {
    expect(buildProjectTeamMemberSyncKeys([])).toEqual([]);
    expect(buildProjectTeamMemberSyncKeys(undefined)).toEqual([]);
  });
});

describe('시트 참여율의 PROJECT_TEAM_SYNC 저장', () => {
  it('부모 transaction writer를 받으면 별도 batch 없이 같은 commit에 참여행을 싣는다', async () => {
    const { db } = createParticipationSyncDb({
      'orgs/mysc/partEntries/pte-project-a-stale': {
        id: 'pte-project-a-stale',
        projectId: 'project-a',
        source: 'PROJECT_TEAM_SYNC',
      },
    });
    const setOperations = [];
    const deleteOperations = [];
    const transaction = {
      get: async (target) => target.get(),
      set: (ref, value) => setOperations.push({ ref, value }),
      delete: (ref) => deleteOperations.push(ref),
    };
    db.batch = () => {
      throw new Error('separate batch must not be used');
    };

    await syncProjectParticipationEntries({
      db,
      transaction,
      tenantId: 'mysc',
      project: {
        id: 'project-a',
        name: '원자 저장 사업',
        contractStart: '2026-01-01',
        contractEnd: '2026-12-31',
        teamMembersDetailed: [{
          personId: 'person-able',
          memberName: '김정태',
          memberNickname: '에이블',
          role: '',
          participationRate: 20,
          laborAllocationStartMonth: '2026-01',
          monthlyRates: { '2026-01': 20 },
        }],
      },
      now: '2026-08-21T00:00:00.000Z',
    });

    expect(setOperations).toHaveLength(1);
    expect(setOperations[0].value).toMatchObject({ source: 'PROJECT_TEAM_SYNC', personId: 'person-able' });
    expect(deleteOperations.map((ref) => ref.id)).toEqual(['pte-project-a-stale']);
  });

  it('역할이 비어도 빈칸·0·변동 월·다년도를 한 stint에 그대로 저장한다', async () => {
    const { db, store } = createParticipationSyncDb();

    await syncProjectParticipationEntries({
      db,
      tenantId: 'mysc',
      project: {
        id: 'project-a',
        name: '다년도 사업',
        contractStart: '2026-01-01',
        contractEnd: '2027-12-31',
        teamMembersDetailed: [{
          personId: 'person-able',
          memberName: '김정태',
          memberNickname: '에이블',
          role: '',
          participationRate: 20,
          laborAllocationStartMonth: '2026-01',
          laborAllocationEndMonth: '2027-12',
          monthlyRates: {
            '2026-01': 20,
            '2026-02': null,
            '2026-03': 0,
            '2026-04': 10,
            '2027-01': 5,
          },
        }],
      },
      now: '2026-08-21T00:00:00.000Z',
    });

    expect([...store.values()]).toEqual([
      expect.objectContaining({
        personId: 'person-able',
        note: '',
        periodStart: '2026-01',
        periodEnd: '2027-12',
        source: 'PROJECT_TEAM_SYNC',
        monthlyRates: {
          '2026-01': 20,
          '2026-02': null,
          '2026-03': 0,
          '2026-04': 10,
          '2027-01': 5,
        },
      }),
    ]);
  });

  it('연결 대기를 멱등 저장하고 다음 저장에서 빠진 행과 오래된 월을 제거한다', async () => {
    const path = 'orgs/mysc/partEntries/pte-project-a-테일러__2026-01';
    const { db, store } = createParticipationSyncDb({
      [path]: {
        id: 'pte-project-a-테일러',
        projectId: 'project-a',
        source: 'PROJECT_TEAM_SYNC',
        personId: 'stale-person',
        memberId: 'project-team:테일러',
        monthlyRates: { '2026-01': 30, '2026-02': 30 },
      },
      'orgs/mysc/partEntries/pte-project-a-removed': {
        id: 'pte-project-a-removed',
        projectId: 'project-a',
        source: 'PROJECT_TEAM_SYNC',
      },
      'orgs/mysc/partEntries/manual-entry': {
        id: 'manual-entry',
        projectId: 'project-a',
        source: 'MANUAL',
        personId: 'manual-person',
      },
    });
    const project = {
      id: 'project-a',
      name: '연결 대기 사업',
      contractStart: '2026-01-01',
      contractEnd: '2026-12-31',
      teamMembersDetailed: [{
        memberName: '김혜령',
        memberNickname: '테일러',
        role: '',
        participationRate: 30,
        laborAllocationStartMonth: '2026-01',
        laborAllocationEndMonth: '2026-12',
        monthlyRates: { '2026-01': 30, '2026-02': null },
      }],
    };

    await syncProjectParticipationEntries({ db, tenantId: 'mysc', project, now: '2026-08-21T00:00:00.000Z' });
    await syncProjectParticipationEntries({ db, tenantId: 'mysc', project, now: '2026-08-21T00:01:00.000Z' });

    expect([...store.keys()].sort()).toEqual([
      'orgs/mysc/partEntries/manual-entry',
      path,
    ].sort());
    expect(store.get(path)).toMatchObject({
      memberId: 'project-team:테일러__2026-01',
      monthlyRates: { '2026-01': 30, '2026-02': null },
    });
    expect(store.get(path)).not.toHaveProperty('personId');
    expect(store.get('orgs/mysc/partEntries/manual-entry')).toMatchObject({
      source: 'MANUAL',
      personId: 'manual-person',
    });
  });

  it('People 등록 후 재연동하면 같은 문서 ID에 personId만 승격한다', async () => {
    const path = 'orgs/mysc/partEntries/pte-project-a-테일러__2026-01';
    const { db, store } = createParticipationSyncDb();
    const project = {
      id: 'project-a',
      name: '연결 대기 사업',
      contractStart: '2026-01-01',
      contractEnd: '2026-12-31',
      teamMembersDetailed: [{
        memberName: '김혜령',
        memberNickname: '테일러',
        role: '',
        participationRate: 30,
        laborAllocationStartMonth: '2026-01',
        monthlyRates: { '2026-01': 30 },
      }],
    };

    await syncProjectParticipationEntries({ db, tenantId: 'mysc', project, now: '2026-08-21T00:00:00.000Z' });
    expect(store.get(path)).not.toHaveProperty('personId');

    project.teamMembersDetailed[0].personId = 'person-taylor';
    await syncProjectParticipationEntries({ db, tenantId: 'mysc', project, now: '2026-08-21T00:01:00.000Z' });

    expect([...store.keys()]).toEqual([path]);
    expect(store.get(path)).toMatchObject({ personId: 'person-taylor' });
  });
});
