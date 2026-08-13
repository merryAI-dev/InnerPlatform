import { readOptionalText } from './bff-utils.mjs';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_RULE_FILTER_VALUES = 4;
const SETTLEMENT_SYSTEM_LABELS = {
  E_NARA_DOUM: 'e나라도움', IRIS: 'IRIS', RCMS: 'RCMS', EZBARO: '통합이지바로', E_HIJO: 'e호조', EDUFINE: '에듀파인',
  HAPPYEUM: '행복e음', AGRIX: 'AgriX', BOTAEM_E: '보탬e', SMTECH: 'SMTECH', KOCCA_PMS: 'e나라도움', NIPA: 'NIPA',
  ACCOUNTANT: '회계사정산', PRIVATE: '자체 정산', OTHER: '기타', NONE: '시스템 미사용',
};

function monthsForYear(year) {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

function yearsForEntry(entry) {
  const years = new Set(Object.keys(entry?.monthlyRates || {}).map((month) => month.slice(0, 4)));
  for (const value of [entry?.periodStart, entry?.periodEnd]) {
    if (MONTH_RE.test(readOptionalText(value))) years.add(String(value).slice(0, 4));
  }
  return [...years].filter((year) => /^\d{4}$/.test(year));
}

function valueForMonth(entry, yearMonth) {
  if (Object.hasOwn(entry?.monthlyRates || {}, yearMonth)) {
    const explicit = entry.monthlyRates[yearMonth];
    return typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0 && explicit <= 100 ? explicit : 0;
  }
  const start = readOptionalText(entry?.periodStart);
  const end = readOptionalText(entry?.periodEnd);
  const rate = Number(entry?.rate);
  if (!MONTH_RE.test(start) || !MONTH_RE.test(end) || !Number.isFinite(rate) || rate < 0 || rate > 100) return 0;
  return start <= yearMonth && yearMonth <= end ? rate : 0;
}

function displayMemberName(entry) {
  return readOptionalText(entry?.memberName) || readOptionalText(entry?.memberId) || '이름 미지정';
}

function normalizedValues(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(readOptionalText).filter(Boolean))].slice(0, MAX_RULE_FILTER_VALUES);
}

function matchesRule(project, rule) {
  const clientOrgs = rule.clientOrgs || [];
  const settlementSystems = rule.settlementSystems || [];
  return (!clientOrgs.length || clientOrgs.includes(readOptionalText(project.clientOrg)))
    && (!settlementSystems.length || settlementSystems.includes(readOptionalText(project.settlementSystem) || 'NONE'));
}

export function buildParticipationDashboardSnapshot({ projects = [], entries = [], rules: savedRules = [], generatedAt = '' } = {}) {
  const projectById = new Map(projects.map((project) => [readOptionalText(project?.id), project]));
  const rules = savedRules
    .filter((rule) => readOptionalText(rule?.kind) === 'USER_DEFINED' && readOptionalText(rule?.id) && readOptionalText(rule?.alias)
      && (Array.isArray(rule?.clientOrgs) || Array.isArray(rule?.settlementSystems)))
    .map((rule) => ({
      id: readOptionalText(rule.id), alias: readOptionalText(rule.alias),
      clientOrgs: normalizedValues(rule.clientOrgs),
      settlementSystems: normalizedValues(rule.settlementSystems),
    }))
    .sort((left, right) => left.alias.localeCompare(right.alias, 'ko'));
  const buckets = new Map([
    ['all', { id: 'all', alias: '전체 인력', clientOrgs: [], settlementSystems: [], rows: new Map() }],
    ...rules.map((rule) => [rule.id, { ...rule, rows: new Map() }]),
  ]);

  for (const entry of entries) {
    const projectId = readOptionalText(entry?.projectId);
    const project = projectById.get(projectId);
    if (!project) continue;
    for (const bucket of buckets.values()) {
      if (!matchesRule(project, bucket)) continue;
      const memberId = readOptionalText(entry?.memberId) || `name:${displayMemberName(entry)}`;
      const row = bucket.rows.get(memberId) || {
        memberId,
        memberName: displayMemberName(entry),
        projectNames: new Set(),
        projectIds: new Set(),
        values: new Map(),
      };
      row.projectNames.add(readOptionalText(entry?.projectShortName) || readOptionalText(entry?.projectName) || readOptionalText(project?.name) || projectId);
      row.projectIds.add(projectId);
      for (const year of yearsForEntry(entry)) {
        for (const yearMonth of monthsForYear(year)) {
          row.values.set(yearMonth, (row.values.get(yearMonth) || 0) + valueForMonth(entry, yearMonth));
        }
      }
      bucket.rows.set(memberId, row);
    }
  }

  const availableYears = new Set();
  const serializedRules = [...buckets.values()].map((rule) => {
    const members = [...rule.rows.values()].map((row) => {
      const monthlyRates = Object.fromEntries([...row.values.entries()].map(([yearMonth, rate]) => {
        availableYears.add(yearMonth.slice(0, 4));
        return [yearMonth, rate];
      }));
      return {
        memberId: row.memberId,
        memberName: row.memberName,
        projectNames: [...row.projectNames].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
        projectCount: row.projectIds.size,
        monthlyRates,
      };
    }).sort((left, right) => left.memberName.localeCompare(right.memberName, 'ko'));
    return {
      id: rule.id,
      alias: rule.alias,
      clientOrgs: rule.clientOrgs,
      settlementSystems: rule.settlementSystems,
      members,
    };
  });

  return {
    version: 1,
    generatedAt,
    availableYears: [...availableYears].sort(),
    rules: serializedRules,
    filterOptions: {
      clientOrgs: [...new Set(projects.map((project) => readOptionalText(project?.clientOrg)).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ko')),
      settlementSystems: [...new Set(projects.map((project) => readOptionalText(project?.settlementSystem) || 'NONE'))]
        .sort().map((value) => ({ value, label: SETTLEMENT_SYSTEM_LABELS[value] || value })),
    },
  };
}

export function buildProjectParticipationSnapshot({ project, entries = [] } = {}) {
  const rows = new Map();
  for (const entry of entries) {
    const memberId = readOptionalText(entry?.memberId) || `unresolved:${readOptionalText(entry?.id)}`;
    const row = rows.get(memberId) || { memberId, memberName: displayMemberName(entry), entries: [], totalRate: 0 };
    const rate = Number(entry?.rate);
    row.entries.push({
      id: readOptionalText(entry?.id),
      rate: Number.isFinite(rate) ? rate : 0,
      settlementSystem: readOptionalText(entry?.settlementSystem) || 'NONE',
      clientOrg: readOptionalText(entry?.clientOrg),
      periodStart: readOptionalText(entry?.periodStart),
      periodEnd: readOptionalText(entry?.periodEnd),
      source: readOptionalText(entry?.source) || 'MANUAL',
      note: readOptionalText(entry?.note),
    });
    row.totalRate += Number.isFinite(rate) ? rate : 0;
    rows.set(memberId, row);
  }
  const members = [...rows.values()].map((row) => ({
    ...row,
    entryCount: row.entries.length,
    isWarning: row.totalRate > 100,
  })).sort((left, right) => left.memberName.localeCompare(right.memberName, 'ko'));
  const totalRate = members.reduce((sum, member) => sum + member.totalRate, 0);
  return {
    projectId: readOptionalText(project?.id),
    projectName: readOptionalText(project?.name),
    headcount: members.length,
    totalRate,
    averageRate: members.length ? totalRate / members.length : 0,
    hasMembers: members.length > 0,
    members,
  };
}

export function selectParticipationDashboardYear(snapshot, year, selectedRuleId = 'all') {
  const selectedYear = /^\d{4}$/.test(readOptionalText(year))
    ? readOptionalText(year)
    : snapshot.availableYears.at(-1) || new Date().getFullYear().toString();
  const monthKeys = monthsForYear(selectedYear);
  const months = monthKeys.map((yearMonth) => ({ yearMonth, label: `${Number(yearMonth.slice(5, 7))}월` }));
  const ruleOptions = (snapshot.rules || []).map((rule) => ({ id: rule.id, alias: rule.alias, clientOrgs: rule.clientOrgs || [], settlementSystems: rule.settlementSystems || [] }));
  const selectedRule = (snapshot.rules || []).find((rule) => rule.id === selectedRuleId) || snapshot.rules?.[0] || { id: 'all', alias: '전체 인력', members: [], clientOrgs: [], settlementSystems: [] };
  const members = (selectedRule.members || []).map((member) => {
    const monthsWithStatus = monthKeys.map((yearMonth) => {
      const rate = Number(member.monthlyRates?.[yearMonth] || 0);
      return { yearMonth, label: `${Number(yearMonth.slice(5, 7))}월`, rate, isWarning: rate > 100 };
    });
    const warnings = monthsWithStatus.filter((month) => month.isWarning).map(({ yearMonth, rate }) => ({ yearMonth, rate }));
    return {
      memberId: member.memberId,
      memberName: member.memberName,
      projectLabel: (member.projectNames || []).join(' · '),
      projectCount: Number(member.projectCount) || 0,
      months: monthsWithStatus,
      warnings,
    };
  });
  const warnings = members.flatMap((member) => member.warnings.map((warning) => ({ ...warning, memberId: member.memberId, memberName: member.memberName })));
  return {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    availableYears: snapshot.availableYears || [],
    selectedYear,
    months,
    selectedRule: { id: selectedRule.id, alias: selectedRule.alias, clientOrgs: selectedRule.clientOrgs || [], settlementSystems: selectedRule.settlementSystems || [] },
    ruleOptions,
    userRuleOptions: ruleOptions.filter((rule) => rule.id !== 'all'),
    members,
    warnings,
    warningCount: warnings.length,
    hasWarnings: warnings.length > 0,
    filterOptions: snapshot.filterOptions || { clientOrgs: [], settlementSystems: [] },
  };
}
