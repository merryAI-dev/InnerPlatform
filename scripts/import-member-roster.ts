#!/usr/bin/env npx tsx
/**
 * 재직자 명부 엑셀을 members 컬렉션으로 가져온다.
 *
 * 기본 동작은 dry-run이며 Firestore에 아무것도 쓰지 않는다.
 * 실제 반영은 --apply 를 명시할 때만 수행한다.
 *
 * Usage:
 *   npx tsx scripts/import-member-roster.ts --file "<roster>.xlsx"
 *   npx tsx scripts/import-member-roster.ts --file "<roster>.xlsx" --org mysc --apply
 *
 * 개인정보 보호: 성별·생년월일(양력/음력) 컬럼은 읽지도, 저장하지도 않는다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 명부에서 가져오는 필드. 이 목록 밖의 컬럼은 읽지 않는다. */
const IMPORT_HEADERS = {
  name: '이름',
  nickname: '별명',
  email: '이메일 주소',
  departmentTop: '소속(대분류)',
  department: '소속(중분류)',
  departmentSub: '소속(소분류)',
  title: '직책',
  joinedAt: '입사일',
  employmentNote: '비고',
} as const;

/** 어떤 경우에도 읽거나 저장하지 않는 개인정보 컬럼. */
const FORBIDDEN_HEADERS = ['성별', '생년월일(양력)', '생년월일(음력)', '생년월일'] as const;

type FieldKey = keyof typeof IMPORT_HEADERS;
/** Fields written to Firestore: the roster columns plus the derived Korean-name field. */
type MemberFieldKey = FieldKey | 'nameKo';

/** firebase-admin은 CJS라 런타임 값은 default에 담겨 온다. */
type FirebaseAdmin = typeof import('firebase-admin');
type FirestoreDb = import('firebase-admin').firestore.Firestore;

const FIELD_LABELS: Record<MemberFieldKey, string> = {
  nameKo: '이름(한글)',
  name: '이름',
  nickname: '별명',
  email: '이메일',
  departmentTop: '소속(대분류)',
  department: '소속(중분류)',
  departmentSub: '소속(소분류)',
  title: '직책',
  joinedAt: '입사일',
  employmentNote: '재직 비고',
};

interface RosterRow {
  excelRow: number;
  name: string;
  nickname: string;
  email: string;
  departmentTop: string;
  department: string;
  departmentSub: string;
  title: string;
  joinedAt: string;
  employmentNote: string;
}

type PlanAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'CONFLICT' | 'INVALID';

interface PlanEntry {
  action: PlanAction;
  row: RosterRow;
  docId: string | null;
  changedFields: MemberFieldKey[];
  note: string;
}

loadEnvFiles();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const orgId = getFlagValue('--org') || process.env.VITE_DEFAULT_ORG_ID || 'mysc';
const sheetName = getFlagValue('--sheet') || '재직자현황';
const filePath = resolve(getFlagValue('--file') || '');

main().catch((err) => {
  console.error(`\n❌ 재직자 명부 가져오기 실패: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

async function main() {
  if (!getFlagValue('--file')) {
    throw new Error('--file <엑셀 경로> 를 지정해주세요.');
  }
  if (!existsSync(filePath)) {
    throw new Error(`엑셀 파일을 찾을 수 없습니다: ${filePath}`);
  }

  const { rows, headerRow } = await readRoster(filePath, sheetName);
  console.log('📄 명부 읽기');
  console.log(`  - 파일: ${filePath}`);
  console.log(`  - 시트: ${sheetName}`);
  console.log(`  - 헤더 행: ${headerRow}행 (헤더 문자열로 탐색)`);
  console.log(`  - 유효 인원: ${rows.length}명`);
  console.log(`  - 가져오는 항목: ${Object.values(FIELD_LABELS).join(', ')}`);
  console.log('  - 제외한 개인정보: 성별, 생년월일(양력), 생년월일(음력)');

  reportDataQuality(rows);

  const admin = await loadFirebaseAdmin();
  if (!admin) {
    console.log('\n🔎 Firestore 자격증명이 없어 명부 파싱 결과만 확인했습니다.');
    console.log('   대조/반영을 하려면 FIREBASE_SERVICE_ACCOUNT_JSON 또는 FIREBASE_SERVICE_ACCOUNT_BASE64 를 설정하세요.');
    return;
  }

  const db = admin.firestore();
  const existing = await loadExistingMembers(db, orgId);
  const plan = buildPlan(rows, existing);
  reportPlan(plan);

  if (!apply) {
    console.log('\n🟢 dry-run 입니다. Firestore에 아무것도 쓰지 않았습니다.');
    console.log('   실제 반영은 --apply 를 붙여 다시 실행하세요.');
    return;
  }

  await applyPlan(db, plan);
}

// ── 엑셀 읽기 ──

async function readRoster(path: string, sheet: string): Promise<{ rows: RosterRow[]; headerRow: number }> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);

  const worksheet = workbook.getWorksheet(sheet);
  if (!worksheet) {
    const names = workbook.worksheets.map((ws) => ws.name).join(', ');
    throw new Error(`'${sheet}' 시트를 찾을 수 없습니다. 파일에 있는 시트: ${names}`);
  }

  const { headerRow, columns } = findHeaderColumns(worksheet);

  const rows: RosterRow[] = [];
  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    const excelRow = worksheet.getRow(r);
    const read = (key: FieldKey) => cellText(excelRow.getCell(columns[key]).value).trim();

    const name = read('name');
    const email = read('email');
    // 합계행·번호만 남은 잔여행처럼 이름과 이메일이 모두 빈 행은 인원이 아니다.
    if (!name && !email) continue;

    rows.push({
      excelRow: r,
      name,
      nickname: read('nickname'),
      email,
      departmentTop: read('departmentTop'),
      department: read('department'),
      departmentSub: read('departmentSub'),
      title: read('title'),
      joinedAt: toIsoDate(excelRow.getCell(columns.joinedAt).value),
      employmentNote: read('employmentNote'),
    });
  }

  if (rows.length === 0) {
    throw new Error(`'${sheet}' 시트 ${headerRow + 1}행 이후에서 인원 데이터를 찾지 못했습니다.`);
  }
  return { rows, headerRow };
}

/**
 * 헤더 위치를 하드코딩하지 않고 헤더 문자열로 컬럼을 찾는다.
 * 병합된 제목행·갱신일자행이 위에 몇 줄 있어도 동작한다.
 */
function findHeaderColumns(worksheet: import('exceljs').Worksheet): {
  headerRow: number;
  columns: Record<FieldKey, number>;
} {
  const scanLimit = Math.min(worksheet.rowCount, 20);
  const entries = Object.entries(IMPORT_HEADERS) as Array<[FieldKey, string]>;
  let best: { row: number; found: Partial<Record<FieldKey, number>>; missing: string[] } | null = null;

  for (let r = 1; r <= scanLimit; r++) {
    const row = worksheet.getRow(r);
    const labels = new Map<string, number>();
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const label = normalizeHeader(cellText(row.getCell(c).value));
      if (label && !labels.has(label)) labels.set(label, c);
    }

    const found: Partial<Record<FieldKey, number>> = {};
    const missing: string[] = [];
    for (const [key, header] of entries) {
      const col = labels.get(normalizeHeader(header));
      if (col) found[key] = col;
      else missing.push(header);
    }

    if (missing.length === 0) {
      assertNoForbiddenColumns(found as Record<FieldKey, number>, labels);
      return { headerRow: r, columns: found as Record<FieldKey, number> };
    }
    if (!best || missing.length < best.missing.length) best = { row: r, found, missing };
  }

  const detail = best
    ? `가장 근접한 행은 ${best.row}행이며, 찾지 못한 헤더: ${best.missing.join(', ')}`
    : '헤더 후보 행을 찾지 못했습니다.';
  throw new Error(
    `헤더를 찾지 못했습니다. 상위 ${scanLimit}행에서 [${Object.values(IMPORT_HEADERS).join(', ')}] 를 모두 찾아야 합니다.\n   ${detail}\n   엑셀 헤더 문구가 바뀌었는지 확인해주세요.`,
  );
}

/** 매핑된 컬럼이 개인정보 컬럼을 가리키면 즉시 중단한다. */
function assertNoForbiddenColumns(columns: Record<FieldKey, number>, labels: Map<string, number>): void {
  const forbiddenColumns = new Map<number, string>();
  for (const header of FORBIDDEN_HEADERS) {
    const col = labels.get(normalizeHeader(header));
    if (col) forbiddenColumns.set(col, header);
  }
  for (const [key, col] of Object.entries(columns) as Array<[FieldKey, number]>) {
    const hit = forbiddenColumns.get(col);
    if (hit) {
      throw new Error(`'${FIELD_LABELS[key]}' 컬럼이 개인정보 컬럼('${hit}')과 같은 위치를 가리킵니다. 헤더 매핑을 확인해주세요.`);
    }
  }
}

/** 헤더는 줄바꿈·공백 표기가 흔들리므로 모든 공백을 제거해 비교한다. */
function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

/** 엑셀 셀은 문자열·수식·서식문자열·하이퍼링크 등 여러 형태로 들어온다. */
function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => cellText((part as Record<string, unknown>).text)).join('');
    }
    if ('text' in record) return cellText(record.text);
    if ('result' in record) return cellText(record.result);
    if ('hyperlink' in record) return cellText(record.hyperlink).replace(/^mailto:/i, '');
  }
  return '';
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cellText(value).trim();
  if (!text) return '';
  const match = text.match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

// ── 데이터 품질 점검 ──

function reportDataQuality(rows: RosterRow[]): void {
  const anonymousDepartment = rows.filter((row) => /^CIC\s*\d+$/i.test(row.department));
  const blankDepartment = rows.filter((row) => !row.department);
  const blankTitle = rows.filter((row) => !row.title);
  const blankNickname = rows.filter((row) => !row.nickname);
  const blankJoinedAt = rows.filter((row) => !row.joinedAt);
  const invalidEmail = rows.filter((row) => !isValidEmail(row.email));

  console.log('\n🔍 명부 품질 점검');
  printCount('소속(중분류)가 CIC 익명 코드', anonymousDepartment.length, rows.length);
  printCount('소속(중분류) 비어있음', blankDepartment.length, rows.length);
  printCount('직책 비어있음', blankTitle.length, rows.length);
  printCount('별명 비어있음', blankNickname.length, rows.length);
  printCount('입사일 비어있음', blankJoinedAt.length, rows.length);
  printCount('이메일 형식 오류', invalidEmail.length, rows.length);

  const duplicates = groupBy(rows.filter((row) => isValidEmail(row.email)), (row) => normalizeEmail(row.email))
    .filter(([, group]) => group.length > 1);
  printCount('이메일 중복', duplicates.length, rows.length, '건');

  const departments = rows.map((row) => row.department).filter(Boolean);

  const variants = detectNamingVariants(departments);
  if (variants.length > 0) {
    console.log('\n⚠️  소속 표기 불일치 (같은 조직이 다르게 적혀 있을 수 있음)');
    for (const group of variants) {
      console.log(`  - ${group.join(' / ')}`);
    }
  }

  const suffixMix = detectSuffixStyleMix(departments);
  if (suffixMix) {
    console.log('\n⚠️  소속 표기 스타일 혼용 (같은 성격의 조직인데 영문/한글 접미사가 섞여 있음)');
    console.log(`  - 영문 'Team': ${suffixMix.english.join(', ')}`);
    console.log(`  - 한글 '팀': ${suffixMix.korean.join(', ')}`);
  }
}

/** 'AXR Team' 과 'AXR팀' 처럼 공백·Team/팀 표기만 다른 값을 묶는다. */
function detectNamingVariants(values: string[]): string[][] {
  const buckets = new Map<string, Set<string>>();
  for (const value of values) {
    const key = value
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/team$/, '팀')
      .replace(/[·・.]/g, '');
    if (!buckets.has(key)) buckets.set(key, new Set());
    buckets.get(key)!.add(value);
  }
  return [...buckets.values()].filter((set) => set.size > 1).map((set) => [...set]);
}

/**
 * 'AXR Team' 과 'EXR팀' 처럼 서로 다른 조직이지만
 * 팀 접미사를 영문/한글로 다르게 적은 경우를 찾는다.
 */
function detectSuffixStyleMix(values: string[]): { english: string[]; korean: string[] } | null {
  const unique = [...new Set(values)];
  const english = unique.filter((value) => /team$/i.test(value.trim()));
  const korean = unique.filter((value) => /팀$/.test(value.trim()));
  return english.length > 0 && korean.length > 0 ? { english, korean } : null;
}

function printCount(label: string, count: number, total: number, unit = '명'): void {
  const mark = count === 0 ? '✅' : '⚠️ ';
  const ratio = total > 0 ? ` (${Math.round((count / total) * 100)}%)` : '';
  console.log(`  ${mark} ${label}: ${count}${unit}${count > 0 ? ratio : ''}`);
}

// ── Firestore 대조 ──

interface ExistingMember {
  docId: string;
  data: Record<string, unknown>;
}

async function loadExistingMembers(
  db: FirestoreDb,
  org: string,
): Promise<Map<string, ExistingMember[]>> {
  const snapshot = await db.collection(`orgs/${org}/members`).get();
  const byEmail = new Map<string, ExistingMember[]>();
  snapshot.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const email = normalizeEmail(typeof data.email === 'string' ? data.email : '');
    if (!email) return;
    const list = byEmail.get(email) || [];
    list.push({ docId: doc.id, data });
    byEmail.set(email, list);
  });
  console.log(`\n📇 기존 구성원: ${snapshot.size}건 (이메일 보유 ${byEmail.size}건)`);
  return byEmail;
}

// One person can hold several member documents: a pre-registration placeholder keyed by
// the email address, and the document created when they first signed in, keyed by their
// Firebase Auth UID. The placeholder points at the real one through `canonicalUid`, so
// follow that link and, failing that, prefer the document that has actually signed in.
// Only what is still ambiguous after both rules is reported for manual review.
function resolveCanonicalMatches(matches: ExistingMember[]): ExistingMember[] {
  if (matches.length < 2) return matches;

  const byDocId = new Map(matches.map((match) => [match.docId, match]));
  const linked = matches
    .map((match) => (typeof match.data.canonicalUid === 'string' ? match.data.canonicalUid : ''))
    .filter((uid) => uid && byDocId.has(uid));
  if (linked.length > 0) {
    const targets = [...new Set(linked)];
    if (targets.length === 1) return [byDocId.get(targets[0])!];
  }

  const signedIn = matches.filter((match) => typeof match.data.lastLoginAt === 'string' && match.data.lastLoginAt);
  if (signedIn.length === 1) return signedIn;

  // Someone who created a second Google account has two documents that both signed in.
  // The one they used most recently is the account they actually work with, so the roster
  // values are written there. The stale document is left untouched for a human to retire.
  if (signedIn.length > 1) {
    const newest = signedIn.reduce((latest, candidate) => (
      String(candidate.data.lastLoginAt) > String(latest.data.lastLoginAt) ? candidate : latest
    ));
    return [newest];
  }

  return matches;
}

function buildPlan(rows: RosterRow[], existing: Map<string, ExistingMember[]>): PlanEntry[] {
  const seen = new Map<string, number>();

  return rows.map((row) => {
    if (!isValidEmail(row.email)) {
      return { action: 'INVALID', row, docId: null, changedFields: [], note: '이메일이 없거나 형식이 올바르지 않음' };
    }

    const email = normalizeEmail(row.email);
    const firstRow = seen.get(email);
    if (firstRow) {
      return { action: 'CONFLICT', row, docId: null, changedFields: [], note: `명부 내 이메일 중복 (${firstRow}행과 동일)` };
    }
    seen.set(email, row.excelRow);

    const matches = resolveCanonicalMatches(existing.get(email) || []);
    if (matches.length > 1) {
      return {
        action: 'CONFLICT',
        row,
        docId: null,
        changedFields: [],
        note: `같은 이메일의 구성원 문서 ${matches.length}건 (${matches.map((m) => m.docId).join(', ')})`,
      };
    }

    const desired = toMemberFields(row);
    if (matches.length === 0) {
      return { action: 'CREATE', row, docId: buildMemberDocId(email), changedFields: Object.keys(desired) as MemberFieldKey[], note: '신규 등록' };
    }

    const target = matches[0];
    const changedFields = (Object.keys(desired) as MemberFieldKey[]).filter(
      (key) => String(target.data[key] ?? '') !== String(desired[key] ?? ''),
    );
    return {
      action: changedFields.length > 0 ? 'UPDATE' : 'UNCHANGED',
      row,
      docId: target.docId,
      changedFields,
      note: changedFields.length > 0 ? changedFields.map((key) => FIELD_LABELS[key]).join(', ') : '변경 없음',
    };
  });
}

/** Firestore에 저장할 필드. 개인정보 항목은 여기에 포함되지 않는다. */
function toMemberFields(row: RosterRow): Partial<Record<MemberFieldKey, string>> {
  const fields: Partial<Record<MemberFieldKey, string>> = {
    // Screens compose the display from nameKo and nickname, which only this import writes.
    // `name` stays in step for anything still reading the combined string, but sign-in
    // paths overwrite it, so it must not be the field screens depend on.
    nameKo: row.name,
    name: row.nickname ? `${row.name}(${row.nickname})` : row.name,
    email: normalizeEmail(row.email),
  };
  if (row.nickname) fields.nickname = row.nickname;
  if (row.departmentTop) fields.departmentTop = row.departmentTop;
  if (row.department) fields.department = row.department;
  if (row.departmentSub) fields.departmentSub = row.departmentSub;
  if (row.employmentNote) fields.employmentNote = row.employmentNote;
  if (row.title) fields.title = row.title;
  if (row.joinedAt) fields.joinedAt = row.joinedAt;
  return fields;
}

function buildMemberDocId(email: string): string {
  return normalizeEmail(email).replace(/[@.]/g, '_');
}

function reportPlan(plan: PlanEntry[]): void {
  const order: PlanAction[] = ['CREATE', 'UPDATE', 'UNCHANGED', 'CONFLICT', 'INVALID'];
  const labels: Record<PlanAction, string> = {
    CREATE: '신규 생성',
    UPDATE: '수정',
    UNCHANGED: '변경 없음',
    CONFLICT: '충돌(수동 확인 필요)',
    INVALID: '무효(가져오기 제외)',
  };

  console.log('\n📊 반영 계획 요약');
  for (const action of order) {
    const count = plan.filter((entry) => entry.action === action).length;
    console.log(`  ${labels[action].padEnd(20, ' ')} ${String(count).padStart(4, ' ')}건`);
  }

  const attention = plan.filter((entry) => entry.action === 'CONFLICT' || entry.action === 'INVALID');
  if (attention.length > 0) {
    console.log('\n🚨 수동 확인이 필요한 행 (개인정보 보호를 위해 엑셀 행 번호만 표시)');
    for (const entry of attention) {
      console.log(`  - ${entry.row.excelRow}행 [${labels[entry.action]}] ${entry.note}`);
    }
  }

  const changed = plan.filter((entry) => entry.action === 'UPDATE');
  if (changed.length > 0) {
    const fieldCounts = new Map<MemberFieldKey, number>();
    for (const entry of changed) {
      for (const key of entry.changedFields) fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
    }
    console.log('\n✏️  변경되는 항목별 인원');
    for (const [key, count] of [...fieldCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${FIELD_LABELS[key]}: ${count}명`);
    }
  }
}

async function applyPlan(
  db: FirestoreDb,
  plan: PlanEntry[],
): Promise<void> {
  const writable = plan.filter((entry) => (entry.action === 'CREATE' || entry.action === 'UPDATE') && entry.docId);
  if (writable.length === 0) {
    console.log('\n✅ 반영할 변경이 없습니다.');
    return;
  }

  console.log(`\n📤 Firestore 반영 시작: ${writable.length}건`);
  const BATCH_SIZE = 400;
  const updatedAt = new Date().toISOString();
  let written = 0;

  for (let i = 0; i < writable.length; i += BATCH_SIZE) {
    const chunk = writable.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const entry of chunk) {
      const ref = db.collection(`orgs/${orgId}/members`).doc(entry.docId!);
      batch.set(ref, { ...toMemberFields(entry.row), orgId, updatedAt }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
  }

  console.log(`✅ 반영 완료: ${written}건`);
}

// ── 공통 유틸 ──

async function loadFirebaseAdmin(): Promise<FirebaseAdmin | null> {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.VITE_FIREBASE_PROJECT_ID;

  const serviceAccountJsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const serviceAccountBase64Raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();

  let serviceAccount: Record<string, unknown> | null = null;
  if (serviceAccountJsonRaw) {
    serviceAccount = JSON.parse(serviceAccountJsonRaw);
  } else if (serviceAccountBase64Raw) {
    serviceAccount = JSON.parse(Buffer.from(serviceAccountBase64Raw, 'base64').toString('utf-8'));
  }

  if (!serviceAccount && !projectId) return null;

  const imported = await import('firebase-admin');
  const admin = ((imported as unknown as { default?: FirebaseAdmin }).default ?? imported) as FirebaseAdmin;
  if (admin.apps.length > 0) return admin;

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as never),
      projectId: projectId || String(serviceAccount.project_id || ''),
    });
  } else {
    admin.initializeApp({ projectId });
  }
  return admin;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()];
}

function loadEnvFiles() {
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
    }
  }
}

function getFlagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
