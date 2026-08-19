import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');

describe('종료사업 체크아웃 저장', () => {
  it('저장을 한 줄로 세운다', () => {
    // 라이브 사고: 체크박스를 연달아 누르니 요청이 동시에 나가 각자 자기가 읽은 version 을
    // 보냈고, 뒤엣것이 409 version_conflict 로 전부 튕겼다.
    expect(source).toContain('const checkoutSaveChainRef = useRef<Promise<unknown>>(Promise.resolve())');
    expect(source).toContain('checkoutSaveChainRef.current = queued');
    expect(source).toContain('.then(() => runCheckoutSave(projectId, patch))');
  });

  it('서버가 올린 version 을 로컬에 되쓴다', () => {
    // 되쓰지 않으면 다음 체크가 다시 낡은 version 을 보낸다. 줄을 세워도 409 가 난다.
    expect(source).toContain('const saved = await upsertProjectViaBff(');
    expect(source).toContain('if (typeof saved?.version === \'number\')');
    expect(source).toContain('project.id === targetProjectId ? { ...project, version: saved.version } : project');
  });

  it('저장 직전에 최신 프로젝트를 다시 읽는다', () => {
    // 큐에서 기다리는 동안 앞 저장이 version 을 올렸을 수 있다.
    expect(source).toContain('const latest = projectsRef.current.find((project) => project.id === targetProjectId) || existingProject');
    expect(source).toContain('expectedVersion: latest.version ?? 1');
  });
});
