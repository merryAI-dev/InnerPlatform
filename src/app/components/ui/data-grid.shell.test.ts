import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 업무 표의 뼈대가 유지되는지 본다.
 *
 * 머리 띠·세로 구분선·빈 상태는 "라벨과 값이 구분되지 않는다" 는 지적에서 나온 것이다.
 * 나중에 스타일을 정리하다 이 세 가지가 사라지면 같은 지적이 그대로 돌아온다.
 */

const gridSource = readFileSync(new URL('./data-grid.tsx', import.meta.url), 'utf8');
const peopleSource = readFileSync(
  new URL('../people/PeopleDirectoryPage.tsx', import.meta.url),
  'utf8',
);

describe('DataGrid', () => {
  it('머리를 회색 띠와 두꺼운 아래선으로 끊는다', () => {
    expect(gridSource).toContain('bg-slate-100');
    expect(gridSource).toContain('border-b-2 border-slate-300');
  });

  it('머리와 몸통 모두 열마다 세로선을 둔다', () => {
    const headCell = gridSource.slice(gridSource.indexOf('export function DataGridHeadCell'));
    const bodyCell = gridSource.slice(gridSource.indexOf('export function DataGridCell'));
    expect(headCell).toContain("!last && 'border-r border-slate-300'");
    expect(bodyCell).toContain("!last && 'border-r border-slate-200'");
  });

  it('빈 표는 아이콘과 문구로 비어 있음을 알린다', () => {
    expect(gridSource).toContain('데이터가 존재하지 않습니다');
    expect(gridSource).toContain('FileX2');
  });
});

describe('인력 명부 표', () => {
  it('공용 업무 표를 쓰고, 옛 shadcn Table 로 되돌아가지 않는다', () => {
    expect(peopleSource).toContain("from '../ui/data-grid'");
    expect(peopleSource).not.toContain("from '../ui/table'");
  });
});
