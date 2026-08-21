#!/usr/bin/env node
// 참여율 공통 입력 템플릿 빌더.
//
// 사업별로 시트를 발급하지 않는다. cashflow 처럼 공통 양식 하나를 복사해서 쓴다.
// 기간은 시트 안에서 입력받는다: B1(시작월)·D1(종료월)을 고르면 월 헤더가 수식으로
// 스스로 생기고, 그 기간 밖의 열은 비어 있다(회색). 과거 값 프리필은 하지 않는다.
//
//   - 월 헤더(2행)가 수식이다: 첫 칸 = 시작월, 다음 칸 = EDATE +1, 종료월에서 멈춘다.
//     파서는 2행의 값만 읽는다. 1행 연도 표시는 사람 보기용이다.
//   - 월 칸에도 수식이 깔려 있다. 기본투입률을 넣으면 투입기간 안의 달이 저절로 채워지고,
//     예외인 달만 덮어쓰면 노랗게(diff), 투입기간 안의 빈칸은 빨갛게(미입력) 표시된다.
//   - 닉네임은 People 참조 탭(숨김) 드롭다운 강제. 이름은 자동으로 붙는다.
//   - 투입시작·종료월 드롭다운의 출처는 월 헤더 행 자신이다 - ①에서 고른 기간 밖은 고를 수 없다.
//
// 반영(불러오기) 때 시트의 기간과 플랫폼의 계약 기간을 대조한다. 시트 입력은 편의이고
// 진실 검증은 플랫폼 몫이다.
//
// 사용: node scripts/build-participation-sheet-template.mjs [--out <dir>]
//       [--firebase-project <id>] [--tenant mysc]   (People 명단을 읽는 데만 쓴다)

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';
import { PARTICIPATION_FORMAT_CURRENT_ID } from '../server/bff/participation-sheet-ranges.mjs';

function flag(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : (process.argv[index + 1] || fallback);
}
const text = (value) => String(value || '').trim();

function columnLetter(index) { // 1-based
  let letters = '';
  while (index > 0) {
    const rem = (index - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    index = Math.floor((index - 1) / 26);
  }
  return letters;
}

const FIXED_HEADERS = ['닉네임', '이름', '역할', '투입시작월', '투입종료월', '기본투입률(%)'];
const FIRST_MONTH_COL = FIXED_HEADERS.length + 1; // G
const MONTH_COLS = 252;      // 최대 21개 연도 범위를 담고, 화면은 선택 연도 12개월만 보여 준다.
const DATA_ROWS = 60;        // 명단 + 교체·재투입용 여유 줄
// 아직 누구인지 모르는 자리. 시트가 플랫폼보다 먼저 만들어지고 매번 갱신되지도 않으므로
// 채용 예정·미배정·확인 중을 한 가지 말로 담는다.
//
// 이름이 적히는 순간 자리표시자가 아니라 실제 사람이다. 닉네임 칸은 미정N 인 채로 두어도
// 되고, 반영은 이름으로 사람을 찾는다. People 등록이 아직이면 연결 대기로 남고 등록 후보
// 목록에 오른다 - 사전 등록을 놓쳐도 되돌아올 길이 있다.
const PLACEHOLDER_KINDS = ['미정'];
const PLACEHOLDER_COUNT = 10;
// 양식 이름·버전. 숨김 참조 탭 F1 에 새겨지고, 반영 파이프라인이 이 값으로 양식을 검증한다.
// 형식이 바뀌면 버전을 올린다 - 옛 복사본은 옛 버전으로 식별되므로 조용히 잘못 읽히지 않는다.
const TEMPLATE_FORMAT_ID = PARTICIPATION_FORMAT_CURRENT_ID;
const SETTING_MONTHS_FROM = 2000;
const SETTING_MONTHS_TO = 2099;

export function buildParticipationSheetWorkbook({ people = [] } = {}) {
  const workbook = new ExcelJS.Workbook();

  // ── 안내 탭 ──
  const guide = workbook.addWorksheet('안내');
  guide.getColumn(1).width = 110;
  const guideLines = [
    ['제목', '참여율 입력 안내 (공통 양식)'],
    ['', ''],
    ['굵게', '시작하기 - 순서 세 번이면 끝납니다'],
    ['', '  ① [참여율 관리] 탭 맨 위에서 계약 시작월·종료월을 고릅니다 → 월 칸이 그 기간만큼 저절로 생깁니다.'],
    ['', '  ② 닉네임을 드롭다운에서 고르고(이름 자동), 투입시작월과 기본투입률(%)을 넣습니다.'],
    ['', '  ③ 기본투입률과 다른 달만 그 칸에 숫자를 덮어씁니다. 다른 칸은 노랗게 표시됩니다.'],
    ['', ''],
    ['굵게', '칸의 세 가지 상태 - 절대 섞이지 않습니다'],
    ['', '  빈칸 = 아직 확인 안 됨(미입력, 빨간 표시로 추적됩니다) · 0 = 확인했고 이 달 참여 없음 · 1~100 = 참여율'],
    ['', '  참여 중인 사람은 참여 없는 달에도 0 을 적습니다. 급여와 연결되므로 "깜빡"과 "없음"을 구분해야 합니다.'],
    ['', ''],
    ['굵게', '사람이 바뀔 때 - 한 줄 = 한 사람의 연속 투입 1회'],
    ['', '  중간 합류        → 새 줄, 투입시작월 = 합류월'],
    ['', '  프로젝트에서 빠짐 → 투입종료월 기입. 지난 값은 지우지 않습니다(급여 이력)'],
    ['', '  교체             → 전임자 종료월 + 후임자 새 줄. 인수인계 달은 둘 다 값이 있어도 됩니다'],
    ['', '  잠깐 쉼(휴직 등)  → 종료월을 쓰지 말고 해당 달에 0'],
    ['', '  나갔다 다시 옴    → 새 줄(같은 사람 두 줄). 단 같은 달에 두 줄 다 값이 있으면 오류입니다'],
    ['', '  역할만 바뀜       → 역할 칸만 고치고 줄은 그대로'],
    ['', '  아직 누구인지 모름 → 닉네임에서 미정-1~10 을 고릅니다. 사람이 정해지면 이름 칸에 실명을'],
    ['', '                      적습니다. 닉네임은 미정인 채로 두어도 됩니다 - 이름이 있으면 됩니다'],
    ['', '  People에 없는 사람 → (신규 입사자·외부 파트너) 닉네임과 이름을 직접 적습니다. 노란 경고가 떠도'],
    ['', '                      진행됩니다. People 등록이 되면 반영할 때 자동으로 연결됩니다'],
    ['', ''],
    ['굵게', '하지 말아야 할 것'],
    ['', '  줄 삭제 · 열 추가/삭제 · 1~2행(머리글) 수정. 양식이 달라지면 반영이 거부됩니다.'],
    ['', '  사업 기간이 바뀌면 플랫폼에서 계약 기간을 먼저 수정합니다. 반영 시 시트 기간과 대조합니다.'],
    ['', ''],
    ['굵게', '칸을 덮어쓴 뒤에 - 되돌리기와 빨간 칸'],
    ['', '  숫자를 적으면 그 칸의 자동 채움 수식이 지워집니다. 정상이며, 손댄 칸은 노랗게 남습니다.'],
    ['', '  기본값으로 되돌리려면: 같은 줄의 노랗지 않은 칸 하나를 복사해 붙여넣으세요. 수식이 자리에'],
    ['', '  맞게 살아납니다. 줄 전체를 덮어썼다면 아래 여유 줄의 아무 칸이나 복사해도 됩니다.'],
    ['', '  진한 빨간 칸 = 투입기간 밖에 남은 옛 값입니다(기간·투입월을 바꾼 뒤 남은 흔적). 지우거나'],
    ['', '  기간을 확인하세요. 이 값이 남아 있으면 반영이 거부됩니다.'],
    ['', ''],
    ['굵게', '기간을 바꿀 때 - 종료월만 바꿉니다'],
    ['', '  연장·단축 → 종료월만 바꾸면 월 칸이 그에 맞춰 늘어나거나 줄어듭니다. 이미 적은 값은 그대로입니다.'],
    ['', '  시작월은 값을 적기 전에 정하고, 그 뒤에는 바꾸지 않습니다 - 바꾸면 이미 적은 값의 달이 한 칸씩'],
    ['', '  어긋납니다(칸은 자리를 지키는데 머리글만 이동). 시작월을 꼭 바꿔야 하면 새 복사본에 옮겨 적습니다.'],
  ];
  for (const [kind, line] of guideLines) {
    const row = guide.addRow([line]);
    if (kind === '제목') row.font = { bold: true, size: 14 };
    if (kind === '굵게') row.font = { bold: true, size: 11 };
  }

  // ── 참조 탭(숨김): People 드롭다운 + 기간 설정용 월 목록 ──
  const ref = workbook.addWorksheet('참조');
  ref.addRow(['닉네임', '이름', '', '월']);
  people.forEach((person, index) => {
    ref.getCell(index + 2, 1).value = person.nickname;
    ref.getCell(index + 2, 2).value = person.name;
  });
  let placeholderRow = people.length + 2;
  for (const kind of PLACEHOLDER_KINDS) {
    for (let index = 1; index <= PLACEHOLDER_COUNT; index += 1) {
      ref.getCell(placeholderRow, 1).value = `${kind}-${index}`;
      placeholderRow += 1;
    }
  }
  let monthRow = 2;
  for (let year = SETTING_MONTHS_FROM; year <= SETTING_MONTHS_TO; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      ref.getCell(monthRow, 4).value = `${year}-${String(month).padStart(2, '0')}`;
      monthRow += 1;
    }
  }
  const nicknameListEnd = placeholderRow - 1;
  const settingMonthsEnd = monthRow - 1;
  ref.getCell(1, 6).value = TEMPLATE_FORMAT_ID;
  ref.state = 'hidden';

  // ── 참여율 관리 탭 ──
  const sheet = workbook.addWorksheet('참여율 관리');
  const lastCol = FIRST_MONTH_COL + MONTH_COLS - 1;
  const lastColLetter = columnLetter(lastCol);
  const firstMonthLetter = columnLetter(FIRST_MONTH_COL);
  const dataStartRow = 3;
  const dataEndRow = dataStartRow + DATA_ROWS - 1;

  // 1행: 기간 설정 + 연도 표시(수식). 여기가 "기간을 입력받으면 시트가 세팅되는" 지점이다.
  sheet.getCell('A1').value = '① 계약 기간';
  sheet.getCell('A1').font = { bold: true };
  sheet.getCell('C1').value = '~';
  sheet.getCell('C1').alignment = { horizontal: 'center' };
  // 살아있는 상태줄. 값(수식 아닌 입력)이 하나라도 생기면 시작월 변경 금지 경고로 바뀐다.
  sheet.getCell('E1').value = {
    formula: `IF(OR($B$1="",$D$1=""),"← 시작월·종료월을 고르면 월 칸이 저절로 생깁니다",`
      + `IF(SUMPRODUCT(--NOT(ISFORMULA(${firstMonthLetter}3:${lastColLetter}62)))>0,`
      + `"⚠ 값을 적은 뒤에는 시작월을 바꾸지 마세요 - 달이 어긋납니다. 연장·단축은 종료월만.",`
      + `"기간 설정됨 - 아래에 명단과 기본투입률을 입력하세요"))`,
  };
  sheet.getCell('E1').font = { size: 9, color: { argb: 'FF64748B' } };
  for (const address of ['B1', 'D1']) {
    sheet.getCell(address).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } };
    sheet.getCell(address).border = { bottom: { style: 'thin' } };
    // 텍스트 서식 고정. 구글 시트는 "2025-07" 입력을 날짜로 바꿔 버리는데, 그러면 텍스트
    // 목록과 달라져 드롭다운으로 고른 값조차 검증에 걸린다(실제 발생). 서식 @ 이 이를 막는다.
    sheet.getCell(address).numFmt = '@';
  }

  // 2행: 고정 열 이름 + 월 헤더(수식). 파서는 이 행만 읽는다.
  FIXED_HEADERS.forEach((header, index) => {
    const cell = sheet.getCell(2, index + 1);
    cell.value = header;
    cell.font = { bold: true };
  });
  for (let index = 0; index < MONTH_COLS; index += 1) {
    const col = FIRST_MONTH_COL + index;
    const letter = columnLetter(col);
    const headerCell = sheet.getCell(2, col);
    headerCell.value = {
      formula: index === 0
        // 시작·종료가 둘 다 있고 순서가 맞아야 첫 달이 나온다. 아니면 전부 빈 채로 남는다.
        ? 'IF(OR($B$1="",$D$1="",$B$1>$D$1),"",$B$1)'
        // 앞 칸이 비었거나 종료월에 닿았으면 멈춘다. YYYY-MM 문자열 비교는 사전순=시간순이다.
        : `IF(${columnLetter(col - 1)}2="","",IF(${columnLetter(col - 1)}2>=$D$1,"",TEXT(EDATE(DATEVALUE(${columnLetter(col - 1)}2&"-01"),1),"YYYY-MM")))`,
    };
    headerCell.font = { bold: true, size: 9 };
    headerCell.alignment = { horizontal: 'center' };
    // 1행 연도 표시: 왼쪽 칸과 연도가 달라지는 첫 달에만 쓴다. 병합 없이 수식으로만.
    const yearCell = sheet.getCell(1, col);
    yearCell.value = {
      formula: `IF(${letter}$2="","",IF(LEFT(${letter}$2,4)<>LEFT(${columnLetter(col - 1)}$2,4),LEFT(${letter}$2,4)&"년",""))`,
    };
    yearCell.font = { bold: true, size: 9 };
  }
  for (let col = 1; col <= lastCol; col += 1) {
    sheet.getCell(2, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F6' } };
  }

  // 데이터 행: 프리필 없음. 이름·월 칸 수식만 전 행에 깔아 둔다.
  for (let row = dataStartRow; row <= dataEndRow; row += 1) {
    sheet.getCell(row, 2).value = {
      formula: `IF($A${row}="","",IFERROR(VLOOKUP($A${row},참조!$A:$B,2,FALSE),""))`,
    };
    for (let index = 0; index < MONTH_COLS; index += 1) {
      const letter = columnLetter(FIRST_MONTH_COL + index);
      sheet.getCell(row, FIRST_MONTH_COL + index).value = {
        formula: `IF(OR(${letter}$2="",$A${row}="",$D${row}="",$F${row}=""),"",IF(${letter}$2<$D${row},"",IF(AND($E${row}<>"",${letter}$2>$E${row}),"",$F${row})))`,
      };
    }
  }

  // 드롭다운
  sheet.dataValidations.add('B1', {
    type: 'list', allowBlank: true, formulae: [`참조!$D$2:$D$${settingMonthsEnd}`],
    showErrorMessage: true, errorTitle: '월을 고르세요', error: '목록에서 YYYY-MM 형식의 월을 고르세요.',
  });
  sheet.dataValidations.add('D1', {
    type: 'list', allowBlank: true, formulae: [`참조!$D$2:$D$${settingMonthsEnd}`],
    showErrorMessage: true, errorTitle: '월을 고르세요', error: '목록에서 YYYY-MM 형식의 월을 고르세요.',
  });
  // 경고(warning)이지 거부(stop)가 아니다. People 에 아직 없는 사람도 급여 기록은 지금
  // 적혀야 한다. 잘못 적힌 이름은 반영 때 "연결 대기" 로 잡히므로 조용히 사라지지 않는다.
  sheet.dataValidations.add(`A${dataStartRow}:A${dataEndRow}`, {
    type: 'list', allowBlank: true, errorStyle: 'warning', formulae: [`참조!$A$2:$A$${nicknameListEnd}`],
    showErrorMessage: true, errorTitle: 'People에 없는 이름이에요',
    error: '그대로 진행해도 됩니다 - 이름 칸에 실명을 적어 주세요. People 등록이 되면 반영할 때 자동으로 연결됩니다. 아직 누구인지 모르면 미정-1~10 을 고르고, 사람이 정해지면 이름만 채우면 됩니다.',
  });
  // 투입월 드롭다운의 출처는 월 헤더 행 자신 - ①에서 고른 기간 밖은 목록에 없다.
  sheet.dataValidations.add(`D${dataStartRow}:E${dataEndRow}`, {
    type: 'list', allowBlank: true, formulae: [`$${firstMonthLetter}$2:$${lastColLetter}$2`],
    showErrorMessage: true, errorTitle: '계약 기간 안의 월만',
    error: '①에서 고른 계약 기간 안의 월만 고를 수 있습니다.',
  });
  sheet.dataValidations.add(`F${dataStartRow}:F${dataEndRow}`, {
    type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 100],
    showErrorMessage: true, errorTitle: '0~100', error: '참여율은 0~100 사이 숫자입니다.',
  });
  sheet.dataValidations.add(`${firstMonthLetter}${dataStartRow}:${lastColLetter}${dataEndRow}`, {
    type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 100],
    showErrorMessage: true, errorTitle: '0~100', error: '참여율은 0~100 사이 숫자입니다.',
  });

  // 조건부 서식: 회색 = 기간 밖(헤더 없음) · 빨강 = 투입기간 안의 미입력 · 노랑 = 기본과 다른 값(diff)
  const A = `$A${dataStartRow}`; const D = `$D${dataStartRow}`; const E = `$E${dataStartRow}`;
  const CELL = `${firstMonthLetter}${dataStartRow}`; const HDR = `${firstMonthLetter}$2`;
  sheet.addConditionalFormatting({
    ref: `${firstMonthLetter}${dataStartRow}:${lastColLetter}${dataEndRow}`,
    rules: [
      // ① 고아 값(최우선): 값이 있는데 헤더 밖이거나 투입기간 밖. 수식 칸은 그런 자리에서
      //    스스로 비워지므로 이 규칙에 걸리는 것은 하드코딩 잔재뿐이다. 기간·투입월을 바꾼 뒤
      //    남은 옛 값이 즉시 진한 빨강으로 드러난다. 반영도 이 값을 거부한다(이중 방어).
      {
        type: 'expression', priority: 1,
        formulae: [`AND(${CELL}<>"",OR(${HDR}="",${D}="",AND(${D}<>"",${HDR}<${D}),AND(${E}<>"",${HDR}>${E})))`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFCA5A5' } } },
      },
      {
        type: 'expression', priority: 2,
        formulae: [`${HDR}=""`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF1F5F9' } } },
      },
      {
        type: 'expression', priority: 3,
        formulae: [`AND(${HDR}<>"",${A}<>"",${D}<>"",${HDR}>=${D},OR(${E}="",${HDR}<=${E}),${CELL}="")`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDE0E0' } } },
      },
      // ④ diff 를 값 비교가 아니라 수식 여부(ISFORMULA)로 표시한다. 하드코딩한 칸은 값이
      //    기본과 같아도 노랗다 - "수식이 깨진 곳" 지도와 "사람이 손댄 곳" 지도가 같아진다.
      {
        type: 'expression', priority: 4,
        formulae: [`AND(${CELL}<>"",NOT(ISFORMULA(${CELL})))`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF3C4' } } },
      },
    ],
  });

  // 투입시작·종료월 열도 텍스트 서식 고정 - 위 B1/D1 과 같은 날짜 변환 문제를 막는다.
  for (let row = dataStartRow; row <= dataEndRow; row += 1) {
    sheet.getCell(row, 4).numFmt = '@';
    sheet.getCell(row, 5).numFmt = '@';
  }

  sheet.views = [{ state: 'frozen', xSplit: FIXED_HEADERS.length, ySplit: 2 }];
  const widths = [12, 10, 16, 12, 12, 13];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (let col = FIRST_MONTH_COL; col <= lastCol; col += 1) sheet.getColumn(col).width = 8.5;

  return workbook;
}

async function main() {
  const firebaseProjectId = flag('--firebase-project', resolveProjectId());
  const tenantId = flag('--tenant', 'mysc');
  const outDir = flag('--out', '.');
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const peopleSnap = await db.collection(`orgs/${tenantId}/persons`).get();
  const people = peopleSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .map((person) => ({ nickname: text(person.nickname), name: text(person.name) }))
    .filter((person) => person.nickname)
    .sort((left, right) => left.nickname.localeCompare(right.nickname, 'ko'));
  const workbook = buildParticipationSheetWorkbook({ people });

  mkdirSync(outDir, { recursive: true });
  const filePath = join(outDir, 'MYSC_참여율_표준양식_v2.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log(JSON.stringify({
    file: filePath, format: TEMPLATE_FORMAT_ID, monthColumns: MONTH_COLS, dataRows: DATA_ROWS, people: people.length,
  }, null, 2));
}

export function isDirectRun(moduleUrl, entrypoint) {
  return Boolean(entrypoint) && moduleUrl === pathToFileURL(entrypoint).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error) => { console.error(error?.stack || String(error)); process.exit(1); });
}
