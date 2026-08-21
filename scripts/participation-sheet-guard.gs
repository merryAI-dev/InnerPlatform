/**
 * MYSC 참여율 표준양식 관리 스크립트 (MYSC-PARTICIPATION-V1)
 *
 * 공용 원본 시트에 붙여넣는다.
 * 사본을 만들면 스크립트와 보호가 함께 복사된다.
 * 외부 호출 없음 - 이 시트 안에서만 동작한다.
 *
 * 트리거
 *   onOpen   (자동)      메뉴 생성
 *   onEdit   (자동)      시작월 변경 경고, 머리글 편집 경고
 *   onChange (설치 필요)  행/열 삽입 삭제 감지 - 메뉴에서 한 번 설치
 */

var SHEET_NAME = '참여율';
var REF_SHEET_NAME = '참조';
var FORMAT_ID = 'MYSC-PARTICIPATION-V1';
var FIRST_MONTH_COL = 7;
var MONTH_COL_COUNT = 120;
var DATA_START_ROW = 3;
var DATA_ROW_COUNT = 60;

function onOpen() {
  var menu = SpreadsheetApp.getUi().createMenu('MYSC 양식');
  menu.addItem('입력 상태 점검', 'checkSheetStatus');
  menu.addItem('선택 칸 수식 복구', 'restoreFormulasInSelection');
  menu.addSeparator();
  menu.addItem('보호 걸기', 'setupProtections');
  menu.addItem('트리거 설치', 'installTriggers');
  menu.addToUi();
}

/**
 * 시작월 변경과 머리글 편집만 잡는다.
 * 월 칸 덮어쓰기는 건드리지 않는다 - 그것이 diff 그 자체다.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  var app = SpreadsheetApp.getActiveSpreadsheet();
  var a1 = e.range.getA1Notation();

  if (a1 === 'B1' && countHardcodedCells_(sheet) > 0) {
    app.toast(
      '이미 적은 값이 있습니다. 시작월을 바꾸면 그 값들의 달이 어긋납니다. '
        + '되돌리거나, 연장 단축이면 종료월만 바꾸세요.',
      '시작월 변경 주의',
      30
    );
    return;
  }

  if (e.range.getRow() <= 2 && a1 !== 'B1' && a1 !== 'D1') {
    app.toast(
      '1~2행은 머리글입니다. 수정하면 반영이 거부됩니다. 되돌려 주세요.',
      '머리글 수정 주의',
      30
    );
  }
}

/** 행/열 삽입 삭제 감지. 설치형 트리거다. */
function onChange(e) {
  if (!e) return;
  var kinds = ['INSERT_ROW', 'REMOVE_ROW'];
  kinds.push('INSERT_COLUMN');
  kinds.push('REMOVE_COLUMN');
  if (kinds.indexOf(e.changeType) < 0) return;
  SpreadsheetApp.getActiveSpreadsheet().toast(
    '행이나 열을 넣거나 지우면 좌표가 어긋나 반영이 거부됩니다. '
      + '되돌려 주세요. 사람을 더 넣으려면 아래 빈 줄을 쓰세요.',
    '구조 변경 주의',
    30
  );
}

/** onChange 설치. 중복 설치를 막는다. */
function installTriggers() {
  var ui = SpreadsheetApp.getUi();
  var app = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onChange') {
      ui.alert('이미 설치되어 있습니다.');
      return;
    }
  }
  ScriptApp.newTrigger('onChange').forSpreadsheet(app).onChange().create();
  ui.alert('설치 완료. 행이나 열을 넣고 지울 때 경고가 뜹니다.');
}

/**
 * 반영 파이프라인이 볼 것을 시트 안에서 미리 보여준다.
 */
function checkSheetStatus() {
  var ui = SpreadsheetApp.getUi();
  var app = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = app.getSheetByName(SHEET_NAME);
  var refSheet = app.getSheetByName(REF_SHEET_NAME);
  if (!sheet) {
    ui.alert('참여율 탭이 없습니다. 표준양식이 맞는지 확인해 주세요.');
    return;
  }

  var formatId = '';
  if (refSheet) {
    formatId = String(refSheet.getRange('F1').getValue() || '').trim();
  }
  var startCell = sheet.getRange('B1').getDisplayValue();
  var endCell = sheet.getRange('D1').getDisplayValue();
  var startMonth = String(startCell || '').trim();
  var endMonth = String(endCell || '').trim();
  if (!startMonth || !endMonth) {
    ui.alert('먼저 맨 위에서 계약 시작월과 종료월을 골라 주세요.');
    return;
  }

  var headerRange = sheet.getRange(2, FIRST_MONTH_COL, 1, MONTH_COL_COUNT);
  var headers = headerRange.getDisplayValues()[0];
  var metaRange = sheet.getRange(DATA_START_ROW, 1, DATA_ROW_COUNT, 6);
  var meta = metaRange.getDisplayValues();
  var body = sheet.getRange(
    DATA_START_ROW, FIRST_MONTH_COL, DATA_ROW_COUNT, MONTH_COL_COUNT
  );
  var values = body.getDisplayValues();
  var formulas = body.getFormulas();
  var known = knownNicknames_(refSheet);

  var missing = 0;
  var orphan = 0;
  var hardcoded = 0;
  var filledRows = 0;
  var pendingLink = [];
  var noStart = [];
  var badOrder = [];

  for (var r = 0; r < DATA_ROW_COUNT; r++) {
    var nickname = String(meta[r][0] || '').trim();
    var stintStart = String(meta[r][3] || '').trim();
    var stintEnd = String(meta[r][4] || '').trim();
    var rowNumber = DATA_START_ROW + r;

    for (var c = 0; c < MONTH_COL_COUNT; c++) {
      var header = String(headers[c] || '').trim();
      var raw = String(values[r][c] || '').trim();
      var hasValue = raw !== '';
      if (hasValue && !formulas[r][c]) hardcoded++;

      var outside = !header || !stintStart || header < stintStart;
      if (!outside && stintEnd && header > stintEnd) outside = true;

      if (hasValue && outside) {
        orphan++;
      } else if (!hasValue && !outside && nickname && stintStart) {
        missing++;
      }
    }

    if (!nickname) continue;
    filledRows++;
    if (!stintStart) noStart.push(rowNumber);
    if (stintStart && stintEnd && stintStart > stintEnd) {
      badOrder.push(rowNumber);
    }
    // 이름이 없는 미정N 만 자리표시자다. 이름이 붙으면 실제 사람이므로 연결 대기로 센다.
    var name = String(meta[r][1] || '').trim();
    var isPlaceholder = !name
      && (nickname.indexOf('미정') === 0 || nickname.indexOf('채용예정') === 0);
    if (known.length && !isPlaceholder && known.indexOf(nickname) < 0) {
      pendingLink.push(nickname + '(' + rowNumber + '행)');
    }
  }

  var lines = [];
  if (formatId === FORMAT_ID) {
    lines.push('양식: ' + FORMAT_ID);
  } else {
    lines.push('[주의] 양식 식별자 불일치: ' + (formatId || '없음'));
  }
  lines.push('기간: ' + startMonth + ' ~ ' + endMonth);
  lines.push('입력된 줄: ' + filledRows + '개');
  lines.push('');
  lines.push('미입력(투입기간 안 빈칸): ' + missing + '칸');
  lines.push('기간 밖 남은 값: ' + orphan + '칸');
  lines.push('직접 적은 칸(노랑): ' + hardcoded + '칸');
  if (noStart.length) {
    lines.push('[주의] 투입시작월 없음: ' + noStart.join(', ') + '행');
  }
  if (badOrder.length) {
    lines.push('[주의] 시작월이 뒤: ' + badOrder.join(', ') + '행');
  }
  if (pendingLink.length) {
    lines.push('');
    lines.push('People 연결 대기 ' + pendingLink.length + '명');
    lines.push(pendingLink.slice(0, 10).join(', '));
    lines.push('그대로 반영해도 됩니다.');
    lines.push('People 등록이 되면 자동 연결됩니다.');
  }
  ui.alert('입력 상태 점검', lines.join('\n'), ui.ButtonSet.OK);
}

/** 표준양식 월 칸 수식. 템플릿 빌더와 같은 식이어야 한다. */
function monthCellFormula_(row, colLetter) {
  var head = colLetter + '$2';
  return '=IF(OR(' + head + '="",$A' + row + '="",$D' + row + '="",$F'
    + row + '=""),"",IF(' + head + '<$D' + row + ',"",IF(AND($E' + row
    + '<>"",' + head + '>$E' + row + '),"",$F' + row + ')))';
}

function nameCellFormula_(row) {
  return '=IF($A' + row + '="","",IFERROR(VLOOKUP($A' + row + ','
    + REF_SHEET_NAME + '!$A:$B,2,FALSE),""))';
}

/**
 * 선택 영역에서 수식이 사라진 칸만 되살린다.
 * 값이 든 칸은 지우기 전에 묻는다.
 */
function restoreFormulasInSelection() {
  var ui = SpreadsheetApp.getUi();
  var app = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = app.getSheetByName(SHEET_NAME);
  var rangeList = app.getActiveRangeList();
  if (!sheet || !rangeList) {
    ui.alert('참여율 탭에서 복구할 칸을 선택한 뒤 실행해 주세요.');
    return;
  }

  var lastMonthCol = FIRST_MONTH_COL + MONTH_COL_COUNT - 1;
  var lastDataRow = DATA_START_ROW + DATA_ROW_COUNT - 1;
  var targets = [];
  var withValues = 0;
  var ranges = rangeList.getRanges();

  for (var k = 0; k < ranges.length; k++) {
    var range = ranges[k];
    if (range.getSheet().getName() !== SHEET_NAME) continue;
    var formulas = range.getFormulas();
    var values = range.getDisplayValues();
    for (var i = 0; i < range.getNumRows(); i++) {
      var row = range.getRow() + i;
      if (row < DATA_START_ROW || row > lastDataRow) continue;
      for (var j = 0; j < range.getNumColumns(); j++) {
        var col = range.getColumn() + j;
        var isMonth = col >= FIRST_MONTH_COL && col <= lastMonthCol;
        if (!isMonth && col !== 2) continue;
        if (formulas[i][j]) continue;
        targets.push({ row: row, col: col });
        if (String(values[i][j] || '').trim() !== '') withValues++;
      }
    }
  }

  if (!targets.length) {
    ui.alert('선택 영역에 복구할 칸이 없습니다. 수식이 모두 성합니다.');
    return;
  }
  if (withValues > 0) {
    var rest = targets.length - withValues;
    var answer = ui.alert(
      '값이 든 칸 ' + withValues + '개 포함',
      '복구하면 직접 적은 값이 지워지고 자동 채움으로 돌아갑니다.\n'
        + '값 없는 칸 ' + rest + '개는 그대로 복구됩니다.\n\n계속할까요?',
      ui.ButtonSet.OK_CANCEL
    );
    if (answer !== ui.Button.OK) return;
  }

  for (var t = 0; t < targets.length; t++) {
    var target = targets[t];
    var formula = target.col === 2
      ? nameCellFormula_(target.row)
      : monthCellFormula_(target.row, columnLetter_(target.col));
    sheet.getRange(target.row, target.col).setFormula(formula);
  }
  ui.alert('수식 ' + targets.length + '개를 복구했습니다.');
}

/** 머리글과 참조 탭을 경고 모드로 보호한다. 여러 번 실행해도 안전하다. */
function setupProtections() {
  var ui = SpreadsheetApp.getUi();
  var app = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = app.getSheetByName(SHEET_NAME);
  var refSheet = app.getSheetByName(REF_SHEET_NAME);
  if (!sheet) {
    ui.alert('참여율 탭이 없습니다.');
    return;
  }

  var headerRange = sheet.getRange('1:2');
  var rangeType = SpreadsheetApp.ProtectionType.RANGE;
  var protections = sheet.getProtections(rangeType);
  var exists = false;
  for (var i = 0; i < protections.length; i++) {
    var a1 = protections[i].getRange().getA1Notation();
    if (a1 === headerRange.getA1Notation()) exists = true;
  }
  if (!exists) {
    headerRange.protect()
      .setDescription('머리글 - 수정하면 반영이 거부됩니다')
      .setWarningOnly(true);
  }
  if (refSheet) {
    var sheetType = SpreadsheetApp.ProtectionType.SHEET;
    if (!refSheet.getProtections(sheetType).length) {
      refSheet.protect()
        .setDescription('참조 탭 - People 명단과 양식 식별자')
        .setWarningOnly(true);
    }
  }
  ui.alert('보호를 걸었습니다. 경고 모드입니다.');
}

function knownNicknames_(refSheet) {
  if (!refSheet) return [];
  var lastRow = refSheet.getLastRow();
  if (lastRow < 2) return [];
  var values = refSheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  var names = [];
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][0] || '').trim();
    if (name) names.push(name);
  }
  return names;
}

function countHardcodedCells_(sheet) {
  var body = sheet.getRange(
    DATA_START_ROW, FIRST_MONTH_COL, DATA_ROW_COUNT, MONTH_COL_COUNT
  );
  var formulas = body.getFormulas();
  var values = body.getDisplayValues();
  var count = 0;
  for (var r = 0; r < formulas.length; r++) {
    for (var c = 0; c < formulas[r].length; c++) {
      var raw = String(values[r][c] || '').trim();
      if (!formulas[r][c] && raw !== '') count++;
    }
  }
  return count;
}

function columnLetter_(column) {
  var letters = '';
  while (column > 0) {
    var rem = (column - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    column = Math.floor((column - 1) / 26);
  }
  return letters;
}
