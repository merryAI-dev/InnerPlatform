import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  parseAuthorizationBearer,
  resolveRequestIdentity,
  extractTenantIdFromClaims,
  extractRoleFromClaims,
} from '../auth.mjs';
import { createAuditChainService } from '../audit-chain.mjs';
import {
  buildNotificationId,
  buildTransactionStateNotificationDoc,
  createNotificationsForOutboxEvent,
} from '../notifications.mjs';
import { createSlackAlertService } from '../slack-alerts.mjs';
import { createPiiProtector } from '../pii-protection.mjs';

// ---------------------------------------------------------------------------
// 공통 헬퍼
// ---------------------------------------------------------------------------

function createHeaders(headers: Record<string, string>) {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) normalized[k.toLowerCase()] = v;
  return (name: string) => normalized[name.toLowerCase()] || '';
}

function makeVerifyToken(claims: Record<string, any>) {
  return async (_token: string) => claims;
}

function failingVerifyToken() {
  return async () => {
    throw new Error('Token verification failed');
  };
}

// ---------------------------------------------------------------------------
// Mock Firestore (in-memory) — audit chain 및 notifications 테스트용
// ---------------------------------------------------------------------------

interface DocData { [key: string]: any }

function createMockFirestore() {
  const store = new Map<string, DocData>();

  function docRef(path: string) {
    return {
      path,
      get: async () => ({
        exists: store.has(path),
        data: () => store.get(path) ?? null,
        id: path.split('/').pop() ?? '',
      }),
      create: async (data: DocData) => {
        if (store.has(path)) {
          const err: any = new Error('Already exists');
          err.code = 6;
          throw err;
        }
        store.set(path, data);
      },
      set: async (data: DocData, opts?: any) => {
        if (opts?.merge) {
          store.set(path, { ...(store.get(path) || {}), ...data });
        } else {
          store.set(path, data);
        }
      },
    };
  }

  function collectionRef(collPath: string) {
    return {
      orderBy: (_field: string, _dir: string) => ({
        limit: (_n: number) => ({
          async get() {
            const docs: any[] = [];
            for (const [key, val] of store.entries()) {
              if (key.startsWith(collPath + '/')) {
                docs.push({
                  id: key.split('/').pop() ?? '',
                  data: () => val,
                });
              }
            }
            docs.sort((a, b) => (a.data().chainSeq ?? 0) - (b.data().chainSeq ?? 0));
            return { docs };
          },
        }),
      }),
      where: (_field: string, _op: string, _val: any) => ({
        async get() {
          const docs: any[] = [];
          for (const [key, val] of store.entries()) {
            if (key.startsWith(collPath + '/')) {
              const fieldVal = val[_field];
              if (_op === 'in' && Array.isArray(_val) && _val.includes(fieldVal)) {
                docs.push({ id: key.split('/').pop() ?? '', data: () => val });
              } else if (_op === '==' && fieldVal === _val) {
                docs.push({ id: key.split('/').pop() ?? '', data: () => val });
              }
            }
          }
          return { docs };
        },
      }),
    };
  }

  const db = {
    doc: (path: string) => docRef(path),
    collection: (path: string) => collectionRef(path),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const txOps: Array<() => void> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        create: (ref: any, data: DocData) => {
          txOps.push(() => {
            if (store.has(ref.path)) {
              const err: any = new Error('Already exists');
              err.code = 6;
              throw err;
            }
            store.set(ref.path, data);
          });
        },
        set: (ref: any, data: DocData, opts?: any) => {
          txOps.push(() => {
            if (opts?.merge) {
              store.set(ref.path, { ...(store.get(ref.path) || {}), ...data });
            } else {
              store.set(ref.path, data);
            }
          });
        },
      };
      const result = await fn(tx);
      for (const op of txOps) op();
      return result;
    },
    _store: store,
    _clear: () => store.clear(),
  };

  return db;
}

// =========================================================================
// 1. Auth Scenarios (실제 공격 패턴)
// =========================================================================

describe('Auth 보안 시나리오', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env.BFF_ALLOWED_EMAIL_DOMAINS = 'mysc.co.kr';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  // -----------------------------------------------------------------------
  // 1-1. JWT 조작
  // -----------------------------------------------------------------------

  describe('JWT 조작 공격', () => {
    it('malformed 토큰 → 401 invalid_token', async () => {
      await expect(
        resolveRequestIdentity({
          authMode: 'firebase_required',
          readHeaderValue: createHeaders({
            authorization: 'Bearer not.a.valid.jwt.at.all',
            'x-tenant-id': 'mysc',
          }),
          verifyToken: failingVerifyToken(),
        }),
      ).rejects.toMatchObject({ statusCode: 401, code: 'invalid_token' });
    });

    it('expired 토큰 → 401 invalid_token', async () => {
      await expect(
        resolveRequestIdentity({
          authMode: 'firebase_required',
          readHeaderValue: createHeaders({
            authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjB9.fake',
            'x-tenant-id': 'mysc',
          }),
          verifyToken: async () => {
            throw new Error('Token expired');
          },
        }),
      ).rejects.toMatchObject({ statusCode: 401, code: 'invalid_token' });
    });

    it('wrong issuer 토큰 → 401 invalid_token', async () => {
      await expect(
        resolveRequestIdentity({
          authMode: 'firebase_required',
          readHeaderValue: createHeaders({
            authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJldmlsIn0.fake',
            'x-tenant-id': 'mysc',
          }),
          verifyToken: async () => {
            throw new Error('Token has incorrect "iss" claim');
          },
        }),
      ).rejects.toMatchObject({ statusCode: 401, code: 'invalid_token' });
    });
  });

  // -----------------------------------------------------------------------
  // 1-2. 빈 Authorization 헤더
  // -----------------------------------------------------------------------

  describe('빈 Authorization 헤더 변형', () => {
    it('"Bearer " (공백만) → 401 missing_bearer_token', async () => {
      await expect(
        resolveRequestIdentity({
          authMode: 'firebase_required',
          readHeaderValue: createHeaders({
            authorization: 'Bearer ',
            'x-tenant-id': 'mysc',
          }),
          verifyToken: makeVerifyToken({ uid: 'u1' }),
        }),
      ).rejects.toMatchObject({ statusCode: 401, code: 'missing_bearer_token' });
    });

    it('"Bearer null" → verifyToken 호출되어 실패', async () => {
      // "Bearer null" 에서 "null" 문자열이 토큰으로 추출됨
      const token = parseAuthorizationBearer('Bearer null');
      expect(token).toBe('null');

      await expect(
        resolveRequestIdentity({
          authMode: 'firebase_required',
          readHeaderValue: createHeaders({
            authorization: 'Bearer null',
            'x-tenant-id': 'mysc',
          }),
          verifyToken: failingVerifyToken(),
        }),
      ).rejects.toMatchObject({ statusCode: 401, code: 'invalid_token' });
    });

    it('Authorization 헤더 없음 → 401 missing_bearer_token', async () => {
      await expect(
        resolveRequestIdentity({
          authMode: 'firebase_required',
          readHeaderValue: createHeaders({ 'x-tenant-id': 'mysc' }),
          verifyToken: makeVerifyToken({ uid: 'u1' }),
        }),
      ).rejects.toMatchObject({ statusCode: 401, code: 'missing_bearer_token' });
    });

    it('firebase_optional 모드 + 헤더 없음 → headers 폴백', async () => {
      const identity = await resolveRequestIdentity({
        authMode: 'firebase_optional',
        readHeaderValue: createHeaders({
          'x-tenant-id': 'mysc',
          'x-actor-id': 'fallback-user',
        }),
        verifyToken: makeVerifyToken({ uid: 'u1' }),
      });
      expect(identity.source).toBe('headers');
      expect(identity.actorId).toBe('fallback-user');
    });
  });

  // -----------------------------------------------------------------------
  // 1-3. Firebase 토큰 사용 시 역할/이메일은 헤더가 아니라 토큰을 기준으로 한다.
  // -----------------------------------------------------------------------

  describe('Firebase 토큰 + 헤더 불일치', () => {
    it('viewer 토큰으로 admin 헤더를 보내도 토큰 role을 사용한다', async () => {
      const identity = await resolveRequestIdentity({
        authMode: 'firebase_required',
        readHeaderValue: createHeaders({
          authorization: 'Bearer valid-token',
          'x-tenant-id': 'mysc',
          'x-actor-role': 'admin',
        }),
        verifyToken: makeVerifyToken({
          uid: 'viewer-user-123',
          tenantId: 'mysc',
          role: 'viewer',
          email: 'viewer@mysc.co.kr',
        }),
      });

      expect(identity.actorRole).toBe('pm');
      expect(identity.actorEmail).toBe('viewer@mysc.co.kr');
    });

    it('pm 토큰에 finance 헤더를 섞어도 토큰 role을 유지한다', async () => {
      const identity = await resolveRequestIdentity({
        authMode: 'firebase_required',
        readHeaderValue: createHeaders({
          authorization: 'Bearer valid-token',
          'x-tenant-id': 'mysc',
          'x-actor-role': 'finance',
        }),
        verifyToken: makeVerifyToken({
          uid: 'pm-user-456',
          tenantId: 'mysc',
          role: 'pm',
          email: 'pm@mysc.co.kr',
        }),
      });

      expect(identity.actorRole).toBe('pm');
    });
  });

  // -----------------------------------------------------------------------
  // 1-4. 테넌트 크로스액세스
  // -----------------------------------------------------------------------

  describe('테넌트 크로스액세스 공격', () => {
    it('org-a 토큰으로 org-b 데이터 접근 → 403 tenant_mismatch', async () => {
      await expect(
        resolveRequestIdentity({
          authMode: 'firebase_required',
          readHeaderValue: createHeaders({
            authorization: 'Bearer valid-token',
            'x-tenant-id': 'org-b',
          }),
          verifyToken: makeVerifyToken({
            uid: 'user-org-a',
            tenantId: 'org-a',
            role: 'admin',
            email: 'admin@mysc.co.kr',
          }),
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'tenant_mismatch' });
    });

    it('actor-id 위조 (토큰 uid와 헤더 actor 불일치) → 403 actor_mismatch', async () => {
      await expect(
        resolveRequestIdentity({
          authMode: 'firebase_required',
          readHeaderValue: createHeaders({
            authorization: 'Bearer valid-token',
            'x-tenant-id': 'mysc',
            'x-actor-id': 'impersonated-admin',
          }),
          verifyToken: makeVerifyToken({
            uid: 'real-user-789',
            tenantId: 'mysc',
            role: 'viewer',
            email: 'real@mysc.co.kr',
          }),
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'actor_mismatch' });
    });

    it('이메일 헤더를 위조해도 토큰 email을 사용한다', async () => {
      const identity = await resolveRequestIdentity({
        authMode: 'firebase_required',
        readHeaderValue: createHeaders({
          authorization: 'Bearer valid-token',
          'x-tenant-id': 'mysc',
          'x-actor-email': 'spoofed@mysc.co.kr',
        }),
        verifyToken: makeVerifyToken({
          uid: 'user-x',
          tenantId: 'mysc',
          role: 'pm',
          email: 'real@mysc.co.kr',
        }),
      });

      expect(identity.actorEmail).toBe('real@mysc.co.kr');
    });
  });

  // -----------------------------------------------------------------------
  // 1-5. @mysc.co.kr 도메인 기반 역할 자동 판별
  // -----------------------------------------------------------------------

  describe('@mysc.co.kr 도메인 허용/차단', () => {
    it('mysc.co.kr 도메인 → 인증 성공', async () => {
      const identity = await resolveRequestIdentity({
        authMode: 'firebase_required',
        readHeaderValue: createHeaders({
          authorization: 'Bearer valid-token',
          'x-tenant-id': 'mysc',
        }),
        verifyToken: makeVerifyToken({
          uid: 'user-pm-01',
          tenantId: 'mysc',
          role: 'pm',
          email: 'kimpm@mysc.co.kr',
        }),
      });
      expect(identity.actorEmail).toBe('kimpm@mysc.co.kr');
      expect(identity.actorRole).toBe('pm');
    });

    it('gmail.com 도메인 → 403 email_domain_not_allowed', async () => {
      await expect(
        resolveRequestIdentity({
          authMode: 'firebase_required',
          readHeaderValue: createHeaders({
            authorization: 'Bearer valid-token',
            'x-tenant-id': 'mysc',
          }),
          verifyToken: makeVerifyToken({
            uid: 'external-user',
            tenantId: 'mysc',
            role: 'viewer',
            email: 'outsider@gmail.com',
          }),
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'email_domain_not_allowed' });
    });

    it('naver.com 도메인 → 403 email_domain_not_allowed', async () => {
      await expect(
        resolveRequestIdentity({
          authMode: 'firebase_required',
          readHeaderValue: createHeaders({
            authorization: 'Bearer valid-token',
            'x-tenant-id': 'mysc',
          }),
          verifyToken: makeVerifyToken({
            uid: 'naver-user',
            tenantId: 'mysc',
            role: 'pm',
            email: 'user@naver.com',
          }),
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'email_domain_not_allowed' });
    });

    it('여러 허용 도메인 설정 가능', async () => {
      process.env.BFF_ALLOWED_EMAIL_DOMAINS = 'mysc.co.kr,partner.org';

      const identity = await resolveRequestIdentity({
        authMode: 'firebase_required',
        readHeaderValue: createHeaders({
          authorization: 'Bearer valid-token',
          'x-tenant-id': 'mysc',
        }),
        verifyToken: makeVerifyToken({
          uid: 'partner-user',
          tenantId: 'mysc',
          role: 'pm',
          email: 'partner@partner.org',
        }),
      });
      expect(identity.actorEmail).toBe('partner@partner.org');
    });
  });

  // -----------------------------------------------------------------------
  // 1-6. 클레임 추출 유틸 테스트
  // -----------------------------------------------------------------------

  describe('클레임 추출 유틸', () => {
    it('tenantId 다양한 키 이름 지원 (tenantId, tenant_id, orgId, org_id)', () => {
      expect(extractTenantIdFromClaims({ tenantId: 'mysc' })).toBe('mysc');
      expect(extractTenantIdFromClaims({ tenant_id: 'mysc' })).toBe('mysc');
      expect(extractTenantIdFromClaims({ orgId: 'mysc' })).toBe('mysc');
      expect(extractTenantIdFromClaims({ org_id: 'mysc' })).toBe('mysc');
    });

    it('role 단일 값 및 roles 배열 지원', () => {
      expect(extractRoleFromClaims({ role: 'admin' })).toBe('admin');
      expect(extractRoleFromClaims({ roles: ['pm', 'viewer'] })).toBe('pm');
      expect(extractRoleFromClaims({ role: ' PM ' })).toBe('pm');
    });

    it('null/undefined claims → 빈 문자열', () => {
      expect(extractTenantIdFromClaims(null)).toBe('');
      expect(extractTenantIdFromClaims(undefined)).toBe('');
      expect(extractRoleFromClaims(null)).toBe('');
    });
  });
});

// =========================================================================
// 2. Audit Chain Scenarios (무결성 검증)
// =========================================================================

describe('Audit Chain 무결성 시나리오', () => {
  let db: ReturnType<typeof createMockFirestore>;
  let auditChain: ReturnType<typeof createAuditChainService>;
  let seqCounter: number;

  beforeEach(() => {
    db = createMockFirestore();
    seqCounter = 0;
    auditChain = createAuditChainService(db, {
      now: () => {
        seqCounter += 1;
        return `2026-03-26T10:00:${String(seqCounter).padStart(2, '0')}.000Z`;
      },
    });
  });

  // -----------------------------------------------------------------------
  // 2-1. 정상 체인: 10개 항목 append → verify → ok
  // -----------------------------------------------------------------------

  it('10개 항목 append 후 verify → ok', async () => {
    const results: any[] = [];
    for (let i = 0; i < 10; i++) {
      const result = await auditChain.append({
        tenantId: 'mysc',
        entityType: 'transaction',
        entityId: `tx-${i}`,
        action: 'create',
        actorId: `user-${i % 3}`,
        requestId: `req-${i}`,
        details: { amount: (i + 1) * 10000 },
      });
      results.push(result);
    }

    // chainSeq 1~10 연속 확인
    for (let i = 0; i < 10; i++) {
      expect(results[i].chainSeq).toBe(i + 1);
    }

    // prevHash 체이닝 확인
    expect(results[0].prevHash).toBeNull();
    for (let i = 1; i < 10; i++) {
      expect(results[i].prevHash).toBe(results[i - 1].hash);
    }

    // verify 통과
    const verification = await auditChain.verify({ tenantId: 'mysc' });
    expect(verification.ok).toBe(true);
    expect(verification.checked).toBe(10);
    expect(verification.lastSeq).toBe(10);
  });

  // -----------------------------------------------------------------------
  // 2-2. 중간 위변조: 5번째 항목 hash 변조 → verify 실패
  // -----------------------------------------------------------------------

  it('5번째 항목 hash 위변조 → verify 실패 (hash_mismatch)', async () => {
    for (let i = 0; i < 10; i++) {
      await auditChain.append({
        tenantId: 'mysc',
        entityType: 'transaction',
        entityId: `tx-${i}`,
        action: 'update',
        actorId: 'auditor',
        requestId: `req-${i}`,
        details: { note: `항목 ${i}` },
      });
    }

    // 5번째 항목의 hash를 직접 변조
    for (const [key, val] of db._store.entries()) {
      if (key.startsWith('orgs/mysc/audit_logs/') && val.chainSeq === 5) {
        val.hash = 'tampered_hash_0000000000000000000000000000000000000000';
        break;
      }
    }

    const verification = await auditChain.verify({ tenantId: 'mysc' });
    expect(verification.ok).toBe(false);
    expect(verification.reason).toBe('hash_mismatch');
    expect(verification.checked).toBe(4); // 1~4는 통과, 5에서 실패
  });

  // -----------------------------------------------------------------------
  // 2-3. prevHash 위변조 → verify 실패
  // -----------------------------------------------------------------------

  it('3번째 항목 prevHash 위변조 → verify 실패 (prev_hash_mismatch)', async () => {
    for (let i = 0; i < 5; i++) {
      await auditChain.append({
        tenantId: 'mysc',
        entityType: 'project',
        entityId: `proj-${i}`,
        action: 'create',
        actorId: 'admin',
        requestId: `req-${i}`,
        details: {},
      });
    }

    // 3번째 항목의 prevHash 변조
    for (const [key, val] of db._store.entries()) {
      if (key.startsWith('orgs/mysc/audit_logs/') && val.chainSeq === 3) {
        val.prevHash = 'fake_prev_hash';
        break;
      }
    }

    const verification = await auditChain.verify({ tenantId: 'mysc' });
    expect(verification.ok).toBe(false);
    expect(verification.reason).toBe('prev_hash_mismatch');
  });

  // -----------------------------------------------------------------------
  // 2-4. 순서 보장: 순차 3개 append → chainSeq 연속
  // -----------------------------------------------------------------------

  it('순차 3개 append → chainSeq가 1, 2, 3 연속', async () => {
    const results: any[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await auditChain.append({
        tenantId: 'mysc',
        entityType: 'expense_set',
        entityId: `exp-${i}`,
        action: 'submit',
        actorId: 'pm-kim',
        requestId: `req-seq-${i}`,
        details: { index: i },
      });
      results.push(result);
    }

    expect(results.map((r) => r.chainSeq)).toEqual([1, 2, 3]);
    expect(results[0].prevHash).toBeNull();
    expect(results[1].prevHash).toBe(results[0].hash);
    expect(results[2].prevHash).toBe(results[1].hash);
  });

  // -----------------------------------------------------------------------
  // 2-5. 빈 체인: verify on empty → ok
  // -----------------------------------------------------------------------

  it('빈 체인 verify → ok, checked=0', async () => {
    const verification = await auditChain.verify({ tenantId: 'mysc' });
    expect(verification.ok).toBe(true);
    expect(verification.checked).toBe(0);
    expect(verification.lastSeq).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 2-6. 다른 테넌트 체인 격리
  // -----------------------------------------------------------------------

  it('테넌트별 체인 격리: org-a와 org-b는 독립', async () => {
    await auditChain.append({
      tenantId: 'org-a',
      entityType: 'transaction',
      entityId: 'tx-1',
      action: 'create',
      actorId: 'user-a',
      requestId: 'req-a1',
      details: {},
    });

    await auditChain.append({
      tenantId: 'org-b',
      entityType: 'transaction',
      entityId: 'tx-1',
      action: 'create',
      actorId: 'user-b',
      requestId: 'req-b1',
      details: {},
    });

    const verifyA = await auditChain.verify({ tenantId: 'org-a' });
    const verifyB = await auditChain.verify({ tenantId: 'org-b' });

    expect(verifyA.ok).toBe(true);
    expect(verifyA.checked).toBe(1);
    expect(verifyB.ok).toBe(true);
    expect(verifyB.checked).toBe(1);
  });
});

// =========================================================================
// 3. PII 보호 Scenarios
// =========================================================================

describe('PII 보호 시나리오', () => {
  // 로컬 AES-256-GCM 키 (테스트용 32바이트)
  const testKeyBase64 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

  function createLocalPiiProtector() {
    return createPiiProtector({
      env: {
        PII_MODE: 'local',
        PII_LOCAL_KEYRING: `k1:${testKeyBase64}`,
        PII_LOCAL_CURRENT_KEY_ID: 'k1',
      },
    });
  }

  // -----------------------------------------------------------------------
  // 3-1. 이메일 마스킹
  // -----------------------------------------------------------------------

  describe('이메일 마스킹', () => {
    it('"hong@mysc.co.kr" → "ho***@mysc.co.kr"', () => {
      const pii = createLocalPiiProtector();
      expect(pii.maskEmail('hong@mysc.co.kr')).toBe('ho***@mysc.co.kr');
    });

    it('"a@mysc.co.kr" (로컬파트 1자) → 마스킹', () => {
      const pii = createLocalPiiProtector();
      // local part가 1자면 slice(0,2) → "a", head="a"
      expect(pii.maskEmail('a@mysc.co.kr')).toBe('a***@mysc.co.kr');
    });

    it('빈 문자열 → undefined', () => {
      const pii = createLocalPiiProtector();
      expect(pii.maskEmail('')).toBeUndefined();
    });

    it('대소문자 정규화', () => {
      const pii = createLocalPiiProtector();
      expect(pii.maskEmail('HONG@MYSC.CO.KR')).toBe('ho***@mysc.co.kr');
    });
  });

  // -----------------------------------------------------------------------
  // 3-2. 이름 마스킹
  // -----------------------------------------------------------------------

  describe('이름 마스킹', () => {
    it('"홍길동" → "홍**"', () => {
      const pii = createLocalPiiProtector();
      expect(pii.maskName('홍길동')).toBe('홍**');
    });

    it('"김" (1자) → "김*"', () => {
      const pii = createLocalPiiProtector();
      expect(pii.maskName('김')).toBe('김*');
    });

    it('빈 문자열 → undefined', () => {
      const pii = createLocalPiiProtector();
      expect(pii.maskName('')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 3-3. 암호화/복호화 라운드트립
  // -----------------------------------------------------------------------

  describe('암호화/복호화 라운드트립', () => {
    it('주민번호 암호화 → 복호화 → 원본 일치', async () => {
      const pii = createLocalPiiProtector();
      const ssn = '900101-1234567';

      const encrypted = await pii.encryptText(ssn);
      expect(encrypted).toBeDefined();
      expect(encrypted!.ciphertext).toMatch(/^enc:v1:k1:/);
      expect(encrypted!.mode).toBe('local');

      const decrypted = await pii.decryptText(encrypted!.ciphertext);
      expect(decrypted).toBe(ssn);
    });

    it('계좌번호 암호화 → 복호화 → 원본 일치', async () => {
      const pii = createLocalPiiProtector();
      const account = '국민은행 123-456-789012';

      const encrypted = await pii.encryptText(account);
      const decrypted = await pii.decryptText(encrypted!.ciphertext);
      expect(decrypted).toBe(account);
    });

    it('이메일 암호화 → 복호화 → 원본 일치', async () => {
      const pii = createLocalPiiProtector();
      const email = 'hong@mysc.co.kr';

      const encrypted = await pii.encryptText(email);
      const decrypted = await pii.decryptText(encrypted!.ciphertext);
      expect(decrypted).toBe(email);
    });

    it('혼합 데이터 (주민번호 + 계좌 + 이메일) 암호화 → 복호화', async () => {
      const pii = createLocalPiiProtector();
      const mixed = '홍길동 (900101-1234567) 국민은행 123-456-789012 hong@mysc.co.kr';

      const encrypted = await pii.encryptText(mixed);
      const decrypted = await pii.decryptText(encrypted!.ciphertext);
      expect(decrypted).toBe(mixed);
    });
  });

  // -----------------------------------------------------------------------
  // 3-4. 키 로테이션
  // -----------------------------------------------------------------------

  describe('키 로테이션', () => {
    it('다른 키로 암호화된 값은 needsRotation=true', async () => {
      const pii1 = createLocalPiiProtector();
      const encrypted = await pii1.encryptText('민감정보');

      // 새 키 세트로 protector 생성 (기존 키도 유지)
      const newKeyBase64 = Buffer.from('abcdefabcdefabcdefabcdefabcdefab').toString('base64');
      const pii2 = createPiiProtector({
        env: {
          PII_MODE: 'local',
          PII_LOCAL_KEYRING: `k1:${testKeyBase64},k2:${newKeyBase64}`,
          PII_LOCAL_CURRENT_KEY_ID: 'k2',
        },
      });

      expect(pii2.needsRotation(encrypted!.ciphertext)).toBe(true);

      const rotated = await pii2.rotateCiphertext(encrypted!.ciphertext);
      expect(rotated.changed).toBe(true);
      expect(rotated.ciphertext).toMatch(/^enc:v1:k2:/);

      // 로테이션 후 복호화 확인
      const decrypted = await pii2.decryptText(rotated.ciphertext);
      expect(decrypted).toBe('민감정보');
    });
  });

  // -----------------------------------------------------------------------
  // 3-5. PII 모드 off
  // -----------------------------------------------------------------------

  describe('PII 모드 off', () => {
    it('mode=off → 평문 그대로 반환', async () => {
      const pii = createPiiProtector({ env: { PII_MODE: 'off' } });
      expect(pii.enabled).toBe(false);
      expect(pii.mode).toBe('off');

      const result = await pii.encryptText('평문');
      expect(result!.ciphertext).toBe('평문');
      expect(result!.mode).toBe('off');
    });
  });
});

// =========================================================================
// 4. Notification Scenarios
// =========================================================================

describe('Notification 시나리오', () => {
  let db: ReturnType<typeof createMockFirestore>;

  beforeEach(() => {
    db = createMockFirestore();
  });

  // -----------------------------------------------------------------------
  // 4-1. 거래 제출 → 승인자에게 알림
  // -----------------------------------------------------------------------

  it('거래 SUBMITTED → admin/finance 멤버에게 알림 생성', async () => {
    // 거래 데이터
    db._store.set('orgs/mysc/transactions/tx-001', {
      id: 'tx-001',
      counterparty: '(주)소셜벤처',
      amount: 5000000,
      projectId: 'proj-1',
      ledgerId: 'ledger-1',
      state: 'SUBMITTED',
      submittedBy: 'pm-kim',
    });

    // 승인 가능한 멤버
    db._store.set('orgs/mysc/members/admin-lee', {
      uid: 'admin-lee',
      role: 'admin',
    });
    db._store.set('orgs/mysc/members/finance-park', {
      uid: 'finance-park',
      role: 'finance',
    });
    // pm-kim은 제출자이므로 알림에서 제외
    db._store.set('orgs/mysc/members/pm-kim', {
      uid: 'pm-kim',
      role: 'pm',
    });

    const event = {
      id: 'evt-001',
      tenantId: 'mysc',
      entityId: 'tx-001',
      eventType: 'transaction.state_changed',
      payload: { nextState: 'SUBMITTED', actorId: 'pm-kim' },
      createdAt: '2026-03-26T18:00:00.000Z',
    };

    const result = await createNotificationsForOutboxEvent(
      db,
      event,
      '2026-03-26T18:00:00.000Z',
    );

    expect(result.created).toBe(2); // admin-lee, finance-park

    // 알림 내용 확인
    const notifications = Array.from(db._store.entries())
      .filter(([key]) => key.startsWith('orgs/mysc/notifications/'))
      .map(([, val]) => val);

    expect(notifications).toHaveLength(2);
    for (const ntf of notifications) {
      expect(ntf.title).toBe('승인 필요: 거래 제출됨');
      expect(ntf.severity).toBe('warning');
      expect(ntf.description).toContain('(주)소셜벤처');
      expect(ntf.description).toContain('5,000,000원');
    }
  });

  // -----------------------------------------------------------------------
  // 4-2. 거래 반려 → 제출자에게 알림 + 사유 포함
  // -----------------------------------------------------------------------

  it('거래 REJECTED → 제출자에게 반려 사유 포함 알림', async () => {
    db._store.set('orgs/mysc/transactions/tx-002', {
      id: 'tx-002',
      counterparty: '한국사회혁신금융',
      amount: 3000000,
      state: 'REJECTED',
      submittedBy: 'pm-choi',
      rejectedReason: '증빙서류 미첨부',
    });
    db._store.set('orgs/mysc/members/pm-choi', {
      uid: 'pm-choi',
      role: 'pm',
    });

    const event = {
      id: 'evt-002',
      tenantId: 'mysc',
      entityId: 'tx-002',
      eventType: 'transaction.state_changed',
      payload: {
        nextState: 'REJECTED',
        actorId: 'admin-lee',
        reason: '증빙서류 미첨부',
      },
      createdAt: '2026-03-26T18:30:00.000Z',
    };

    const result = await createNotificationsForOutboxEvent(
      db,
      event,
      '2026-03-26T18:30:00.000Z',
    );

    expect(result.created).toBe(1);

    const ntf = Array.from(db._store.entries())
      .filter(([key]) => key.startsWith('orgs/mysc/notifications/'))
      .map(([, val]) => val)[0];

    expect(ntf.recipientId).toBe('pm-choi');
    expect(ntf.title).toBe('반려: 거래 반려됨');
    expect(ntf.severity).toBe('critical');
    expect(ntf.description).toContain('증빙서류 미첨부');
  });

  // -----------------------------------------------------------------------
  // 4-3. 중복 알림 방지 (idempotency)
  // -----------------------------------------------------------------------

  it('같은 이벤트 두 번 처리 → 중복 알림 생성 안 됨', async () => {
    db._store.set('orgs/mysc/transactions/tx-003', {
      id: 'tx-003',
      counterparty: '테스트사',
      amount: 1000000,
      state: 'APPROVED',
      submittedBy: 'pm-lee',
    });
    db._store.set('orgs/mysc/members/pm-lee', {
      uid: 'pm-lee',
      role: 'pm',
    });

    const event = {
      id: 'evt-003',
      tenantId: 'mysc',
      entityId: 'tx-003',
      eventType: 'transaction.state_changed',
      payload: { nextState: 'APPROVED', actorId: 'admin-lee' },
      createdAt: '2026-03-26T19:00:00.000Z',
    };

    const result1 = await createNotificationsForOutboxEvent(db, event, '2026-03-26T19:00:00.000Z');
    const result2 = await createNotificationsForOutboxEvent(db, event, '2026-03-26T19:00:00.000Z');

    expect(result1.created).toBe(1);
    expect(result2.created).toBe(0); // 이미 존재하므로 0
  });

  // -----------------------------------------------------------------------
  // 4-4. 지원하지 않는 이벤트 타입 → 무시
  // -----------------------------------------------------------------------

  it('transaction.state_changed 외 이벤트 → created=0', async () => {
    const result = await createNotificationsForOutboxEvent(
      db,
      {
        id: 'evt-x',
        tenantId: 'mysc',
        entityId: 'proj-1',
        eventType: 'project.updated',
        payload: {},
      },
      '2026-03-26T20:00:00.000Z',
    );
    expect(result.created).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 4-5. 잘못된 이벤트 데이터 → 안전하게 처리
  // -----------------------------------------------------------------------

  it('null/undefined 이벤트 → created=0', async () => {
    const result1 = await createNotificationsForOutboxEvent(db, null, '2026-03-26T20:00:00.000Z');
    const result2 = await createNotificationsForOutboxEvent(db, undefined, '2026-03-26T20:00:00.000Z');
    expect(result1.created).toBe(0);
    expect(result2.created).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 4-6. notificationId 결정론적 생성
  // -----------------------------------------------------------------------

  it('같은 eventId + recipientId → 동일한 notificationId', () => {
    const id1 = buildNotificationId({ eventId: 'evt-001', recipientId: 'user-a' });
    const id2 = buildNotificationId({ eventId: 'evt-001', recipientId: 'user-a' });
    const id3 = buildNotificationId({ eventId: 'evt-001', recipientId: 'user-b' });

    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1).toMatch(/^ntf_/);
  });

  // -----------------------------------------------------------------------
  // 4-7. 알림 문서 필드 검증
  // -----------------------------------------------------------------------

  it('buildTransactionStateNotificationDoc 필드 완전성', () => {
    const doc = buildTransactionStateNotificationDoc({
      tenantId: 'mysc',
      event: {
        id: 'evt-100',
        entityId: 'tx-100',
        eventType: 'transaction.state_changed',
        payload: { nextState: 'APPROVED', actorId: 'admin-lee', actorRole: 'admin' },
        createdAt: '2026-03-26T15:00:00.000Z',
      },
      tx: {
        id: 'tx-100',
        counterparty: '사회적금융센터',
        amount: 2500000,
        projectId: 'proj-5',
        ledgerId: 'ledger-3',
      },
      recipientId: 'pm-kim',
      recipientRole: 'pm',
      nowIso: '2026-03-26T15:00:00.000Z',
    });

    expect(doc.tenantId).toBe('mysc');
    expect(doc.recipientId).toBe('pm-kim');
    expect(doc.recipientRole).toBe('pm');
    expect(doc.entityType).toBe('transaction');
    expect(doc.entityId).toBe('tx-100');
    expect(doc.title).toBe('승인 완료: 거래 승인됨');
    expect(doc.severity).toBe('info');
    expect(doc.description).toContain('사회적금융센터');
    expect(doc.description).toContain('2,500,000원');
    expect(doc.actorId).toBe('admin-lee');
    expect(doc.actorRole).toBe('admin');
    expect(doc.readAt).toBeNull();
  });
});

// =========================================================================
// 5. Slack Alert Scenarios
// =========================================================================

describe('Slack Alert 시나리오', () => {
  // -----------------------------------------------------------------------
  // 5-1. Webhook 모드 성공
  // -----------------------------------------------------------------------

  it('webhook 모드 → 정상 전송', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;

    const service = createSlackAlertService({
      webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
      minLevel: 'error',
      fetchImpl: async (url: string, opts: any) => {
        capturedUrl = url;
        capturedBody = JSON.parse(opts.body);
        return { ok: true, text: async () => 'ok' } as Response;
      },
    });

    expect(service.enabled).toBe(true);
    expect(service.mode).toBe('webhook');

    await service.notifyClientError({
      level: 'error',
      source: 'settlement-page',
      message: '정산 데이터 로드 실패',
      tenantId: 'mysc',
      actorId: 'pm-kim',
      route: '/settlement/2026-03',
    });

    expect(capturedUrl).toBe('https://hooks.slack.com/services/T00/B00/xxx');
    expect(capturedBody.text).toContain('정산 데이터 로드 실패');
  });

  // -----------------------------------------------------------------------
  // 5-2. Webhook 실패 시 에러 throw
  // -----------------------------------------------------------------------

  it('webhook 실패 (500) → 에러 throw', async () => {
    const service = createSlackAlertService({
      webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
      minLevel: 'error',
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      }) as Response,
    });

    await expect(
      service.notifyClientError({
        level: 'error',
        source: 'test',
        message: '테스트 에러',
      }),
    ).rejects.toThrow(/Slack webhook failed \(500\)/);
  });

  // -----------------------------------------------------------------------
  // 5-3. Bot 모드 성공
  // -----------------------------------------------------------------------

  it('bot 모드 → chat.postMessage 호출', async () => {
    let capturedUrl = '';

    const service = createSlackAlertService({
      botToken: 'xoxb-test-token',
      channelId: 'C012345',
      minLevel: 'warning',
      fetchImpl: async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as Response;
      },
    });

    expect(service.mode).toBe('bot');

    await service.notifyClientError({
      level: 'warning',
      source: 'audit-chain',
      message: 'Audit chain 검증 실패',
    });

    expect(capturedUrl).toBe('https://slack.com/api/chat.postMessage');
  });

  // -----------------------------------------------------------------------
  // 5-4. 레벨 필터링
  // -----------------------------------------------------------------------

  describe('레벨 필터링', () => {
    it('minLevel=fatal → error 이벤트는 알림 안 함', () => {
      const service = createSlackAlertService({
        webhookUrl: 'https://hooks.slack.com/test',
        minLevel: 'fatal',
      });

      expect(service.shouldAlertClientError({ level: 'error' })).toBe(false);
      expect(service.shouldAlertClientError({ level: 'fatal' })).toBe(true);
    });

    it('minLevel=warning → info는 알림 안 함, warning/error/fatal은 알림', () => {
      const service = createSlackAlertService({
        webhookUrl: 'https://hooks.slack.com/test',
        minLevel: 'warning',
      });

      expect(service.shouldAlertClientError({ level: 'info' })).toBe(false);
      expect(service.shouldAlertClientError({ level: 'warning' })).toBe(true);
      expect(service.shouldAlertClientError({ level: 'error' })).toBe(true);
      expect(service.shouldAlertClientError({ level: 'fatal' })).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 5-5. 비활성화 상태
  // -----------------------------------------------------------------------

  it('설정 없음 → disabled 모드', () => {
    const service = createSlackAlertService({
      webhookUrl: '',
      botToken: '',
      channelId: '',
    });

    expect(service.enabled).toBe(false);
    expect(service.mode).toBe('disabled');
    expect(service.shouldAlertClientError({ level: 'fatal' })).toBe(false);
  });

  it('disabled 모드에서 notifyClientError → 에러 throw', async () => {
    const service = createSlackAlertService({
      webhookUrl: '',
      botToken: '',
      channelId: '',
    });

    await expect(
      service.notifyClientError({ level: 'fatal', message: 'test' }),
    ).rejects.toThrow('Slack delivery target is not configured');
  });
});

// =========================================================================
// 6. STRESS TESTS
// =========================================================================

describe('Stress Tests', () => {
  // -----------------------------------------------------------------------
  // 6-1. 동시 audit chain append 100건
  // -----------------------------------------------------------------------

  it('순차 audit chain append 100건 → 모든 chainSeq 고유 + 순서 연속', async () => {
    const db = createMockFirestore();
    let counter = 0;
    const auditChain = createAuditChainService(db, {
      now: () => {
        counter += 1;
        return `2026-03-26T12:${String(Math.floor(counter / 60)).padStart(2, '0')}:${String(counter % 60).padStart(2, '0')}.000Z`;
      },
    });

    const results: any[] = [];
    for (let i = 0; i < 100; i++) {
      const result = await auditChain.append({
        tenantId: 'mysc',
        entityType: 'transaction',
        entityId: `tx-stress-${i}`,
        action: 'create',
        actorId: `user-${i % 10}`,
        requestId: `req-stress-${i}`,
        details: { index: i, amount: (i + 1) * 1000 },
      });
      results.push(result);
    }

    // 모든 chainSeq 고유 확인
    const seqs = results.map((r) => r.chainSeq);
    expect(new Set(seqs).size).toBe(100);

    // 순서 연속 확인
    for (let i = 0; i < 100; i++) {
      expect(seqs[i]).toBe(i + 1);
    }

    // prevHash 체이닝 확인
    for (let i = 1; i < 100; i++) {
      expect(results[i].prevHash).toBe(results[i - 1].hash);
    }

    // 전체 체인 verify
    const verification = await auditChain.verify({ tenantId: 'mysc', limit: 200 });
    expect(verification.ok).toBe(true);
    expect(verification.checked).toBe(100);
  });

  // -----------------------------------------------------------------------
  // 6-2. PII 스캐너 대량 텍스트 성능
  // -----------------------------------------------------------------------

  it('PII 암호화/복호화 대량 처리 성능 < 2초', async () => {
    const testKeyBase64 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
    const pii = createPiiProtector({
      env: {
        PII_MODE: 'local',
        PII_LOCAL_KEYRING: `k1:${testKeyBase64}`,
        PII_LOCAL_CURRENT_KEY_ID: 'k1',
      },
    });

    // 대량의 한국 PII 데이터 생성
    const piiSamples = [];
    for (let i = 0; i < 1000; i++) {
      piiSamples.push(`홍길동${i} (${900101 + i}-${1234567 + i}) 국민은행 123-456-${String(i).padStart(6, '0')} hong${i}@mysc.co.kr`);
    }

    const start = performance.now();

    // 1000건 암호화
    const encrypted = await Promise.all(
      piiSamples.map((s) => pii.encryptText(s)),
    );

    // 1000건 복호화
    const decrypted = await Promise.all(
      encrypted.map((e) => pii.decryptText(e!.ciphertext)),
    );

    const elapsed = performance.now() - start;

    // 원본과 일치 확인
    for (let i = 0; i < 1000; i++) {
      expect(decrypted[i]).toBe(piiSamples[i]);
    }

    // 2초 이내 (로컬 AES이므로 충분히 빠름)
    expect(elapsed).toBeLessThan(2000);
  });

  // -----------------------------------------------------------------------
  // 6-3. 인증 스로틀링 시뮬레이션 (잘못된 토큰 100건)
  // -----------------------------------------------------------------------

  it('잘못된 토큰 100건 연속 → 모두 401 반환, 에러 누수 없음', async () => {
    const savedDomains = process.env.BFF_ALLOWED_EMAIL_DOMAINS;
    process.env.BFF_ALLOWED_EMAIL_DOMAINS = 'mysc.co.kr';

    try {
      const errors: any[] = [];

      for (let i = 0; i < 100; i++) {
        try {
          await resolveRequestIdentity({
            authMode: 'firebase_required',
            readHeaderValue: createHeaders({
              authorization: `Bearer invalid-token-${i}`,
              'x-tenant-id': 'mysc',
            }),
            verifyToken: failingVerifyToken(),
          });
        } catch (err: any) {
          errors.push(err);
        }
      }

      expect(errors).toHaveLength(100);
      for (const err of errors) {
        expect(err.statusCode).toBe(401);
        expect(err.code).toBe('invalid_token');
        // 에러 메시지에 내부 구현 상세가 누출되지 않는지 확인
        expect(err.message).toBe('Invalid Firebase ID token');
      }
    } finally {
      if (savedDomains === undefined) delete process.env.BFF_ALLOWED_EMAIL_DOMAINS;
      else process.env.BFF_ALLOWED_EMAIL_DOMAINS = savedDomains;
    }
  });

  // -----------------------------------------------------------------------
  // 6-4. 알림 대량 생성 부하
  // -----------------------------------------------------------------------

  it('승인자 20명 → 20건 알림 한 번에 생성', async () => {
    const db = createMockFirestore();

    db._store.set('orgs/mysc/transactions/tx-bulk', {
      id: 'tx-bulk',
      counterparty: '대량처리테스트사',
      amount: 100000000,
      state: 'SUBMITTED',
      submittedBy: 'pm-submitter',
    });

    // 20명의 admin/finance 멤버 생성
    for (let i = 0; i < 20; i++) {
      db._store.set(`orgs/mysc/members/approver-${i}`, {
        uid: `approver-${i}`,
        role: i % 2 === 0 ? 'admin' : 'finance',
      });
    }
    // 제출자도 멤버로 등록 (pm이므로 알림 대상 아님)
    db._store.set('orgs/mysc/members/pm-submitter', {
      uid: 'pm-submitter',
      role: 'pm',
    });

    const event = {
      id: 'evt-bulk',
      tenantId: 'mysc',
      entityId: 'tx-bulk',
      eventType: 'transaction.state_changed',
      payload: { nextState: 'SUBMITTED', actorId: 'pm-submitter' },
      createdAt: '2026-03-26T09:00:00.000Z',
    };

    const start = performance.now();
    const result = await createNotificationsForOutboxEvent(
      db,
      event,
      '2026-03-26T09:00:00.000Z',
    );
    const elapsed = performance.now() - start;

    expect(result.created).toBe(20);
    expect(elapsed).toBeLessThan(1000); // 1초 이내
  });
});
