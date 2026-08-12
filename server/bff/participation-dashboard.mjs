import { createHash } from 'node:crypto';
import { readOptionalText } from './bff-utils.mjs';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const SETTLEMENT_LABELS = {
  E_NARA_DOUM: 'e나라도움', ACCOUNTANT: '회계사 정산', PRIVATE: '민간',
  IRIS: 'IRIS', RCMS: 'RCMS', EZBARO: '이지바로', E_HIJO: 'e호조',
  EDUFINE: '에듀파인', HAPPYEUM: '행복이음', AGRIX: '아그릭스',
  BOTAEM_E: '보탬e', SMTECH: 'SMTECH', KOCCA_PMS: 'KOCCA PMS',
  NIPA: 'NIPA', OTHER: '기타', NONE: '정산 미지정',
};

function normalizedSystem(value) {
  const system = readOptionalText(value);
  return Object.hasOwn(SETTLEMENT_LABELS, system) ? system : 'NONE';
}

function projectSettlementSystem(project) {
  if (Number(project?.registrationRequirementsVersion) === 2 && readOptionalText(project?.basis) === 'NONE') return 'NONE';
  const selected = normalizedSystem(project?.settlementSystem);
  if (selected !== 'NONE') return selected;
  if (project?.settlementType === 'TYPE5' || project?.accountType === 'DEDICATED') return 'E_NARA_DOUM';
  if (project?.settlementType === 'NONE' && project?.accountType === 'NONE') return 'NONE';
  return 'PRIVATE';
}

function contractTarget(project) {
  return readOptionalText(project?.clientOrg) || '계약 대상 미지정';
}

export function buildParticipationRule(project) {
  const settlementSystem = projectSettlementSystem(project);
  const target = contractTarget(project);
  const fingerprint = createHash('sha256').update(`${settlementSystem}\n${target}`).digest('hex').slice(0, 20);
  return {
    id: `participation-rule-${fingerprint}`,
    alias: `${target} · ${SETTLEMENT_LABELS[settlementSystem]} 규칙`,
    settlementSystem,
    contractTarget: target,
  };
}

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

export function buildParticipationDashboardSnapshot({ projects = [], entries = [], rules: savedRules = [], generatedAt = '' } = {}) {
  const projectById = new Map(projects.map((project) => [readOptionalText(project?.id), project]));
  const aliases = new Map(savedRules.map((rule) => [readOptionalText(rule?.id), readOptionalText(rule?.alias)]));
  const rules = new Map();
  for (const project of projects) {
    const generatedRule = buildParticipationRule(project);
    const rule = { ...generatedRule, alias: aliases.get(generatedRule.id) || generatedRule.alias };
    const existing = rules.get(rule.id);
    if (existing) {
      const projectId = readOptionalText(project?.id);
      if (projectId) existing.projectIds.add(projectId);
      continue;
    }
    rules.set(rule.id, { ...rule, projectIds: new Set([readOptionalText(project?.id)].filter(Boolean)), rows: new Map() });
  }

  for (const entry of entries) {
    const project = projectById.get(readOptionalText(entry?.projectId));
    if (!project) continue;
    const generatedRule = buildParticipationRule(project);
    const rule = { ...generatedRule, alias: aliases.get(generatedRule.id) || generatedRule.alias };
    const bucket = rules.get(rule.id);
    if (!bucket) continue;
    const memberId = readOptionalText(entry?.memberId) || `unresolved:${readOptionalText(entry?.id)}`;
    const row = bucket.rows.get(memberId) || {
      memberId,
      memberName: displayMemberName(entry),
      projectNames: new Set(),
      values: new Map(),
    };
    row.projectNames.add(readOptionalText(entry?.projectShortName) || readOptionalText(entry?.projectName) || readOptionalText(project?.name));
    for (const year of yearsForEntry(entry)) {
      for (const yearMonth of monthsForYear(year)) {
        row.values.set(yearMonth, (row.values.get(yearMonth) || 0) + valueForMonth(entry, yearMonth));
      }
    }
    bucket.rows.set(memberId, row);
  }

  const availableYears = new Set();
  const serializedRules = [...rules.values()].map((rule) => {
    const members = [...rule.rows.values()].map((row) => {
      const monthlyRates = Object.fromEntries([...row.values.entries()].map(([yearMonth, rate]) => {
        availableYears.add(yearMonth.slice(0, 4));
        return [yearMonth, rate];
      }));
      return {
        memberId: row.memberId,
        memberName: row.memberName,
        projectNames: [...row.projectNames].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
        monthlyRates,
      };
    }).sort((left, right) => left.memberName.localeCompare(right.memberName, 'ko'));
    return {
      id: rule.id,
      alias: rule.alias,
      settlementSystem: rule.settlementSystem,
      contractTarget: rule.contractTarget,
      projectIds: [...rule.projectIds].sort(),
      projectCount: rule.projectIds.size,
      isSaved: aliases.has(rule.id),
      members,
    };
  }).sort((left, right) => left.alias.localeCompare(right.alias, 'ko'));

  return {
    version: 1,
    generatedAt,
    availableYears: [...availableYears].sort(),
    rules: serializedRules,
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

export function selectParticipationDashboardYear(snapshot, year) {
  const selectedYear = /^\d{4}$/.test(readOptionalText(year))
    ? readOptionalText(year)
    : snapshot.availableYears.at(-1) || new Date().getFullYear().toString();
  const monthKeys = monthsForYear(selectedYear);
  const months = monthKeys.map((yearMonth) => ({ yearMonth, label: `${Number(yearMonth.slice(5, 7))}월` }));
  const rules = (snapshot.rules || []).map((rule) => {
    const members = (rule.members || []).map((member) => {
      const monthsWithStatus = monthKeys.map((yearMonth) => {
        const rate = Number(member.monthlyRates?.[yearMonth] || 0);
        return { yearMonth, label: `${Number(yearMonth.slice(5, 7))}월`, rate, isWarning: rate > 100 };
      });
      const warnings = monthsWithStatus.filter((month) => month.isWarning).map(({ yearMonth, rate }) => ({ yearMonth, rate }));
      return { memberId: member.memberId, memberName: member.memberName, projectNames: member.projectNames || [], months: monthsWithStatus, warnings };
    });
    const warnings = members.flatMap((member) => member.warnings.map((warning) => ({ ...warning, memberId: member.memberId, memberName: member.memberName })));
    return {
      id: rule.id,
      alias: rule.alias,
      settlementSystem: rule.settlementSystem,
      contractTarget: rule.contractTarget,
      projectIds: rule.projectIds || [],
      projectCount: rule.projectCount || 0,
      isSaved: rule.isSaved === true,
      members,
      warnings,
      warningCount: warnings.length,
      hasWarnings: warnings.length > 0,
    };
  });
  return {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    availableYears: snapshot.availableYears || [],
    selectedYear,
    months,
    rules,
    ruleCount: rules.length,
    hasRules: rules.length > 0,
  };
}
