import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  analyzeParticipationSheet,
} from './participation-sheet-ingest.mjs';
import {
  participationSheetRanges,
  toParticipationSheetInput,
} from './participation-sheet-ranges.mjs';

const PEOPLE = [
  { personId: 'p-kim', name: '김정태', nickname: '에이블' },
];

const PARTICIPATION_FORMAT_V1 = 'MYSC-PARTICIPATION-V1';
const PARTICIPATION_FORMAT_V2 = 'MYSC-PARTICIPATION-V2';

const TEMPLATE_BUILDER_URL = new URL('../../scripts/build-participation-sheet-template.mjs', import.meta.url);
const DIRECT_RUN_GUARD = /if\s*\(isDirectRun\(import\.meta\.url,\s*process\.argv\[1\]\)\)\s*\{\s*main\(\)\.catch/s;

async function loadTemplateBuilder() {
  const source = await readFile(TEMPLATE_BUILDER_URL, 'utf8');
  if (!source.includes('export function buildParticipationSheetWorkbook') || !DIRECT_RUN_GUARD.test(source)) {
    throw new Error('Unsafe participation template builder import');
  }
  return import(TEMPLATE_BUILDER_URL.href);
}

describe('참여율 표준양식 builder 모듈 경계', () => {
  it('순수 workbook builder를 export하고 CLI 실행만 main으로 진입한다', async () => {
    const source = await readFile(TEMPLATE_BUILDER_URL, 'utf8');

    expect(source).toContain('export function buildParticipationSheetWorkbook');
    expect(source).toContain('export function isDirectRun');
    expect(source).toMatch(DIRECT_RUN_GUARD);
    expect(source.match(/main\(\)\.catch/g)).toHaveLength(1);

    const { buildParticipationSheetWorkbook, isDirectRun } = await loadTemplateBuilder();
    expect(buildParticipationSheetWorkbook).toBeTypeOf('function');
    expect(isDirectRun(TEMPLATE_BUILDER_URL.href, fileURLToPath(TEMPLATE_BUILDER_URL))).toBe(true);
    expect(isDirectRun(TEMPLATE_BUILDER_URL.href, undefined)).toBe(false);
  });
});

function columnNumber(label) {
  return [...label].reduce((value, character) => (
    (value * 26) + character.charCodeAt(0) - 64
  ), 0);
}

function formulaOf(cell) {
  const value = cell.value;
  return value && typeof value === 'object' && typeof value.formula === 'string'
    ? value.formula
    : '';
}

function setFormulaResult(cell, result) {
  const formula = formulaOf(cell);
  if (!formula) throw new Error(`Missing formula at ${cell.address}`);
  cell.value = { formula, result };
}

function setFormulaResultWhenPresent(cell, result) {
  const formula = formulaOf(cell);
  if (formula) cell.value = { formula, result };
}

function parserValueOf(cell) {
  const value = cell.value;
  if (value && typeof value === 'object' && typeof value.formula === 'string') {
    return value.result ?? '';
  }
  return value ?? '';
}

function readRange(workbook, { sheetName, rangeA1 }) {
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(rangeA1);
  if (!match) throw new Error(`Invalid test range: ${rangeA1}`);
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error(`Missing test worksheet: ${sheetName}`);
  const startColumn = columnNumber(match[1]);
  const startRow = Number(match[2]);
  const endColumn = columnNumber(match[3] || match[1]);
  const endRow = Number(match[4] || match[2]);
  return Array.from({ length: endRow - startRow + 1 }, (_, rowOffset) => (
    Array.from({ length: endColumn - startColumn + 1 }, (_, columnOffset) => (
      parserValueOf(worksheet.getCell(startRow + rowOffset, startColumn + columnOffset))
    ))
  ));
}

function readParserInput(workbook) {
  const format = readRange(workbook, { sheetName: '참조', rangeA1: 'F1' });
  const formatId = format[0]?.[0] || '';
  const ranges = participationSheetRanges(formatId);
  return toParticipationSheetInput(Object.fromEntries(
    Object.entries(ranges).map(([key, range]) => [key, readRange(workbook, range)]),
  ));
}

describe('참여율 시트 버전별 좌표 계약', () => {
  it('V1 복사본은 기존 120개월 G:DV 좌표로 계속 읽는다', () => {
    const ranges = participationSheetRanges(PARTICIPATION_FORMAT_V1);

    expect(ranges).toMatchObject({
      format: { sheetName: '참조', rangeA1: 'F1' },
      header: { sheetName: '참여율 관리', rangeA1: 'G2:DV2' },
      cells: { sheetName: '참여율 관리', rangeA1: 'G3:DV62' },
    });
    expect(columnNumber('DV') - columnNumber('G') + 1).toBe(120);
  });

  it('V2는 123개월 이상 계약을 담도록 252개월 G:IX 좌표를 쓴다', () => {
    const ranges = participationSheetRanges(PARTICIPATION_FORMAT_V2);

    expect(ranges).toMatchObject({
      format: { sheetName: '참조', rangeA1: 'F1' },
      header: { sheetName: '참여율 관리', rangeA1: 'G2:IX2' },
      cells: { sheetName: '참여율 관리', rangeA1: 'G3:IX62' },
    });
    expect(columnNumber('IX') - columnNumber('G') + 1).toBe(252);
  });
});

describe('참여율 표준양식 XLSX 왕복', () => {
  it('actual builder가 V2 세 탭과 252개월 고정 좌표 전체에 양식 수식을 만든다', async () => {
    const { buildParticipationSheetWorkbook } = await loadTemplateBuilder();
    const built = buildParticipationSheetWorkbook({ people: PEOPLE });
    const buffer = await built.xlsx.writeBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const reference = workbook.getWorksheet('참조');
    const sheet = workbook.getWorksheet('참여율 관리');

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      '안내',
      '참조',
      '참여율 관리',
    ]);
    expect(reference?.state).toBe('hidden');
    expect(reference?.getCell('F1').value).toBe(PARTICIPATION_FORMAT_V2);
    expect(sheet).toBeDefined();

    const headerFormulas = Array.from({ length: 252 }, (_, index) => (
      formulaOf(sheet.getCell(2, 7 + index))
    ));
    expect(headerFormulas).toHaveLength(252);
    expect(headerFormulas.every(Boolean)).toBe(true);
    expect(headerFormulas[0]).toBe('IF(OR($B$1="",$D$1="",$B$1>$D$1),"",$B$1)');
    expect(headerFormulas[251]).toContain('IW2');

    const bodyFormulas = [];
    for (let row = 3; row <= 62; row += 1) {
      for (let column = 7; column <= 258; column += 1) {
        bodyFormulas.push(formulaOf(sheet.getCell(row, column)));
      }
    }
    expect(bodyFormulas).toHaveLength(60 * 252);
    expect(bodyFormulas.every(Boolean)).toBe(true);
    expect(formulaOf(sheet.getCell('G3'))).toContain('G$2');
    expect(formulaOf(sheet.getCell('IX62'))).toContain('IX$2');
  });

  it('V2 실제 123개월 파일을 저장·재오픈해 빈칸·0·기본값 차이·연결 대기·다년도를 그대로 해석한다', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'myscube-participation-'));
    const filePath = join(directory, 'participation-roundtrip.xlsx');

    try {
      const { buildParticipationSheetWorkbook } = await loadTemplateBuilder();
      const workbook = buildParticipationSheetWorkbook({ people: PEOPLE });
      const sheet = workbook.getWorksheet('참여율 관리');
      sheet.getCell('B1').value = '2025-04';
      sheet.getCell('D1').value = '2035-06';

      const months = Array.from({ length: 123 }, (_, index) => {
        const absoluteMonth = 3 + index;
        const year = 2025 + Math.floor(absoluteMonth / 12);
        const month = (absoluteMonth % 12) + 1;
        return `${year}-${String(month).padStart(2, '0')}`;
      });
      for (let index = 0; index < 252; index += 1) {
        setFormulaResultWhenPresent(sheet.getCell(2, 7 + index), months[index] || '');
      }
      for (let row = 3; row <= 62; row += 1) {
        setFormulaResult(sheet.getCell(row, 2), '');
        for (let column = 7; column <= 258; column += 1) {
          setFormulaResultWhenPresent(sheet.getCell(row, column), '');
        }
      }

      sheet.getCell('A3').value = '에이블';
      setFormulaResult(sheet.getCell('B3'), '김정태');
      sheet.getCell('C3').value = '총괄책임자';
      sheet.getCell('D3').value = '2035-03';
      sheet.getCell('E3').value = '2035-06';
      sheet.getCell('F3').value = 30;
      setFormulaResult(sheet.getCell(3, 126), 30);
      // 사용자가 수식을 지워 생긴 null은 미확인 빈칸이며, 확인된 0과 달라야 한다.
      sheet.getCell(3, 127).value = null;
      sheet.getCell(3, 128).value = 0;
      sheet.getCell(3, 129).value = 45;

      sheet.getCell('A4').value = '테일러';
      sheet.getCell('B4').value = '김혜령';
      sheet.getCell('C4').value = '연구';
      sheet.getCell('D4').value = '2035-03';
      sheet.getCell('E4').value = '2035-06';
      sheet.getCell('F4').value = 20;
      for (let column = 126; column <= 129; column += 1) {
        setFormulaResultWhenPresent(sheet.getCell(4, column), 20);
      }

      await workbook.xlsx.writeFile(filePath);

      const reopened = new ExcelJS.Workbook();
      await reopened.xlsx.readFile(filePath);
      const input = readParserInput(reopened);
      const analysis = analyzeParticipationSheet({
        sheet: input,
        project: {
          name: 'XLSX 왕복 검증',
          contractStart: '2025-04-01',
          contractEnd: '2035-06-30',
        },
        people: PEOPLE,
        tenantId: 'mysc',
        projectId: 'p-roundtrip',
      });

      expect(reopened.getWorksheet('참조')?.state).toBe('hidden');
      expect(reopened.worksheets.map((worksheet) => worksheet.name)).toEqual([
        '안내',
        '참조',
        '참여율 관리',
      ]);
      expect(input.formatCellValue).toBe(PARTICIPATION_FORMAT_V2);
      expect(input.headerValues).toHaveLength(252);
      expect(input.metaValues).toHaveLength(60);
      expect(input.cellValues).toHaveLength(60);
      expect(input.cellValues.every((row) => row.length === 252)).toBe(true);
      expect(input.cellValues[0].slice(119, 123)).toEqual([30, '', 0, 45]);
      expect(analysis.blocking).toEqual([]);
      expect(analysis.ok).toBe(true);
      expect(analysis.parsed.months).toHaveLength(123);
      expect(analysis.parsed.months[0]).toBe('2025-04');
      expect(analysis.parsed.months[122]).toBe('2035-06');
      expect(analysis.summary).toMatchObject({
        monthCount: 123,
        rowCount: 2,
        linkedCount: 1,
        pendingLinkCount: 1,
        missingCount: 1,
      });

      const linked = analysis.rows[0];
      expect(linked).toMatchObject({
        nickname: '에이블',
        name: '김정태',
        baseRate: 30,
        personId: 'p-kim',
        linkState: 'LINKED',
      });
      expect(linked.monthlyRates).toEqual({
        '2035-03': 30,
        '2035-05': 0,
        '2035-06': 45,
      });
      expect(Object.hasOwn(linked.monthlyRates, '2035-04')).toBe(false);
      expect(linked.monthlyRates['2035-05']).toBe(0);
      expect(linked.monthlyRates['2035-06']).not.toBe(linked.baseRate);
      expect(analysis.missing).toEqual([
        expect.objectContaining({ rowIndex: 0, month: '2035-04' }),
      ]);

      expect(analysis.rows[1]).toMatchObject({
        nickname: '테일러',
        name: '김혜령',
        personId: '',
        linkState: 'PENDING_LINK',
      });
      expect(analysis.candidates).toEqual([
        expect.objectContaining({ name: '김혜령', nickname: '테일러', monthCount: 4 }),
      ]);
      expect(analysis.entries).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
