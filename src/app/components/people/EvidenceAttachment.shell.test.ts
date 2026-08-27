import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'EvidenceAttachment.tsx'), 'utf8');

describe('증빙 첨부', () => {
  it('서명 URL 로 스토리지에 직접 올린다 — 스캔본이 요청 본문 한도에 막히지 않게', () => {
    expect(source).toContain('client.uploadEvidence(personId, file)');
    expect(source).not.toContain('contentBase64');
  });

  it('올린 뒤 저장을 눌러야 붙는다는 사실을 사람에게 알린다', () => {
    expect(source).toContain('증빙을 올렸습니다. 저장을 눌러야 인사정보에 붙습니다.');
  });

  it('증빙은 민감 개인정보라 미리보기 링크를 만들지 않고 열 때마다 BFF 를 거친다', () => {
    expect(source).toContain('downloadPersonHrEvidenceViaBff');
    expect(source).toContain('URL.revokeObjectURL');
    expect(source).not.toContain('downloadURL');
  });
});
