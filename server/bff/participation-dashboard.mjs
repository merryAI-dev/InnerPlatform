import { readOptionalText } from './bff-utils.mjs';
import {
  PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES,
  PARTICIPATION_SETTLEMENT_SYSTEM_LABELS,
  resolveParticipationSettlementSystem,
} from './participation-settlement-system.mjs';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_RULE_FILTER_VALUES = 4;

function buildSettlementSystemOptions(projects) {
  const counts = new Map();
  for (const project of projects) {
    const value = resolveParticipationSettlementSystem(project);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const observedLegacy = [...counts.keys()]
    .filter((value) => !PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES.includes(value))
    .sort();
  return [...PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES, ...observedLegacy].map((value) => ({
    value,
    label: PARTICIPATION_SETTLEMENT_SYSTEM_LABELS[value] || value,
    projectCount: counts.get(value) || 0,
  }));
}

function monthsForYear(year) {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

function yearsForEntry(entry) {
  const years = new Set(Object.keys(entry?.monthlyRates || {}).map((month) => month.slice(0, 4)));
  const start = readOptionalText(entry?.periodStart);
  const end = readOptionalText(entry?.periodEnd);
  if (MONTH_RE.test(start) && MONTH_RE.test(end) && start <= end) {
    const startYear = Number(start.slice(0, 4));
    const endYear = Number(end.slice(0, 4));
    if (Number.isSafeInteger(startYear) && Number.isSafeInteger(endYear) && endYear - startYear <= 99) {
      for (let year = startYear; year <= endYear; year += 1) years.add(String(year));
    }
  } else {
    for (const value of [start, end]) {
      if (MONTH_RE.test(value)) years.add(value.slice(0, 4));
    }
  }
  return [...years].filter((year) => /^\d{4}$/.test(year));
}

function valueForMonth(entry, yearMonth) {
  if (Object.hasOwn(entry || {}, 'monthlyRates')) {
    const explicit = entry?.monthlyRates?.[yearMonth];
    return typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0 && explicit <= 100 ? explicit : 0;
  }
  const start = readOptionalText(entry?.periodStart);
  const end = readOptionalText(entry?.periodEnd);
  const rate = Number(entry?.rate);
  if (!MONTH_RE.test(start) || !MONTH_RE.test(end) || !Number.isFinite(rate) || rate < 0 || rate > 100) return 0;
  return start <= yearMonth && yearMonth <= end ? rate : 0;
}

function entryOwnsMonth(entry, yearMonth) {
  if (Object.hasOwn(entry?.monthlyRates || {}, yearMonth)) return true;
  const start = readOptionalText(entry?.periodStart);
  const end = readOptionalText(entry?.periodEnd);
  return MONTH_RE.test(start) && MONTH_RE.test(end) && start <= yearMonth && yearMonth <= end;
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
    && (!settlementSystems.length || settlementSystems.includes(resolveParticipationSettlementSystem(project)));
}

export function buildParticipationDashboardSnapshot({ projects = [], entries = [], people = [], rules: savedRules = [], generatedAt = '' } = {}) {
  const projectById = new Map(projects.map((project) => [readOptionalText(project?.id), project]));
  const peopleById = new Map(people.map((person) => [readOptionalText(person?.personId) || readOptionalText(person?.id), person]));
  let unlinkedEntryCount = 0;
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
  const sheetOwnedMonths = new Set();
  for (const entry of entries) {
    if (readOptionalText(entry?.source) !== 'PROJECT_TEAM_SYNC') continue;
    const projectId = readOptionalText(entry?.projectId);
    const personId = readOptionalText(entry?.personId);
    if (!projectById.has(projectId) || !peopleById.has(personId)) continue;
    for (const year of yearsForEntry(entry)) {
      for (const yearMonth of monthsForYear(year)) {
        if (entryOwnsMonth(entry, yearMonth)) {
          sheetOwnedMonths.add(`${projectId}\n${personId}\n${yearMonth}`);
        }
      }
    }
  }

  for (const entry of entries) {
    const projectId = readOptionalText(entry?.projectId);
    const project = projectById.get(projectId);
    if (!project) continue;
    const personId = readOptionalText(entry?.personId);
    const person = peopleById.get(personId);
    if (!person) {
      unlinkedEntryCount += 1;
      continue;
    }
    for (const bucket of buckets.values()) {
      if (!matchesRule(project, bucket)) continue;
      const row = bucket.rows.get(personId) || {
        memberId: personId,
        memberName: readOptionalText(person?.name) || personId,
        joinedAt: readOptionalText(person?.joinedAt),
        projectNames: new Set(),
        projectIds: new Set(),
        values: new Map(),
        confirmedMonths: new Set(),
        missingMonths: new Set(),
        projects: new Map(),
      };
      const projectName = readOptionalText(entry?.projectShortName) || readOptionalText(entry?.projectName) || readOptionalText(project?.name) || projectId;
      const projectRow = row.projects.get(projectId) || {
        projectId,
        projectNames: new Set(),
        values: new Map(),
        confirmedMonths: new Set(),
        missingMonths: new Set(),
      };
      projectRow.projectNames.add(projectName);
      row.projectNames.add(projectName);
      row.projectIds.add(projectId);
      for (const year of yearsForEntry(entry)) {
        for (const yearMonth of monthsForYear(year)) {
          if (
            readOptionalText(entry?.source) !== 'PROJECT_TEAM_SYNC'
            && sheetOwnedMonths.has(`${projectId}\n${personId}\n${yearMonth}`)
          ) continue;
          if (!entryOwnsMonth(entry, yearMonth)) continue;
          const value = valueForMonth(entry, yearMonth);
          row.values.set(yearMonth, (row.values.get(yearMonth) || 0) + value);
          projectRow.values.set(yearMonth, (projectRow.values.get(yearMonth) || 0) + value);
          if (
            Object.hasOwn(entry || {}, 'monthlyRates')
            && (!Object.hasOwn(entry?.monthlyRates || {}, yearMonth) || entry?.monthlyRates?.[yearMonth] === null)
          ) {
            row.missingMonths.add(yearMonth);
            projectRow.missingMonths.add(yearMonth);
          } else {
            row.confirmedMonths.add(yearMonth);
            projectRow.confirmedMonths.add(yearMonth);
          }
        }
      }
      row.projects.set(projectId, projectRow);
      bucket.rows.set(personId, row);
    }
  }

  const availableYears = new Set(['2026']);
  const serializedRules = [...buckets.values()].map((rule) => {
    const members = [...rule.rows.values()].map((row) => {
      const monthlyRates = Object.fromEntries([...row.values.entries()].map(([yearMonth, rate]) => {
        availableYears.add(yearMonth.slice(0, 4));
        return [yearMonth, rate];
      }));
      return {
        memberId: row.memberId,
        memberName: row.memberName,
        joinedAt: row.joinedAt,
        projectNames: [...row.projectNames].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
        projectCount: row.projectIds.size,
        monthlyRates,
        confirmedMonths: [...row.confirmedMonths].sort(),
        missingMonths: [...row.missingMonths].sort(),
        projects: [...row.projects.values()].map((projectRow) => ({
          projectId: projectRow.projectId,
          projectName: [...projectRow.projectNames].sort((left, right) => left.localeCompare(right, 'ko'))[0] || projectRow.projectId,
          monthlyRates: Object.fromEntries([...projectRow.values.entries()].sort(([left], [right]) => left.localeCompare(right))),
          confirmedMonths: [...projectRow.confirmedMonths].sort(),
          missingMonths: [...projectRow.missingMonths].sort(),
        })).sort((left, right) => (
          left.projectName.localeCompare(right.projectName, 'ko')
          || left.projectId.localeCompare(right.projectId)
        )),
      };
    }).sort((left, right) => (
      (left.joinedAt || '9999-12-31').localeCompare(right.joinedAt || '9999-12-31')
      || left.memberName.localeCompare(right.memberName, 'ko')
    ));
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
      settlementSystems: buildSettlementSystemOptions(projects),
    },
    unlinkedEntryCount,
  };
}

export function buildProjectParticipationSnapshot({ project, entries = [] } = {}) {
  const rows = new Map();
  const sheetEntries = entries.filter((entry) => readOptionalText(entry?.source) === 'PROJECT_TEAM_SYNC');
  const representsSamePerson = (left, right) => {
    const leftPersonId = readOptionalText(left?.personId);
    const rightPersonId = readOptionalText(right?.personId);
    if (leftPersonId && rightPersonId) return leftPersonId === rightPersonId;
    const leftMemberId = readOptionalText(left?.memberId);
    const rightMemberId = readOptionalText(right?.memberId);
    return Boolean(leftMemberId && rightMemberId && leftMemberId === rightMemberId);
  };
  const periodsOverlap = (left, right) => {
    const leftStart = readOptionalText(left?.periodStart);
    const leftEnd = readOptionalText(left?.periodEnd);
    const rightStart = readOptionalText(right?.periodStart);
    const rightEnd = readOptionalText(right?.periodEnd);
    if (![leftStart, leftEnd, rightStart, rightEnd].every((value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value))) {
      return false;
    }
    if (leftStart > leftEnd || rightStart > rightEnd) return false;
    return leftStart <= rightEnd && rightStart <= leftEnd;
  };
  for (const entry of entries) {
    const source = readOptionalText(entry?.source) || 'MANUAL';
    if (
      source === 'MANUAL'
      && sheetEntries.some((sheetEntry) => representsSamePerson(entry, sheetEntry) && periodsOverlap(entry, sheetEntry))
    ) continue;
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
      source,
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
    : '2026';
  const monthKeys = monthsForYear(selectedYear);
  const months = monthKeys.map((yearMonth) => ({ yearMonth, label: `${Number(yearMonth.slice(5, 7))}월` }));
  const ruleOptions = (snapshot.rules || []).map((rule) => ({ id: rule.id, alias: rule.alias, clientOrgs: rule.clientOrgs || [], settlementSystems: rule.settlementSystems || [] }));
  const selectedRule = (snapshot.rules || []).find((rule) => rule.id === selectedRuleId) || snapshot.rules?.[0] || { id: 'all', alias: '전체 인력', members: [], clientOrgs: [], settlementSystems: [] };
  const monthWithStatus = (source, yearMonth) => {
    const rate = Number(source.monthlyRates?.[yearMonth] || 0);
    return {
      yearMonth,
      label: `${Number(yearMonth.slice(5, 7))}월`,
      rate,
      isConfirmed: (source.confirmedMonths || []).includes(yearMonth),
      hasMissing: (source.missingMonths || []).includes(yearMonth),
      isWarning: rate > 100,
    };
  };
  const members = (selectedRule.members || []).map((member) => {
    const monthsWithStatus = monthKeys.map((yearMonth) => monthWithStatus(member, yearMonth));
    const selectedYearProjects = (member.projects || []).map((projectRow) => ({
      projectId: projectRow.projectId,
      projectName: projectRow.projectName,
      months: monthKeys.map((yearMonth) => monthWithStatus(projectRow, yearMonth)),
    })).filter((projectRow) => projectRow.months.some((month) => month.isConfirmed || month.hasMissing));
    const warnings = monthsWithStatus.filter((month) => month.isWarning).map(({ yearMonth, rate }) => ({ yearMonth, rate }));
    return {
      memberId: member.memberId,
      memberName: member.memberName,
      projectLabel: selectedYearProjects.map((projectRow) => projectRow.projectName).join(' · '),
      projectCount: selectedYearProjects.length,
      projects: selectedRule.id === 'all' ? [] : selectedYearProjects,
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
    unlinkedEntryCount: Number(snapshot.unlinkedEntryCount) || 0,
  };
}
