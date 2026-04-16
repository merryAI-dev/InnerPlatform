import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalBankStatementHandoffSchema } from '../schemas.mjs';

const SETTLEMENT_HEADERS = [
  '작성자',
  'No.',
  '거래일시',
  '해당 주차',
  '지출구분',
  '비목',
  '세목',
  '세세목',
  'cashflow항목',
  '통장잔액',
  '통장에 찍힌 입/출금액',
  '입금액(사업비,공급가액,은행이자)',
  '매입부가세 반환',
  '사업비 사용액',
  '매입부가세',
  '지급처',
  '상세 적요',
  '필수증빙자료 리스트',
  '실제 구비 완료된 증빙자료 리스트',
  '준비필요자료',
  '증빙자료 드라이브',
  '준비 필요자료',
  'e나라 등록',
  'e나라 집행',
  '부가세 지결 완료여부',
  '최종완료',
  '비고',
];

function normalizeSpace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/[()\[\]{}:;'",._/\-|\\]/g, '')
    .replace(/\s+/g, '');
}

function parseNumber(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[,\s원₩]/g, '').replace(/[^0-9.+-]/g, '');
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateOnly(raw) {
  const value = normalizeSpace(raw).replace(/[./]/g, '-');
  if (!value) return '';
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${String(Number.parseInt(iso[2], 10)).padStart(2, '0')}-${String(Number.parseInt(iso[3], 10)).padStart(2, '0')}`;
  }
  const monthDayYear = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (monthDayYear) {
    return `${monthDayYear[3]}-${String(Number.parseInt(monthDayYear[1], 10)).padStart(2, '0')}-${String(Number.parseInt(monthDayYear[2], 10)).padStart(2, '0')}`;
  }
  return '';
}

function stableHash(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatIsoDate(year, month, day) {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

function addDaysUtc(isoDate, deltaDays) {
  const [yearRaw, monthRaw, dayRaw] = String(isoDate).split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  const date = new Date(Date.UTC(year, month - 1, day) + deltaDays * 24 * 60 * 60 * 1000);
  return formatIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function dayOfWeekUtc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function startOfWeekWednesday(isoDate) {
  const [yearRaw, monthRaw, dayRaw] = String(isoDate).split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  const delta = -((dayOfWeekUtc(year, month, day) - 3 + 7) % 7);
  return addDaysUtc(isoDate, delta);
}

function countDaysInMonthForWeek(weekStart, year, month) {
  let count = 0;
  for (let index = 0; index < 7; index += 1) {
    const [yy, mm] = addDaysUtc(weekStart, index).split('-');
    if (Number.parseInt(yy, 10) === year && Number.parseInt(mm, 10) === month) count += 1;
  }
  return count;
}

function daysInMonthUtc(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getMonthWeeks(yearMonth) {
  const [yearRaw, monthRaw] = String(yearMonth).split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [];

  const firstDay = formatIsoDate(year, month, 1);
  const lastDay = formatIsoDate(year, month, daysInMonthUtc(year, month));
  let weekStart = startOfWeekWednesday(firstDay);
  const yy = year % 100;
  const weeks = [];
  let weekNo = 0;

  while (weekStart <= lastDay) {
    if (countDaysInMonthForWeek(weekStart, year, month) >= 4) {
      weekNo += 1;
      weeks.push({
        yearMonth,
        weekNo,
        weekStart,
        weekEnd: addDaysUtc(weekStart, 6),
        label: `${yy}-${month}-${weekNo}`,
      });
    }
    weekStart = addDaysUtc(weekStart, 7);
  }

  return weeks;
}

function findWeekLabel(dateOnly) {
  if (!dateOnly) return '';
  const [yearRaw, monthRaw] = String(dateOnly).split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '';

  const candidates = [
    `${year}-${pad2(month)}`,
    `${month === 1 ? year - 1 : year}-${pad2(month === 1 ? 12 : month - 1)}`,
    `${month === 12 ? year + 1 : year}-${pad2(month === 12 ? 1 : month + 1)}`,
  ];

  for (const yearMonth of candidates) {
    const week = getMonthWeeks(yearMonth).find((entry) => dateOnly >= entry.weekStart && dateOnly <= entry.weekEnd);
    if (week) return week.label;
  }

  return '';
}

function findSettlementIndex(header) {
  return SETTLEMENT_HEADERS.findIndex((entry) => entry === header);
}

function createEmptyImportRow() {
  return {
    tempId: '',
    cells: SETTLEMENT_HEADERS.map(() => ''),
  };
}

function sanitizeColumns(columns, rows) {
  const incomingColumns = Array.isArray(columns) ? columns : [];
  const maxLenFromRows = Array.isArray(rows)
    ? rows.reduce((max, row) => Math.max(max, Array.isArray(row?.cells) ? row.cells.length : 0), 0)
    : 0;
  const rawColumns = incomingColumns.length > 0
    ? incomingColumns
    : Array.from({ length: maxLenFromRows }, (_, index) => `컬럼${index + 1}`);
  const seen = new Set();

  return rawColumns.map((column, index) => {
    const base = normalizeSpace(column || `컬럼${index + 1}`) || `컬럼${index + 1}`;
    let next = base;
    let suffix = 2;
    while (seen.has(next)) {
      next = `${base}_${suffix}`;
      suffix += 1;
    }
    seen.add(next);
    return next;
  });
}

function normalizeBankRows(columns, rows) {
  const normalizedColumns = Array.isArray(columns) ? columns : [];
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    tempId: readOptionalText(row?.tempId) || `bank-${Date.now()}-${index}`,
    cells: normalizedColumns.map((_, columnIndex) => normalizeSpace(Array.isArray(row?.cells) ? row.cells[columnIndex] : '')),
  }));
}

function findFirstHeaderIndex(columns, aliases) {
  const normalized = columns.map((column) => normalizeKey(column));
  for (const alias of aliases) {
    const target = normalizeKey(alias);
    const exactIndex = normalized.findIndex((column) => column === target);
    if (exactIndex >= 0) return exactIndex;
  }
  for (let index = 0; index < normalized.length; index += 1) {
    const value = normalized[index];
    if (!value) continue;
    if (aliases.some((alias) => value.includes(normalizeKey(alias)))) return index;
  }
  return -1;
}

function findHeaderIndicesByAliases(columns, aliases) {
  const normalized = columns.map((column) => normalizeKey(column));
  const keys = aliases.map((alias) => normalizeKey(alias)).filter(Boolean);
  const matches = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const value = normalized[index];
    if (!value) continue;
    if (keys.some((key) => value === key || value.includes(key) || key.includes(value))) {
      matches.push(index);
    }
  }
  return matches;
}

function buildBankFingerprint(snapshot) {
  return stableHash([
    normalizeSpace(snapshot.accountNumber),
    normalizeSpace(snapshot.dateTime),
    normalizeSpace(snapshot.counterparty),
    normalizeSpace(snapshot.memo),
    String(snapshot.signedAmount ?? ''),
    String(snapshot.balanceAfter ?? ''),
  ].join('|'));
}

function resolveAmount(columns, cells) {
  const withdrawalIndex = findFirstHeaderIndex(columns, ['출금금액', '출금액', '출금']);
  const depositIndex = findFirstHeaderIndex(columns, ['입금금액', '입금액', '입금']);
  const genericIndex = findFirstHeaderIndex(columns, ['거래금액', '금액', '거래액']);

  const withdrawal = withdrawalIndex >= 0 ? parseNumber(cells[withdrawalIndex]) : null;
  const deposit = depositIndex >= 0 ? parseNumber(cells[depositIndex]) : null;
  const generic = genericIndex >= 0 ? parseNumber(cells[genericIndex]) : null;

  if (Number.isFinite(withdrawal) && withdrawal > 0) {
    return { amount: withdrawal, signedAmount: -Math.abs(withdrawal), entryKind: 'EXPENSE' };
  }
  if (Number.isFinite(deposit) && deposit > 0) {
    return { amount: deposit, signedAmount: Math.abs(deposit), entryKind: 'DEPOSIT' };
  }
  if (Number.isFinite(generic) && generic !== 0) {
    return {
      amount: Math.abs(generic),
      signedAmount: generic,
      entryKind: generic >= 0 ? 'DEPOSIT' : 'EXPENSE',
    };
  }

  return { amount: null, signedAmount: 0, entryKind: undefined };
}

function resolveBankSnapshotFromStatementRow(sheet, row) {
  const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  const accountIndex = findFirstHeaderIndex(columns, ['통장번호', '계좌번호']);
  const dateIndex = findFirstHeaderIndex(columns, ['거래일자', '거래일시', '거래일', '날짜']);
  const counterpartyIndex = findFirstHeaderIndex(columns, ['사용처', '가맹점', '상호', '거래처', '의뢰인/수취인', '수취인', '의뢰인', '상대계좌명']);
  const memoIndex = findFirstHeaderIndex(columns, ['적요', '메모', '거래내용', '내용', '상세적요']);
  const balanceIndex = findFirstHeaderIndex(columns, ['잔액']);
  const amount = resolveAmount(columns, cells);
  const dateTime = dateIndex >= 0 ? normalizeSpace(cells[dateIndex]) : '';
  const parsedDate = parseDateOnly(dateTime);

  if (!parsedDate && !amount.amount && !normalizeSpace(cells[counterpartyIndex] || '') && !normalizeSpace(cells[memoIndex] || '')) {
    return null;
  }

  return {
    accountNumber: accountIndex >= 0 ? normalizeSpace(cells[accountIndex]) : '',
    dateTime: dateTime || parsedDate,
    counterparty: counterpartyIndex >= 0 ? normalizeSpace(cells[counterpartyIndex]) : '',
    memo: memoIndex >= 0 ? normalizeSpace(cells[memoIndex]) : '',
    signedAmount: amount.signedAmount || 0,
    balanceAfter: balanceIndex >= 0 ? (parseNumber(cells[balanceIndex]) || 0) : 0,
  };
}

function mapBankStatementsToImportRows(sheet) {
  const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
  const bankRows = Array.isArray(sheet?.rows) ? sheet.rows : [];

  const dateRowIndex = findFirstHeaderIndex(columns, ['거래일자', '거래일시', '거래일', '날짜']);
  const counterpartyIndexes = findHeaderIndicesByAliases(columns, ['사용처', '가맹점', '상호', '거래처', '의뢰인/수취인', '수취인', '의뢰인', '상대계좌명']);
  const memoIndexes = findHeaderIndicesByAliases(columns, ['적요', '메모', '거래내용', '내용', '상세적요']);
  const balanceIndex = findFirstHeaderIndex(columns, ['잔액']);

  const dateIndex = findSettlementIndex('거래일시');
  const weekIndex = findSettlementIndex('해당 주차');
  const counterpartyIndex = findSettlementIndex('지급처');
  const memoIndex = findSettlementIndex('상세 적요');
  const bankAmountIndex = findSettlementIndex('통장에 찍힌 입/출금액');
  const balanceSettlementIndex = findSettlementIndex('통장잔액');
  const depositIndex = findSettlementIndex('입금액(사업비,공급가액,은행이자)');

  const mappedRows = [];

  for (const bankRow of bankRows) {
    const cells = Array.isArray(bankRow?.cells) ? bankRow.cells : [];
    const dateOnly = parseDateOnly(dateRowIndex >= 0 ? cells[dateRowIndex] : '');
    if (!dateOnly) continue;

    const amount = resolveAmount(columns, cells);
    const base = createEmptyImportRow();
    const nextCells = [...base.cells];

    if (dateIndex >= 0) nextCells[dateIndex] = dateOnly;
    if (weekIndex >= 0) nextCells[weekIndex] = findWeekLabel(dateOnly);
    if (counterpartyIndex >= 0) {
      nextCells[counterpartyIndex] = counterpartyIndexes
        .map((index) => normalizeSpace(cells[index]))
        .find(Boolean) || '';
    }
    if (memoIndex >= 0) {
      nextCells[memoIndex] = memoIndexes
        .map((index) => normalizeSpace(cells[index]))
        .find(Boolean) || '';
    }
    if (bankAmountIndex >= 0 && Number.isFinite(amount.amount)) {
      nextCells[bankAmountIndex] = amount.amount.toLocaleString('ko-KR');
    }
    if (depositIndex >= 0 && amount.entryKind === 'DEPOSIT' && Number.isFinite(amount.amount)) {
      nextCells[depositIndex] = amount.amount.toLocaleString('ko-KR');
    }
    if (balanceSettlementIndex >= 0 && balanceIndex >= 0) {
      const balance = parseNumber(cells[balanceIndex]);
      nextCells[balanceSettlementIndex] = Number.isFinite(balance) ? balance.toLocaleString('ko-KR') : normalizeSpace(cells[balanceIndex]);
    }

    const snapshot = resolveBankSnapshotFromStatementRow(sheet, bankRow);
    const fingerprint = snapshot ? buildBankFingerprint(snapshot) : stableHash(`${bankRow.tempId}|${nextCells.join('|')}`);
    mappedRows.push({
      ...base,
      tempId: `bank-${fingerprint}`,
      sourceTxId: `bank:${fingerprint}`,
      ...(amount.entryKind ? { entryKind: amount.entryKind } : {}),
      cells: nextCells,
    });
  }

  const noIndex = findSettlementIndex('No.');
  if (noIndex >= 0) {
    mappedRows.forEach((row, index) => {
      row.cells[noIndex] = String(index + 1);
    });
  }

  return mappedRows;
}

function normalizeExistingImportRow(row) {
  const candidate = row && typeof row === 'object' ? row : {};
  return {
    ...candidate,
    tempId: readOptionalText(candidate.tempId) || `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...(readOptionalText(candidate.sourceTxId) ? { sourceTxId: readOptionalText(candidate.sourceTxId) } : {}),
    ...(readOptionalText(candidate.entryKind) ? { entryKind: readOptionalText(candidate.entryKind) } : {}),
    cells: SETTLEMENT_HEADERS.map((_, index) => normalizeSpace(Array.isArray(candidate.cells) ? candidate.cells[index] : '')),
  };
}

function mergeBankRowsIntoExpenseSheet(existingRows, mappedRows) {
  const existing = (Array.isArray(existingRows) ? existingRows : []).map(normalizeExistingImportRow);
  const mapped = (Array.isArray(mappedRows) ? mappedRows : []).map(normalizeExistingImportRow);
  const autoIndexes = [
    '거래일시',
    '해당 주차',
    '지급처',
    '통장에 찍힌 입/출금액',
    '통장잔액',
    '입금액(사업비,공급가액,은행이자)',
  ].map(findSettlementIndex).filter((index) => index >= 0);
  const dateIndex = findSettlementIndex('거래일시');
  const counterpartyIndex = findSettlementIndex('지급처');

  const rowKey = (row) => {
    const date = dateIndex >= 0 ? normalizeSpace(row.cells[dateIndex]) : '';
    const counterparty = counterpartyIndex >= 0 ? normalizeSpace(row.cells[counterpartyIndex]) : '';
    return date && counterparty ? `${date}|${counterparty}` : '';
  };

  const existingBySource = new Map();
  const existingByKey = new Map();
  const used = new Set();

  for (const row of existing) {
    const source = readOptionalText(row.sourceTxId);
    const key = rowKey(row);
    if (source) {
      const bucket = existingBySource.get(source) || [];
      bucket.push(row);
      existingBySource.set(source, bucket);
    }
    if (key) {
      const bucket = existingByKey.get(key) || [];
      bucket.push(row);
      existingByKey.set(key, bucket);
    }
  }

  const take = (bucket) => (Array.isArray(bucket) ? bucket.find((row) => !used.has(row)) : undefined);

  const merged = [];
  for (const mappedRow of mapped) {
    const matched = take(existingBySource.get(readOptionalText(mappedRow.sourceTxId)))
      || take(existingByKey.get(rowKey(mappedRow)));

    if (!matched) {
      merged.push(mappedRow);
      continue;
    }

    used.add(matched);
    const cells = [...matched.cells];
    for (const index of autoIndexes) {
      cells[index] = mappedRow.cells[index] ?? '';
    }

    merged.push({
      ...matched,
      ...(readOptionalText(mappedRow.sourceTxId) ? { sourceTxId: readOptionalText(mappedRow.sourceTxId) } : {}),
      ...(readOptionalText(mappedRow.entryKind) ? { entryKind: readOptionalText(mappedRow.entryKind) } : {}),
      cells,
    });
  }

  const noIndex = findSettlementIndex('No.');
  if (noIndex >= 0) {
    merged.forEach((row, index) => {
      row.cells[noIndex] = String(index + 1);
    });
  }

  return merged;
}

function readCurrentVersion(current) {
  return Number.isInteger(current?.version) && current.version > 0 ? current.version : 0;
}

function buildBankStatementDocument({
  current,
  projectId,
  columns,
  rows,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  return stripUndefinedDeep({
    ...currentValue,
    id: 'default',
    projectId,
    columns,
    rows,
    rowCount: rows.length,
    columnCount: columns.length,
    updatedAt: timestamp,
    updatedBy: actorId,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    createdBy: readOptionalText(currentValue.createdBy) || actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

function buildExpenseSheetDocument({
  current,
  projectId,
  activeSheetId,
  activeSheetName,
  order,
  rows,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  return stripUndefinedDeep({
    ...currentValue,
    id: activeSheetId,
    projectId,
    name: activeSheetName,
    order,
    rows,
    rowCount: rows.length,
    updatedAt: timestamp,
    updatedBy: actorId,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    createdBy: readOptionalText(currentValue.createdBy) || actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

function normalizeManualFields(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  const next = {};
  if (Number.isFinite(candidate.expenseAmount)) next.expenseAmount = Number(candidate.expenseAmount);
  if (readOptionalText(candidate.budgetCategory)) next.budgetCategory = readOptionalText(candidate.budgetCategory);
  if (readOptionalText(candidate.budgetSubCategory)) next.budgetSubCategory = readOptionalText(candidate.budgetSubCategory);
  if (readOptionalText(candidate.cashflowLineId)) next.cashflowLineId = readOptionalText(candidate.cashflowLineId);
  if (readOptionalText(candidate.cashflowCategory)) next.cashflowCategory = readOptionalText(candidate.cashflowCategory);
  if (readOptionalText(candidate.memo)) next.memo = readOptionalText(candidate.memo);
  if (readOptionalText(candidate.evidenceCompletedDesc)) next.evidenceCompletedDesc = readOptionalText(candidate.evidenceCompletedDesc);
  return next;
}

function hasManualFields(manualFields) {
  return manualFields && Object.keys(manualFields).length > 0;
}

function resolveProjectionStatus({ matchState, manualFields, evidenceStatus }) {
  if (matchState === 'AUTO_CONFIRMED') {
    return evidenceStatus === 'COMPLETE' ? 'PROJECTED' : 'PROJECTED_WITH_PENDING_EVIDENCE';
  }
  if (hasManualFields(manualFields)) {
    return evidenceStatus === 'COMPLETE' ? 'PROJECTED' : 'PROJECTED_WITH_PENDING_EVIDENCE';
  }
  return 'NOT_PROJECTED';
}

function normalizeEvidenceStatus(value) {
  return value === 'PARTIAL' || value === 'COMPLETE' ? value : 'MISSING';
}

function normalizeMatchState(value) {
  return value === 'AUTO_CONFIRMED' || value === 'REVIEW_REQUIRED' || value === 'IGNORED' ? value : 'PENDING_INPUT';
}

function buildExpenseIntakeItem({
  current,
  projectId,
  activeSheetId,
  bankFingerprint,
  bankSnapshot,
  row,
  duplicateCount,
  uploadBatchId,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  const manualFields = normalizeManualFields(currentValue.manualFields);
  const evidenceStatus = normalizeEvidenceStatus(currentValue.evidenceStatus);
  const matchState = duplicateCount > 1
    ? 'REVIEW_REQUIRED'
    : normalizeMatchState(currentValue.matchState);
  const reviewReasons = duplicateCount > 1
    ? ['duplicate_fingerprint_in_upload']
    : Array.isArray(currentValue.reviewReasons)
      ? currentValue.reviewReasons.map((reason) => readOptionalText(reason)).filter(Boolean)
      : matchState === 'REVIEW_REQUIRED'
        ? ['manual_review_required']
        : [];

  return stripUndefinedDeep({
    ...currentValue,
    id: bankFingerprint,
    projectId,
    sourceTxId: `bank:${bankFingerprint}`,
    bankFingerprint,
    bankSnapshot,
    matchState,
    projectionStatus: resolveProjectionStatus({
      matchState,
      manualFields,
      evidenceStatus,
    }),
    evidenceStatus,
    manualFields,
    existingExpenseSheetId: readOptionalText(currentValue.existingExpenseSheetId) || activeSheetId,
    existingExpenseRowTempId: readOptionalText(currentValue.existingExpenseRowTempId) || readOptionalText(row?.tempId) || undefined,
    reviewReasons,
    lastUploadBatchId: uploadBatchId,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    updatedAt: timestamp,
    updatedBy: actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

export function mountPortalBankStatementHandoffCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/bank-statements/handoff', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'handoff portal bank statements');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(
      portalBankStatementHandoffSchema,
      req.body,
      'Invalid portal bank statement handoff payload',
    );

    const normalizedColumns = sanitizeColumns(parsed.columns, parsed.rows);
    const normalizedBankRows = normalizeBankRows(normalizedColumns, parsed.rows);
    const bankSheet = {
      columns: normalizedColumns,
      rows: normalizedBankRows,
    };
    const uploadBatchId = `bank-upload-${Date.now()}`;

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const bankStatementRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/bank_statements/default`);
      const sheetRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/expense_sheets/${parsed.activeSheetId}`);
      const [bankStatementSnapshot, sheetSnapshot] = await Promise.all([
        tx.get(bankStatementRef),
        tx.get(sheetRef),
      ]);

      const currentSheet = sheetSnapshot.exists ? (sheetSnapshot.data() || {}) : {};
      const existingSheetRows = Array.isArray(currentSheet.rows) ? currentSheet.rows : [];
      const mappedRows = mapBankStatementsToImportRows(bankSheet);
      const mergedRows = mergeBankRowsIntoExpenseSheet(existingSheetRows, mappedRows);

      const bankStatementDocument = buildBankStatementDocument({
        current: bankStatementSnapshot.exists ? (bankStatementSnapshot.data() || {}) : null,
        projectId: parsed.projectId,
        columns: normalizedColumns,
        rows: normalizedBankRows,
        actorId,
        timestamp,
      });
      const sheetDocument = buildExpenseSheetDocument({
        current: currentSheet,
        projectId: parsed.projectId,
        activeSheetId: parsed.activeSheetId,
        activeSheetName: parsed.activeSheetName,
        order: parsed.order,
        rows: mergedRows,
        actorId,
        timestamp,
      });

      tx.set(bankStatementRef, bankStatementDocument, { merge: true });
      tx.set(sheetRef, sheetDocument, { merge: true });

      const snapshots = normalizedBankRows
        .map((row) => resolveBankSnapshotFromStatementRow(bankSheet, row))
        .filter(Boolean);
      const duplicateCounts = new Map();
      for (const snapshot of snapshots) {
        const fingerprint = buildBankFingerprint(snapshot);
        duplicateCounts.set(fingerprint, (duplicateCounts.get(fingerprint) || 0) + 1);
      }

      const expenseIntakeItems = [];
      for (const snapshot of snapshots) {
        const bankFingerprint = buildBankFingerprint(snapshot);
        const sourceTxId = `bank:${bankFingerprint}`;
        const matchedRow = mergedRows.find((row) => readOptionalText(row?.sourceTxId) === sourceTxId) || null;
        const intakeRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/expense_intake/${bankFingerprint}`);
        const intakeSnapshot = await tx.get(intakeRef);
        const intakeItem = buildExpenseIntakeItem({
          current: intakeSnapshot.exists ? (intakeSnapshot.data() || {}) : null,
          projectId: parsed.projectId,
          activeSheetId: parsed.activeSheetId,
          bankFingerprint,
          bankSnapshot: snapshot,
          row: matchedRow,
          duplicateCount: duplicateCounts.get(bankFingerprint) || 0,
          uploadBatchId,
          actorId,
          timestamp,
        });
        tx.set(intakeRef, intakeItem, { merge: true });
        expenseIntakeItems.push(intakeItem);
      }

      return {
        bankStatement: bankStatementDocument,
        sheet: sheetDocument,
        rows: mergedRows,
        expenseIntakeItems,
      };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'portal_bank_statement_handoff',
        entityId: `${parsed.projectId}:${parsed.activeSheetId}`,
        action: 'HANDOFF',
        actorId,
        actorRole,
        requestId,
        details: `통장내역 핸드오프: ${parsed.projectId} / ${parsed.activeSheetName}`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          activeSheetId: parsed.activeSheetId,
          rowCount: normalizedBankRows.length,
          columnCount: normalizedColumns.length,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        bankStatement: result.bankStatement,
        sheet: result.sheet,
        rows: result.rows,
        expenseIntakeItems: result.expenseIntakeItems,
      },
    };
  }));
}
