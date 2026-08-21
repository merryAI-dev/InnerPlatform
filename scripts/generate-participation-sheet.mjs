#!/usr/bin/env node
// 사업별 참여율 입력 시트 생성기.
//
// 플랫폼(계약 기간·팀원·People)을 읽어 그 사업 전용 .xlsx 를 만든다. 시트가 SaaS 처럼 동작한다:
//   - 월 열은 계약 기간에서 생성된다. 단년 사업은 12열, 다년 사업은 그만큼. 탭 분기가 없다.
//   - 월 칸에는 수식이 깔려 있다. 기본투입률을 넣으면 투입기간 안의 달이 저절로 채워진다.
//     예외인 달만 숫자로 덮어쓰면 그게 diff 이고, 조건부 서식이 노랗게 표시한다.
//   - 닉네임은 People 참조 탭 드롭다운에서만 고른다(하드코딩 방지). 이름은 자동으로 붙는다.
//   - 투입기간 안의 빈칸은 빨갛게 표시된다(미입력 추적). 빈칸=미입력, 0=확인된 미참여.
//
// 파서는 2행(YYYY-MM)만 읽는다. 1행 연도 병합은 사람 보기용 장식이다.
//
// 사용: node scripts/generate-participation-sheet.mjs --project <projectId> [--out <dir>]
//       [--firebase-project <id>] [--tenant mysc]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';

function flag(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : (process.argv[index + 1] || fallback);
}
const text = (value) => String(value || '').trim();

/** 계약 시작~종료월의 YYYY-MM 목록. 시트의 월 열이 곧 이 목록이다. */
function monthRange(startMonth, endMonth) {
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth) || startMonth > endMonth) return [];
  const months = [];
  let [year, month] = startMonth.split('-').map(Number);
  while (true) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key === endMonth) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

function columnLetter(index) { // 1-based
  let letters = '';
  while (index > 0) {
    const rem = (index - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    index = Math.floor((index - 1) / 26);
  }
  return letters;
}

const firebaseProjectId = flag('--firebase-project', resolveProjectId());
const tenantId = flag('--tenant', 'mysc');
const projectId = flag('--project');
const outDir = flag('--out', '.');
if (!projectId) { console.error('--project <projectId> 가 필요합니다.'); process.exit(1); }

const FIXED_HEADERS = ['닉네임', '이름', '역할', '투입시작월', '투입종료월', '기본투입률(%)'];
const FIRST_MONTH_COL = FIXED_HEADERS.length + 1; // G
const SPARE_ROWS = 15;   // 중간 합류·교체·재투입용 여유 줄 (수식·드롭다운이 미리 깔려 있다)
const PLACEHOLDER_COUNT = 5; // 채용예정-N — People 미연결이 허용되는 유일한 이름

async function main() {
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const [projectSnap, peopleSnap] = await Promise.all([
    db.doc(`orgs/${tenantId}/projects/${projectId}`).get(),
    db.collection(`orgs/${tenantId}/persons`).get(),
  ]);
  if (!projectSnap.exists) { console.error(`프로젝트 없음: ${projectId}`); process.exit(1); }
  const project = projectSnap.data() || {};
  const projectName = text(project.name) || projectId;
  const startMonth = text(project.contractStart).slice(0, 7);
  const endMonth = text(project.contractEnd).slice(0, 7);
  const months = monthRange(startMonth, endMonth);
  if (!months.length) {
    console.error(`계약 기간이 없거나 잘못됨: ${startMonth}~${endMonth}. 플랫폼에서 계약 기간을 먼저 저장해 주세요.`);
    process.exit(1);
  }

  const people = peopleSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .map((person) => ({ nickname: text(person.nickname), name: text(person.name) }))
    .filter((person) => person.nickname)
    .sort((left, right) => left.nickname.localeCompare(right.nickname, 'ko'));

  const roster = (Array.isArray(project.teamMembersDetailed) ? project.teamMembersDetailed : [])
    .map((member) => ({
      nickname: text(member.memberNickname) || text(member.memberName),
      role: text(member.role),
      allocationStart: text(member.laborAllocationStartMonth),
      allocationEnd: text(member.laborAllocationEndMonth),
    }));

  const workbook = new ExcelJS.Workbook();

  // ── 안내 탭: 입력하는 사람이 보는 규칙 = 기계가 검증하는 규칙 ──
  const guide = workbook.addWorksheet('안내');
  guide.getColumn(1).width = 110;
  const guideLines = [
    ['제목', `${projectName} 참여율 입력 안내`],
    ['', ''],
    ['굵게', '칸의 세 가지 상태 - 절대 섞이지 않습니다'],
    ['', '  빈칸 = 아직 확인 안 됨(미입력, 빨간 표시로 추적됩니다) · 0 = 확인했고 이 달 참여 없음 · 1~100 = 참여율'],
    ['', '  참여 중인 사람은 참여 없는 달에도 0 을 적습니다. 급여와 연결되므로 "깜빡"과 "없음"을 구분해야 합니다.'],
    ['', ''],
    ['굵게', '입력 방법 - 대부분 자동입니다'],
    ['', '  1) 닉네임을 드롭다운에서 고르면 이름이 자동으로 붙습니다. 직접 타이핑은 막혀 있습니다.'],
    ['', '  2) 투입시작월·투입종료월을 드롭다운에서 고릅니다. 진행 중이면 종료월은 비워 둡니다.'],
    ['', '  3) 기본투입률(%)을 넣으면 투입기간 안의 달이 전부 그 값으로 채워집니다. 드래그가 필요 없습니다.'],
    ['', '  4) 특정 달만 다르면 그 칸에 숫자를 덮어씁니다. 기본값과 다른 칸은 노랗게 표시됩니다.'],
    ['', ''],
    ['굵게', '사람이 바뀔 때 - 한 줄 = 한 사람의 연속 투입 1회'],
    ['', '  중간 합류        → 새 줄, 투입시작월 = 합류월'],
    ['', '  프로젝트에서 빠짐 → 투입종료월 기입. 지난 값은 지우지 않습니다(급여 이력)'],
    ['', '  교체             → 전임자 종료월 + 후임자 새 줄. 인수인계 달은 둘 다 값이 있어도 됩니다'],
    ['', '  잠깐 쉼(휴직 등)  → 종료월을 쓰지 말고 해당 달에 0'],
    ['', '  나갔다 다시 옴    → 새 줄(같은 사람 두 줄). 단 같은 달에 두 줄 다 값이 있으면 오류입니다'],
    ['', '  역할만 바뀜       → 역할 칸만 고치고 줄은 그대로'],
    ['', '  아직 채용 전 자리 → 닉네임에서 채용예정-1~5 를 고릅니다. 채용되면 실제 사람으로 바꿉니다'],
    ['', ''],
    ['굵게', '하지 말아야 할 것'],
    ['', '  줄 삭제 · 열 추가/삭제 · 1~2행(머리글) 수정. 양식이 달라지면 반영이 거부됩니다.'],
    ['', '  사업 기간이 바뀌면 플랫폼에서 계약 기간을 먼저 수정한 뒤 시트를 다시 받습니다.'],
  ];
  for (const [kind, line] of guideLines) {
    const row = guide.addRow([line]);
    if (kind === '제목') row.font = { bold: true, size: 14 };
    if (kind === '굵게') row.font = { bold: true, size: 11 };
  }

  // ── 참조 탭(숨김): 드롭다운의 출처. People 이 신원의 유일한 권위다 ──
  const ref = workbook.addWorksheet('참조');
  ref.addRow(['닉네임', '이름', '', '월']);
  people.forEach((person, index) => {
    ref.getCell(index + 2, 1).value = person.nickname;
    ref.getCell(index + 2, 2).value = person.name;
  });
  for (let index = 1; index <= PLACEHOLDER_COUNT; index += 1) {
    ref.getCell(people.length + 1 + index, 1).value = `채용예정-${index}`;
  }
  months.forEach((month, index) => { ref.getCell(index + 2, 4).value = month; });
  const nicknameListEnd = people.length + 1 + PLACEHOLDER_COUNT;
  const monthListEnd = months.length + 1;
  ref.state = 'hidden';

  // ── 참여율 탭 ──
  const sheet = workbook.addWorksheet('참여율');
  const lastCol = FIRST_MONTH_COL + months.length - 1;
  const dataStartRow = 3;
  const dataEndRow = dataStartRow + roster.length + SPARE_ROWS - 1;

  // 1행: 연도 병합(사람 보기용). 2행: 열 이름 + YYYY-MM(기계용 - 파서는 이 행만 읽는다).
  sheet.mergeCells(1, 1, 1, FIXED_HEADERS.length);
  sheet.getCell(1, 1).value = `${projectName} 참여율 (계약 ${startMonth} ~ ${endMonth})`;
  sheet.getCell(1, 1).font = { bold: true };
  let yearBlockStart = FIRST_MONTH_COL;
  for (let index = 0; index < months.length; index += 1) {
    const isLast = index === months.length - 1;
    const year = months[index].slice(0, 4);
    const nextYear = isLast ? '' : months[index + 1].slice(0, 4);
    if (isLast || year !== nextYear) {
      const col = FIRST_MONTH_COL + index;
      sheet.mergeCells(1, yearBlockStart, 1, col);
      const cell = sheet.getCell(1, yearBlockStart);
      cell.value = `${year}년`;
      cell.alignment = { horizontal: 'center' };
      cell.font = { bold: true };
      yearBlockStart = col + 1;
    }
  }
  FIXED_HEADERS.forEach((header, index) => {
    const cell = sheet.getCell(2, index + 1);
    cell.value = header;
    cell.font = { bold: true };
  });
  months.forEach((month, index) => {
    const cell = sheet.getCell(2, FIRST_MONTH_COL + index);
    cell.value = month;
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: 'center' };
  });
  for (let col = 1; col <= lastCol; col += 1) {
    sheet.getCell(2, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F6' } };
  }

  // 데이터 행: 명단 미리 채움 + 여유 줄. 이름·월 칸은 전 행에 수식이 깔린다.
  for (let row = dataStartRow; row <= dataEndRow; row += 1) {
    const member = roster[row - dataStartRow];
    if (member) {
      sheet.getCell(row, 1).value = member.nickname;
      sheet.getCell(row, 3).value = member.role;
      if (member.allocationStart) sheet.getCell(row, 4).value = member.allocationStart;
      if (member.allocationEnd) sheet.getCell(row, 5).value = member.allocationEnd;
    }
    sheet.getCell(row, 2).value = {
      formula: `IF($A${row}="","",IFERROR(VLOOKUP($A${row},참조!$A:$B,2,FALSE),""))`,
    };
    for (let index = 0; index < months.length; index += 1) {
      const col = columnLetter(FIRST_MONTH_COL + index);
      // 사람·시작월·기본투입률이 있고, 이 달이 투입기간 안이면 기본투입률. 아니면 빈칸.
      sheet.getCell(row, FIRST_MONTH_COL + index).value = {
        formula: `IF(OR($A${row}="",$D${row}="",$F${row}=""),"",IF(${col}$2<$D${row},"",IF(AND($E${row}<>"",${col}$2>$E${row}),"",$F${row})))`,
      };
    }
  }

  // 드롭다운. 닉네임은 목록 강제(하드코딩 방지), 월은 계약 기간 안에서만.
  sheet.dataValidations.add(`A${dataStartRow}:A${dataEndRow}`, {
    type: 'list', allowBlank: true, formulae: [`참조!$A$2:$A$${nicknameListEnd}`],
    showErrorMessage: true, errorTitle: '드롭다운에서 골라 주세요',
    error: 'People에 등록된 사람만 넣을 수 있습니다. 없는 사람은 People 등록 후, 채용 전 자리는 채용예정-N 을 쓰세요.',
  });
  sheet.dataValidations.add(`D${dataStartRow}:E${dataEndRow}`, {
    type: 'list', allowBlank: true, formulae: [`참조!$D$2:$D$${monthListEnd}`],
    showErrorMessage: true, errorTitle: '계약 기간 안의 월만',
    error: `이 사업의 계약 기간(${startMonth}~${endMonth}) 안의 월만 고를 수 있습니다.`,
  });
  const firstMonthLetter = columnLetter(FIRST_MONTH_COL);
  const lastColLetter = columnLetter(lastCol);
  sheet.dataValidations.add(`F${dataStartRow}:F${dataEndRow}`, {
    type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 100],
    showErrorMessage: true, errorTitle: '0~100', error: '참여율은 0~100 사이 숫자입니다.',
  });
  sheet.dataValidations.add(`${firstMonthLetter}${dataStartRow}:${lastColLetter}${dataEndRow}`, {
    type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 100],
    showErrorMessage: true, errorTitle: '0~100', error: '참여율은 0~100 사이 숫자입니다.',
  });

  // 조건부 서식. 빨강 = 투입기간 안의 미입력(추적 대상). 노랑 = 기본투입률과 다른 값(diff).
  sheet.addConditionalFormatting({
    ref: `${firstMonthLetter}${dataStartRow}:${lastColLetter}${dataEndRow}`,
    rules: [
      {
        type: 'expression', priority: 1,
        formulae: [`AND($A${dataStartRow}<>"",$D${dataStartRow}<>"",${firstMonthLetter}$2>=$D${dataStartRow},OR($E${dataStartRow}="",${firstMonthLetter}$2<=$E${dataStartRow}),${firstMonthLetter}${dataStartRow}="")`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDE0E0' } } },
      },
      {
        type: 'expression', priority: 2,
        formulae: [`AND(${firstMonthLetter}${dataStartRow}<>"",$F${dataStartRow}<>"",${firstMonthLetter}${dataStartRow}<>$F${dataStartRow})`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF3C4' } } },
      },
    ],
  });

  sheet.views = [{ state: 'frozen', xSplit: FIXED_HEADERS.length, ySplit: 2 }];
  const widths = [12, 10, 16, 12, 12, 13];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (let col = FIRST_MONTH_COL; col <= lastCol; col += 1) sheet.getColumn(col).width = 8.5;

  mkdirSync(outDir, { recursive: true });
  const safeName = projectName.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  const filePath = join(outDir, `참여율_${safeName}_${startMonth}_${endMonth}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  console.log(JSON.stringify({
    file: filePath, project: projectName, months: months.length,
    roster: roster.length, spareRows: SPARE_ROWS, people: people.length,
  }, null, 2));
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exit(1); });
