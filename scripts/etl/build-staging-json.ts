#!/usr/bin/env npx tsx
/**
 * Build ETL staging JSON artifacts from dry-run outputs.
 *
 * Outputs:
 *  - scripts/etl/output/firestore-staging-bundle.json   (Firestore 적재 대기용)
 *  - public/data/etl-staging-ui.json                    (앱 로컬 표시용)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type AnyRecord = Record<string, unknown>;

interface SummaryLike {
  loads?: Array<{
    collection?: string;
    sheetName?: string;
    dryRunPath?: string;
    documentsWritten?: number;
  }>;
  flags?: {
    org?: string;
  };
}

interface FirestoreBundle {
  generatedAt: string;
  sourceSummary: string;
  orgId: string;
  stats: {
    totalDocuments: number;
    byCollection: Record<string, number>;
    bySheet: Array<{ collection: string; sheetName: string; count: number; sourceFile: string }>;
  };
  collections: Record<string, AnyRecord[]>;
}

interface UiStagingData {
  generatedAt: string;
  sourceSummary: string;
  orgId: string;
  projects: AnyRecord[];
  members: AnyRecord[];
  ledgers: AnyRecord[];
  transactions: AnyRecord[];
  comments: AnyRecord[];
  evidences: AnyRecord[];
  auditLogs: AnyRecord[];
  participationEntries: AnyRecord[];
}

const ROOT = process.cwd();
const OUTPUT_DIR = join(ROOT, 'scripts/etl/output');
const UI_OUT = join(ROOT, 'public/data/etl-staging-ui.json');
const BUNDLE_OUT = join(OUTPUT_DIR, 'firestore-staging-bundle.json');

main();

function main() {
  if (!existsSync(OUTPUT_DIR)) {
    throw new Error(`Output directory not found: ${OUTPUT_DIR}`);
  }

  const latestSummary = findLatestSummaryFile(OUTPUT_DIR);
  if (!latestSummary) {
    throw new Error('No pipeline-summary-*.json found in scripts/etl/output');
  }

  const summaryPath = join(OUTPUT_DIR, latestSummary);
  const summary = readJson<SummaryLike>(summaryPath);

  const sheetFiles = resolveDryRunFiles(summary, OUTPUT_DIR);
  if (sheetFiles.length === 0) {
    throw new Error('No dry-run json files found from latest summary');
  }

  const now = new Date().toISOString();
  const orgId = summary.flags?.org || 'mysc';
  const collections: Record<string, AnyRecord[]> = {};
  const bySheet: Array<{ collection: string; sheetName: string; count: number; sourceFile: string }> = [];

  for (const item of sheetFiles) {
    const docs = readJson<AnyRecord[]>(item.fullPath);
    if (!Array.isArray(docs)) continue;

    if (!collections[item.collection]) collections[item.collection] = [];
    collections[item.collection].push(
      ...docs.map((doc, idx) => normalizeStagingDoc(doc, item.collection, item.sheetName, idx)),
    );

    bySheet.push({
      collection: item.collection,
      sheetName: item.sheetName,
      count: docs.length,
      sourceFile: item.fileName,
    });
  }

  const byCollection: Record<string, number> = {};
  let totalDocuments = 0;
  for (const [collection, docs] of Object.entries(collections)) {
    byCollection[collection] = docs.length;
    totalDocuments += docs.length;
  }

  const bundle: FirestoreBundle = {
    generatedAt: now,
    sourceSummary: latestSummary,
    orgId,
    stats: {
      totalDocuments,
      byCollection,
      bySheet,
    },
    collections,
  };

  const uiData = buildUiStaging(bundle);

  mkdirSync(join(ROOT, 'public/data'), { recursive: true });
  writeJson(BUNDLE_OUT, bundle);
  writeJson(UI_OUT, uiData);

  console.log('✅ Staging bundle created');
  console.log(`  - ${rel(BUNDLE_OUT)}`);
  console.log(`  - ${rel(UI_OUT)}`);
  console.log(`  - total docs: ${totalDocuments}`);
  console.log(`  - collections: ${Object.entries(byCollection).map(([k, v]) => `${k}:${v}`).join(', ')}`);
}

function buildUiStaging(bundle: FirestoreBundle): UiStagingData {
  const projectsRaw = bundle.collections.projects || [];
  const membersRaw = bundle.collections.members || [];
  const partRaw = bundle.collections.participationEntries || [];
  const txRaw = bundle.collections.transactions || [];
  const now = new Date().toISOString();

  const members = membersRaw.map((m, idx) => {
    const name = cleanText(m.name) || `구성원-${idx + 1}`;
    const uid = stableId('m', `${name}|${cleanText(m.nickname)}|${idx}`);
    const dept = cleanText(m.department);
    const role = /재무/.test(name + dept) ? 'finance' : /관리자/.test(name) ? 'admin' : 'pm';
    return {
      uid,
      name,
      email: `${uid}@local.mysc`,
      role,
      avatarUrl: '',
    };
  });

  const memberByName = new Map<string, string>();
  for (const member of members) {
    memberByName.set(member.name, member.uid);
  }

  const projects = projectsRaw
    .filter((p) => cleanText(p.name))
    .map((p, idx) => {
      const name = cleanText(p.name);
      const clientOrg = cleanText(p.clientOrg);
      const source = cleanText(p.importSource);
      const id = stableId('p', `${name}|${clientOrg}|${source}|${idx}`);
      const amount = toNumber(p.contractAmount) ?? 0;

      return {
        id,
        slug: `etl-${id}`,
        orgId: 'org001',
        name,
        status: mapProjectStatus(p.status),
        type: mapProjectType(p.type),
        phase: mapProjectPhase(p.phase, source),
        contractAmount: amount,
        contractStart: toDateStr(p.contractStart),
        contractEnd: toDateStr(p.contractEnd),
        settlementType: mapSettlementType(p.settlementType),
        basis: mapBasis(p.basis),
        accountType: mapAccountType(p.accountType),
        paymentPlan: { contract: amount, interim: 0, final: 0 },
        paymentPlanDesc: '',
        clientOrg,
        groupwareName: '',
        participantCondition: '',
        contractType: '',
        department: cleanText(p.department),
        teamName: cleanText(p.teamName),
        managerId: '',
        managerName: cleanText(p.managerName),
        budgetCurrentYear: toNumber(p.budgetCurrentYear) ?? 0,
        taxInvoiceAmount: 0,
        profitRate: normalizeRate(toNumber(p.profitRate) ?? 0),
        profitAmount: toNumber(p.profitAmount) ?? 0,
        isSettled: false,
        finalPaymentNote: '',
        confirmerName: '',
        lastCheckedAt: '',
        cashflowDiffNote: '',
        description: source || 'ETL staging import',
        createdAt: toIsoNow(p.createdAt) || now,
        updatedAt: toIsoNow(p.updatedAt) || now,
      };
    });

  const projectById = new Map(projects.map((p) => [String(p.id), p]));
  const defaultProjectId = String(projects[0]?.id || stableId('p', 'fallback'));

  const ledgers = projects.map((project) => {
    const pid = String(project.id);
    const accountType = cleanText(project.accountType);
    const templateId = accountType === 'DEDICATED' ? 'tpl001' : accountType === 'OPERATING' ? 'tpl002' : 'tpl003';
    const ledgerName = accountType === 'DEDICATED' ? '전용통장 원장' : accountType === 'OPERATING' ? '운영통장 원장' : '정산제출 원장';
    return {
      id: `l-${pid}`,
      projectId: pid,
      templateId,
      name: ledgerName,
      basis: mapBasis((project as AnyRecord).basis),
      settlementType: mapSettlementType((project as AnyRecord).settlementType),
      createdAt: cleanText((project as AnyRecord).createdAt) || now,
      updatedAt: cleanText((project as AnyRecord).updatedAt) || now,
    };
  });

  const ledgerByProjectId = new Map(ledgers.map((ledger) => [String(ledger.projectId), String(ledger.id)]));
  const defaultActorUid = String(members[0]?.uid || 'u-local');
  const defaultActorName = cleanText(members[0]?.name) || '로컬관리자';

  const transactions = txRaw.map((raw, idx) => {
    const rawAmounts = (raw.amounts && typeof raw.amounts === 'object') ? raw.amounts as AnyRecord : {};
    const deposit = toNumber(rawAmounts.depositAmount) ?? 0;
    const expense = toNumber(rawAmounts.expenseAmount) ?? 0;
    const bank = toNumber(rawAmounts.bankAmount) ?? Math.max(deposit, expense);
    const balanceAfter = toNumber(rawAmounts.balanceAfter) ?? 0;
    const direction = mapDirection(raw.direction, deposit, expense);
    const dateTime = resolveDateTime(raw.dateTime, raw.weekCode, now);
    const weekCode = resolveWeekCode(raw.weekCode, dateTime);
    const method = mapPaymentMethod(raw.method);
    const projectId = resolveProjectIdForTx(raw, projects, defaultProjectId);
    const ledgerId = ledgerByProjectId.get(projectId) || `l-${projectId}`;
    const cashflowCategory = mapCashflowCategory(raw, direction);
    const requiredDocs = splitList(raw.requiredDocs);
    const pendingDocs = splitList(raw.pendingDocs);
    const completedDocs = splitList(raw.completedDocs);
    const evidenceStatus = deriveEvidenceStatus(requiredDocs, pendingDocs, completedDocs);
    const txId = cleanText(raw.id) || stableId('tx', `${cleanText(raw.importSource)}|${idx}`);
    const state = mapTxState(raw.txType || raw.state);
    const writer = cleanText(raw.writer);
    const createdBy = memberByName.get(writer) || defaultActorUid;
    const createdByName = writer || defaultActorName;

    return {
      id: txId,
      ledgerId,
      projectId,
      state,
      dateTime,
      weekCode,
      direction,
      method,
      cashflowCategory,
      cashflowLabel: cleanText(raw.cashflowCategory) || cashflowCategory,
      budgetCategory: cleanText(raw.budgetCategory),
      counterparty: cleanText(raw.counterparty) || '미상',
      memo: cleanText(raw.memo),
      amounts: {
        bankAmount: bank,
        depositAmount: direction === 'IN' ? Math.max(deposit, bank) : deposit,
        expenseAmount: direction === 'OUT' ? Math.max(expense, bank) : expense,
        vatIn: toNumber(rawAmounts.vatIn) ?? 0,
        vatOut: toNumber(rawAmounts.vatOut) ?? 0,
        vatRefund: toNumber(rawAmounts.vatRefund) ?? 0,
        balanceAfter,
      },
      evidenceRequired: requiredDocs,
      evidenceStatus,
      evidenceMissing: pendingDocs,
      attachmentsCount: completedDocs.length,
      submittedBy: state === 'SUBMITTED' ? createdBy : undefined,
      submittedAt: state === 'SUBMITTED' ? dateTime : undefined,
      approvedBy: state === 'APPROVED' ? createdBy : undefined,
      approvedAt: state === 'APPROVED' ? dateTime : undefined,
      rejectedReason: state === 'REJECTED' ? (pendingDocs.join(', ') || '증빙 미흡') : undefined,
      createdBy,
      createdAt: toIsoNow(raw.createdAt) || dateTime,
      updatedBy: createdBy,
      updatedAt: toIsoNow(raw.updatedAt) || dateTime,
      _rawImportSource: cleanText(raw.importSource),
    };
  });

  const comments: AnyRecord[] = [];
  const evidences: AnyRecord[] = [];
  const auditLogs: AnyRecord[] = [];

  for (const [idx, tx] of transactions.entries()) {
    const missing = Array.isArray(tx.evidenceMissing) ? tx.evidenceMissing as string[] : [];
    const required = Array.isArray(tx.evidenceRequired) ? tx.evidenceRequired as string[] : [];

    if (missing.length > 0) {
      comments.push({
        id: stableId('c', `${tx.id}|missing|${idx}`),
        transactionId: tx.id,
        authorId: defaultActorUid,
        authorName: defaultActorName,
        content: `미비 증빙: ${missing.join(', ')}`,
        createdAt: tx.updatedAt,
      });
    }

    const completedCount = Number(tx.attachmentsCount || 0);
    for (let i = 0; i < completedCount; i++) {
      const category = required[i] || '증빙자료';
      evidences.push({
        id: stableId('ev', `${tx.id}|${category}|${i}`),
        transactionId: tx.id,
        fileName: `${category}_${tx.id}_${i + 1}.pdf`,
        fileType: 'application/pdf',
        fileSize: 128000,
        uploadedBy: defaultActorUid,
        uploadedAt: tx.updatedAt,
        category,
        status: 'ACCEPTED',
      });
    }

    auditLogs.push({
      id: stableId('al', `tx|${tx.id}|${idx}`),
      entityType: 'transaction',
      entityId: tx.id,
      action: mapAuditAction(tx.state),
      userId: defaultActorUid,
      userName: defaultActorName,
      details: `${tx.direction} ${tx.cashflowCategory} ${formatNumber((tx.amounts as AnyRecord).bankAmount)}원`,
      timestamp: tx.updatedAt,
    });
  }

  for (const [idx, project] of projects.entries()) {
    auditLogs.push({
      id: stableId('al', `project|${project.id}|${idx}`),
      entityType: 'project',
      entityId: project.id,
      action: 'CREATE',
      userId: defaultActorUid,
      userName: defaultActorName,
      details: `프로젝트 로드: ${project.name}`,
      timestamp: project.updatedAt || now,
    });
  }

  const participationEntries = partRaw
    .map((entry, idx) => {
      const memberName = cleanText(entry.memberName);
      if (!memberName) return null;

      const [periodStart, periodEnd] = parsePeriod(entry.period);
      const memberId = memberByName.get(memberName) || stableId('m', memberName);
      const source = cleanText(entry.importSource);
      const id = stableId('pe', `${memberName}|${source}|${idx}`);
      const rate = normalizePercentLike(entry.rate);
      const linkedProject = resolveProjectIdFromText(`${cleanText(entry.projectName)} ${source}`, projects, defaultProjectId);

      return {
        id,
        memberId,
        memberName,
        projectId: linkedProject,
        projectName: String(projectById.get(linkedProject)?.name || cleanText(entry.projectName) || '미매핑 프로젝트'),
        rate,
        settlementSystem: 'NONE',
        clientOrg: '',
        periodStart,
        periodEnd,
        isDocumentOnly: false,
        note: source || '',
        updatedAt: toIsoNow(entry.updatedAt) || now,
      };
    })
    .filter(Boolean) as AnyRecord[];

  return {
    generatedAt: bundle.generatedAt,
    sourceSummary: bundle.sourceSummary,
    orgId: bundle.orgId,
    projects,
    members,
    ledgers,
    transactions,
    comments,
    evidences,
    auditLogs,
    participationEntries,
  };
}

function findLatestSummaryFile(dir: string): string | null {
  const files = readdirSync(dir)
    .filter((f) => /^pipeline-summary-\d+\.json$/.test(f))
    .sort((a, b) => Number(b.match(/(\d+)/)?.[1] || 0) - Number(a.match(/(\d+)/)?.[1] || 0));
  return files[0] || null;
}

function resolveDryRunFiles(summary: SummaryLike, outputDir: string) {
  const byFile = new Map<string, { collection: string; sheetName: string; fullPath: string; fileName: string }>();
  const rows = summary.loads || [];

  for (const row of rows) {
    if (!row.dryRunPath || !row.collection || !row.sheetName) continue;
    const fullPath = join(ROOT, row.dryRunPath);
    if (!existsSync(fullPath)) continue;
    const fileName = fullPath.replace(`${outputDir}/`, '');
    byFile.set(fileName, {
      collection: row.collection,
      sheetName: row.sheetName,
      fullPath,
      fileName,
    });
  }

  return Array.from(byFile.values()).sort((a, b) => a.fileName.localeCompare(b.fileName, 'ko'));
}

function normalizeStagingDoc(doc: AnyRecord, collection: string, sheetName: string, idx: number): AnyRecord {
  const normalized = { ...doc };
  const importSource = cleanText(normalized.importSource);
  const rawId = cleanText(normalized.id);
  if (!rawId) {
    normalized.id = stableId(collection, `${sheetName}|${importSource}|${idx}`);
  }
  normalized._staging = {
    collection,
    sheetName,
    index: idx,
  };
  return normalized;
}

function mapProjectStatus(raw: unknown): string {
  const value = cleanText(raw);
  const allowed = new Set(['CONTRACT_PENDING', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED_PENDING_PAYMENT']);
  if (allowed.has(value)) return value;
  if (/종료|완료/.test(value)) return 'COMPLETED';
  if (/진행/.test(value)) return 'IN_PROGRESS';
  return 'CONTRACT_PENDING';
}

function mapProjectType(raw: unknown): string {
  const value = cleanText(raw);
  const allowed = new Set(['DEV_COOPERATION', 'CONSULTING', 'SPACE_BIZ', 'IMPACT_INVEST', 'EDUCATION', 'AC_GENERAL', 'OTHER']);
  return allowed.has(value) ? value : 'OTHER';
}

function mapProjectPhase(raw: unknown, source: string): string {
  const value = cleanText(raw);
  if (value === 'CONFIRMED' || value === 'PROSPECT') return value;
  if (source.includes('1-2.')) return 'CONFIRMED';
  if (source.includes('1-1.')) return 'PROSPECT';
  if (/확정/.test(value)) return 'CONFIRMED';
  return 'PROSPECT';
}

function mapSettlementType(raw: unknown): string {
  const value = cleanText(raw);
  return ['TYPE1', 'TYPE2', 'TYPE4'].includes(value) ? value : 'TYPE1';
}

function mapBasis(raw: unknown): string {
  const value = cleanText(raw);
  return ['SUPPLY_AMOUNT', 'SUPPLY_PRICE'].includes(value) ? value : 'SUPPLY_AMOUNT';
}

function mapAccountType(raw: unknown): string {
  const value = cleanText(raw);
  return ['DEDICATED', 'OPERATING', 'NONE'].includes(value) ? value : 'NONE';
}

function mapDirection(raw: unknown, deposit: number, expense: number): 'IN' | 'OUT' {
  const value = cleanText(raw).toUpperCase();
  if (value === 'IN' || value === 'OUT') return value as 'IN' | 'OUT';
  if (deposit > 0 && expense <= 0) return 'IN';
  return 'OUT';
}

function mapPaymentMethod(raw: unknown): string {
  const value = cleanText(raw).toUpperCase();
  if (['BANK_TRANSFER', 'CARD', 'CASH', 'CHECK', 'OTHER'].includes(value)) return value;
  if (/카드|CARD/.test(value)) return 'CARD';
  if (/현금|CASH/.test(value)) return 'CASH';
  if (/수표|CHECK/.test(value)) return 'CHECK';
  return 'BANK_TRANSFER';
}

function mapTxState(raw: unknown): string {
  const value = cleanText(raw).toUpperCase();
  if (['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(value)) return value;
  if (/반려/.test(value)) return 'REJECTED';
  if (/제출/.test(value)) return 'SUBMITTED';
  return 'APPROVED';
}

function mapAuditAction(state: unknown): string {
  const s = cleanText(state).toUpperCase();
  if (s === 'APPROVED') return 'APPROVE';
  if (s === 'REJECTED') return 'REJECT';
  if (s === 'SUBMITTED') return 'SUBMIT';
  return 'UPDATE';
}

function mapCashflowCategory(raw: AnyRecord, direction: 'IN' | 'OUT'): string {
  const text = normalizeText([raw.cashflowCategory, raw.budgetCategory, raw.budgetSubCategory, raw.memo].map(cleanText).join(' '));
  if (/계약금/.test(text)) return 'CONTRACT_PAYMENT';
  if (/중도/.test(text)) return 'INTERIM_PAYMENT';
  if (/잔금/.test(text)) return 'FINAL_PAYMENT';
  if (/인건비|급여/.test(text)) return 'LABOR_COST';
  if (/외주|용역|파트너/.test(text)) return 'OUTSOURCING';
  if (/장비/.test(text)) return 'EQUIPMENT';
  if (/출장|교통|travel/.test(text)) return 'TRAVEL';
  if (/소모품|회의|다과|식비|supplies/.test(text)) return 'SUPPLIES';
  if (/통신/.test(text)) return 'COMMUNICATION';
  if (/임차|임대|렌트|rent/.test(text)) return 'RENT';
  if (/공과|전기|수도|가스|utility/.test(text)) return 'UTILITY';
  if (/세금|원천세|tax/.test(text)) return 'TAX_PAYMENT';
  if (/환급|부가세|vat/.test(text)) return 'VAT_REFUND';
  if (/이자|interest/.test(text)) return direction === 'IN' ? 'MISC_INCOME' : 'MISC_EXPENSE';
  return direction === 'IN' ? 'MISC_INCOME' : 'MISC_EXPENSE';
}

function resolveProjectIdForTx(raw: AnyRecord, projects: AnyRecord[], fallbackId: string): string {
  const direct = cleanText(raw.projectId);
  if (direct && projects.some((p) => String(p.id) === direct)) return direct;
  const sourceText = [raw.memo, raw.counterparty, raw.cashflowCategory, raw.importSource].map(cleanText).join(' ');
  return resolveProjectIdFromText(sourceText, projects, fallbackId);
}

function resolveProjectIdFromText(textRaw: string, projects: AnyRecord[], fallbackId: string): string {
  const text = normalizeText(textRaw);
  if (!text) return fallbackId;
  const sorted = [...projects].sort((a, b) => cleanText(b.name).length - cleanText(a.name).length);
  for (const project of sorted) {
    const name = normalizeText(cleanText(project.name));
    const clientOrg = normalizeText(cleanText(project.clientOrg));
    if (name && text.includes(name)) return String(project.id);
    if (clientOrg && text.includes(clientOrg)) return String(project.id);
  }
  return fallbackId;
}

function resolveDateTime(rawDate: unknown, rawWeekCode: unknown, nowIso: string): string {
  const date = toDateStr(rawDate);
  if (date) return date;
  const week = cleanText(rawWeekCode);
  if (/^\d{4}-\d{2}-\d{2}$/.test(week)) return week;
  if (/^\d{4}-\d{2}-W\d+$/.test(week)) {
    const [, y, m, w] = week.match(/^(\d{4})-(\d{2})-W(\d+)$/) || [];
    if (y && m && w) {
      const day = Math.min(28, (Number(w) - 1) * 7 + 1);
      return `${y}-${m}-${String(day).padStart(2, '0')}`;
    }
  }
  return nowIso.slice(0, 10);
}

function resolveWeekCode(rawWeekCode: unknown, dateTime: string): string {
  const week = cleanText(rawWeekCode);
  if (/^\d{4}-\d{2}-W\d+$/.test(week)) return week;
  const source = /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : dateTime;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return '';
  const [y, m, d] = source.split('-').map(Number);
  const weekNo = Math.max(1, Math.min(5, Math.ceil(d / 7)));
  return `${y}-${String(m).padStart(2, '0')}-W${weekNo}`;
}

function deriveEvidenceStatus(required: string[], missing: string[], completed: string[]): string {
  if (required.length === 0 && missing.length === 0) return 'COMPLETE';
  if (missing.length > 0 && completed.length === 0) return 'MISSING';
  if (missing.length > 0) return 'PARTIAL';
  if (completed.length > 0) return 'COMPLETE';
  return 'MISSING';
}

function splitList(raw: unknown): string[] {
  const s = cleanText(raw);
  if (!s) return [];
  return s
    .split(/[,/;|\n]+/g)
    .map((v) => v.trim())
    .filter((v) => v && v !== '-' && v !== '없음' && v !== 'None');
}

function normalizeRate(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 1) return n / 100;
  if (n < 0) return 0;
  return n;
}

function normalizePercentLike(raw: unknown): number {
  const n = toNumber(raw);
  if (n == null || !Number.isFinite(n)) return 0;
  if (n <= 1) return Math.round(n * 10000) / 100;
  return Math.round(n * 100) / 100;
}

function parsePeriod(raw: unknown): [string, string] {
  const s = cleanText(raw);
  if (!s) return ['2026-01', '2026-12'];
  if (/연중/.test(s)) return ['2026-01', '2026-12'];

  const nums = s.match(/\d{1,2}/g);
  if (!nums || nums.length === 0) return ['2026-01', '2026-12'];
  const start = clampMonth(Number(nums[0]));
  const end = clampMonth(Number(nums[1] || nums[0]));
  return [`2026-${String(start).padStart(2, '0')}`, `2026-${String(end).padStart(2, '0')}`];
}

function clampMonth(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(12, Math.trunc(v)));
}

function toDateStr(raw: unknown): string {
  const s = cleanText(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function toIsoNow(raw: unknown): string | null {
  const s = cleanText(raw);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = cleanText(raw).replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cleanText(raw: unknown): string {
  if (raw == null) return '';
  return String(raw).trim();
}

function normalizeText(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function formatNumber(raw: unknown): string {
  const n = toNumber(raw);
  if (n == null) return '0';
  return new Intl.NumberFormat('ko-KR').format(n);
}

function stableId(prefix: string, key: string): string {
  let h = 2166136261;
  const s = `${prefix}:${key}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

function rel(path: string): string {
  return path.replace(`${ROOT}/`, '');
}
