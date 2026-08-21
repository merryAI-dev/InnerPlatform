/**
 * MYSC 참여율 표준양식 관리 스크립트 (MYSC-PARTICIPATION-V1)
 *
 * 원본(마스터) 구글 시트에 한 번 붙여넣는다: 확장 프로그램 > Apps Script > 코드 붙여넣기 > 저장.
 * 사본을 만들면 스크립트와 보호 범위가 함께 복사된다. 외부 호출은 없다 - 이 시트 안에서만 동작한다.
 *
 * 주는 것:
 *   1) 메뉴 "MYSC 양식 > 보호 걸기"  - 1~2행(헤더)과 참조 탭을 경고 모드로 보호.
 *      실수 편집(정렬·행삽입·헤더 수정)에 경고가 뜬다. 관리자는 계속 진행할 수 있다.
 *   2) 메뉴 "MYSC 양식 > 선택 칸 수식 복구" - 덮어쓰거나 지워진 월 칸·이름 칸의 수식을
 *      표준양식 원래 수식으로 되살린다. "옆 칸 복사" 를 사람이 안 해도 된다.
 *
 * 하지 않는 것: 자동 복구(onEdit). 값 덮어쓰기는 diff 메커니즘 그 자체라서, 손대는 순간
 * 되돌리는 자동화는 입력을 방해한다. 복구는 사람이 메뉴로 명시적으로 한다.
 */

var SHEET_NAME = '참여율';
var REF_SHEET_NAME = '참조';
var FIRST_MONTH_COL = 7;   // G
var LAST_MONTH_COL = 126;  // DV (120개월)
var DATA_START_ROW = 3;
var DATA_END_ROW = 62;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('MYSC 양식')
    .addItem('선택 칸 수식 복구', 'restoreFormulasInSelection')
    .addItem('보호 걸기 (헤더·참조 탭)', 'setupProtections')
    .addToUi();
}

/** 표준양식의 월 칸 수식. 템플릿 빌더(build-participation-sheet-template.mjs)와 같은 식이어야 한다. */
function monthCellFormula(row, colLetter) {
  return '=IF(OR(' + colLetter + '$2="",$A' + row + '="",$D' + row + '="",$F' + row + '=""),"",'
    + 'IF(' + colLetter + '$2<$D' + row + ',"",'
    + 'IF(AND($E' + row + '<>"",' + colLetter + '$2>$E' + row + '),"",$F' + row + ')))';
}

function nameCellFormula(row) {
  return '=IF($A' + row + '="","",IFERROR(VLOOKUP($A' + row + ',' + REF_SHEET_NAME + '!$A:$B,2,FALSE),""))';
}

function columnLetter(column) {
  var letters = '';
  while (column > 0) {
    var rem = (column - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    column = Math.floor((column - 1) / 26);
  }
  return letters;
}

/**
 * 선택 영역 중 데이터 영역(월 칸 G3:DV62, 이름 칸 B3:B62)에 대해 수식을 되살린다.
 * 값이 들어 있는 칸은 묻는다 - diff 로 남긴 값을 조용히 지우면 안 된다.
 */
function restoreFormulasInSelection() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var ranges = SpreadsheetApp.getActiveRangeList();
  if (!sheet || !ranges) { ui.alert('참여율 탭에서 복구할 칸을 선택한 뒤 실행해 주세요.'); return; }

  var targets = [];   // {row, col} - 수식이 아닌(깨진) 칸만
  var withValues = 0; // 그중 값이 들어 있는 칸(diff 후보)
  ranges.getRanges().forEach(function (range) {
    if (range.getSheet().getName() !== SHEET_NAME) return;
    for (var row = range.getRow(); row < range.getRow() + range.getNumRows(); row++) {
      if (row < DATA_START_ROW || row > DATA_END_ROW) continue;
      for (var col = range.getColumn(); col < range.getColumn() + range.getNumColumns(); col++) {
        var isMonth = col >= FIRST_MONTH_COL && col <= LAST_MONTH_COL;
        if (!isMonth && col !== 2) continue;
        var cell = sheet.getRange(row, col);
        if (cell.getFormula()) continue; // 성한 수식은 건드리지 않는다
        targets.push({ row: row, col: col });
        if (cell.getValue() !== '') withValues++;
      }
    }
  });
  if (targets.length === 0) { ui.alert('선택 영역에 복구할 칸이 없습니다 (수식이 모두 성합니다).'); return; }

  if (withValues > 0) {
    var answer = ui.alert(
      '값이 들어 있는 칸 ' + withValues + '개 포함',
      '복구하면 그 값(직접 적은 diff)이 지워지고 기본투입률 자동 채움으로 돌아갑니다.\n'
        + '값 없는 깨진 칸 ' + (targets.length - withValues) + '개는 그대로 복구됩니다.\n\n계속할까요?',
      ui.ButtonSet.OK_CANCEL
    );
    if (answer !== ui.Button.OK) return;
  }

  targets.forEach(function (target) {
    var formula = target.col === 2
      ? nameCellFormula(target.row)
      : monthCellFormula(target.row, columnLetter(target.col));
    sheet.getRange(target.row, target.col).setFormula(formula);
  });
  ui.alert('수식 ' + targets.length + '개를 복구했습니다.');
}

/** 헤더(1~2행)와 참조 탭을 경고 모드로 보호한다. 여러 번 실행해도 안전하다(기존 보호 재사용). */
function setupProtections() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  var refSheet = spreadsheet.getSheetByName(REF_SHEET_NAME);
  if (!sheet) { SpreadsheetApp.getUi().alert('참여율 탭이 없습니다. 표준양식이 맞는지 확인해 주세요.'); return; }

  var headerRange = sheet.getRange('1:2');
  var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .some(function (protection) { return protection.getRange().getA1Notation() === headerRange.getA1Notation(); });
  if (!existing) {
    headerRange.protect()
      .setDescription('머리글 - 수정하면 반영이 거부됩니다')
      .setWarningOnly(true);
  }
  if (refSheet) {
    var refProtected = refSheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length > 0;
    if (!refProtected) {
      refSheet.protect()
        .setDescription('참조 탭 - People 명단과 양식 식별자')
        .setWarningOnly(true);
    }
  }
  SpreadsheetApp.getUi().alert('보호를 걸었습니다 (경고 모드 - 관리자는 계속 진행할 수 있습니다).');
}
