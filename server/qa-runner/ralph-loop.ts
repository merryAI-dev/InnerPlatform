import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface QaIssue {
  id: string;
  title: string;
  body: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  surface?: string;
  labels?: string[];
  createdAt?: string;
}

export interface QaMemoryEntry {
  id: string;
  kind: 'resolution' | 'failure' | 'rollback' | 'selector';
  issueId?: string;
  summary: string;
  detail?: string;
  tags: string[];
  createdAt: string;
}

export interface QaRollbackEntry {
  key: string;
  issueId: string;
  reason: string;
  flagName?: string;
  before?: unknown;
  after?: unknown;
  rollbackPatch?: unknown;
  createdAt: string;
}

export interface QaRunRecord {
  runId: string;
  issueId: string;
  repoSha: string;
  issueFingerprint: string;
  status: 'planned' | 'verified' | 'failed' | 'rolled_back';
  planHash?: string;
  cacheKeys: string[];
  rollbackKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RalphLoopStore {
  getCache<T>(key: string): Promise<T | undefined>;
  setCache<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  addMemory(entry: QaMemoryEntry): Promise<void>;
  queryMemory(tags: string[], limit?: number): Promise<QaMemoryEntry[]>;
  createRun(run: QaRunRecord): Promise<void>;
  updateRun(runId: string, updates: Partial<QaRunRecord>): Promise<void>;
  recordRollback(entry: QaRollbackEntry): Promise<void>;
  listRollbacks(issueId?: string): Promise<QaRollbackEntry[]>;
}

export interface RalphLoopHandlers<TClassification, TPlan, TExecution, TVerification> {
  classify: (input: { issue: QaIssue; memory: QaMemoryEntry[] }) => Promise<TClassification> | TClassification;
  plan: (input: { issue: QaIssue; classification: TClassification; memory: QaMemoryEntry[] }) => Promise<TPlan> | TPlan;
  execute: (input: { issue: QaIssue; classification: TClassification; plan: TPlan; memory: QaMemoryEntry[] }) => Promise<TExecution> | TExecution;
  verify: (input: { issue: QaIssue; classification: TClassification; plan: TPlan; execution: TExecution }) => Promise<TVerification & { ok: boolean; rollback?: Omit<QaRollbackEntry, 'key' | 'issueId' | 'createdAt'> }> | (TVerification & { ok: boolean; rollback?: Omit<QaRollbackEntry, 'key' | 'issueId' | 'createdAt'> });
  learn?: (input: {
    issue: QaIssue;
    classification: TClassification;
    plan: TPlan;
    execution: TExecution;
    verification: TVerification & { ok: boolean };
    rollbackKey?: string;
  }) => Promise<QaMemoryEntry[]> | QaMemoryEntry[];
}

interface CacheEnvelope<T> {
  value: T;
  expiresAt?: string;
}

function stableHash(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

function toIso(input = new Date()): string {
  return input instanceof Date ? input.toISOString() : new Date(input).toISOString();
}

async function ensureDir(targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function readJsonLinesFile<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

async function appendJsonLine(filePath: string, payload: unknown): Promise<void> {
  const existing = await readFile(filePath, 'utf8').catch(() => '');
  const next = `${existing}${existing ? '\n' : ''}${JSON.stringify(payload)}`;
  await writeFile(filePath, next, 'utf8');
}

export function buildIssueFingerprint(issue: QaIssue): string {
  return stableHash([
    issue.title.trim().toLowerCase(),
    issue.body.trim().toLowerCase(),
    issue.surface || '',
    issue.severity,
    (issue.labels || []).join(','),
  ].join('|'));
}

export function buildPlanHash(input: unknown): string {
  return stableHash(JSON.stringify(input));
}

export function createFileRalphLoopStore(baseDir: string): RalphLoopStore {
  const cacheDir = path.join(baseDir, 'cache');
  const runsDir = path.join(baseDir, 'runs');
  const memoryPath = path.join(baseDir, 'memory.jsonl');
  const rollbackPath = path.join(baseDir, 'rollback-ledger.jsonl');

  async function cachePathForKey(key: string): Promise<string> {
    await ensureDir(cacheDir);
    return path.join(cacheDir, `${stableHash(key)}.json`);
  }

  async function runPath(runId: string): Promise<string> {
    await ensureDir(runsDir);
    return path.join(runsDir, `${runId}.json`);
  }

  return {
    async getCache<T>(key: string) {
      const filePath = await cachePathForKey(key);
      const envelope = await readJsonFile<CacheEnvelope<T> | null>(filePath, null);
      if (!envelope) return undefined;
      if (envelope.expiresAt && new Date(envelope.expiresAt) <= new Date()) {
        return undefined;
      }
      return envelope.value;
    },

    async setCache<T>(key: string, value: T, ttlMs = 5 * 60 * 1000) {
      const filePath = await cachePathForKey(key);
      const expiresAt = ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : undefined;
      await writeFile(filePath, JSON.stringify({ value, expiresAt }, null, 2), 'utf8');
    },

    async addMemory(entry: QaMemoryEntry) {
      await ensureDir(baseDir);
      await appendJsonLine(memoryPath, entry);
    },

    async queryMemory(tags: string[], limit = 5) {
      const entries = await readJsonLinesFile<QaMemoryEntry>(memoryPath);
      const normalizedTags = tags.map((tag) => tag.toLowerCase());
      return entries
        .map((entry) => ({
          entry,
          score: entry.tags.reduce((count, tag) => {
            return count + (normalizedTags.includes(tag.toLowerCase()) ? 1 : 0);
          }, 0),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return String(b.entry.createdAt).localeCompare(String(a.entry.createdAt));
        })
        .slice(0, limit)
        .map((item) => item.entry);
    },

    async createRun(run: QaRunRecord) {
      const filePath = await runPath(run.runId);
      await writeFile(filePath, JSON.stringify(run, null, 2), 'utf8');
    },

    async updateRun(runId: string, updates: Partial<QaRunRecord>) {
      const filePath = await runPath(runId);
      const current = await readJsonFile<QaRunRecord | null>(filePath, null);
      if (!current) return;
      await writeFile(
        filePath,
        JSON.stringify({ ...current, ...updates, updatedAt: toIso() }, null, 2),
        'utf8',
      );
    },

    async recordRollback(entry: QaRollbackEntry) {
      await ensureDir(baseDir);
      await appendJsonLine(rollbackPath, entry);
    },

    async listRollbacks(issueId?: string) {
      const entries = await readJsonLinesFile<QaRollbackEntry>(rollbackPath);
      return issueId ? entries.filter((entry) => entry.issueId === issueId) : entries;
    },
  };
}

export async function listRunFiles(baseDir: string): Promise<string[]> {
  const runsDir = path.join(baseDir, 'runs');
  await ensureDir(runsDir);
  const entries = await readdir(runsDir);
  return entries.filter((entry) => entry.endsWith('.json'));
}

export async function runRalphLoop<TClassification, TPlan, TExecution, TVerification>(
  input: {
    issue: QaIssue;
    repoSha: string;
    store: RalphLoopStore;
    handlers: RalphLoopHandlers<TClassification, TPlan, TExecution, TVerification>;
    cacheTtlMs?: number;
  },
): Promise<{
  run: QaRunRecord;
  classification: TClassification;
  plan: TPlan;
  execution: TExecution;
  verification: TVerification & { ok: boolean };
  memory: QaMemoryEntry[];
  rollback?: QaRollbackEntry;
}> {
  const issueFingerprint = buildIssueFingerprint(input.issue);
  const cacheBase = `${input.repoSha}:${issueFingerprint}`;
  const memoryTags = [
    input.issue.surface || 'unknown',
    input.issue.severity,
    ...(input.issue.labels || []),
  ];
  const memory = await input.store.queryMemory(memoryTags, 5);
  const classifyCacheKey = `${cacheBase}:classify`;
  const planCacheKey = `${cacheBase}:plan`;
  const cachedClassification = await input.store.getCache<TClassification>(classifyCacheKey);
  const classification = cachedClassification
    ?? await input.handlers.classify({ issue: input.issue, memory });
  if (!cachedClassification) {
    await input.store.setCache(classifyCacheKey, classification, input.cacheTtlMs);
  }

  const cachedPlan = await input.store.getCache<TPlan>(planCacheKey);
  const plan = cachedPlan
    ?? await input.handlers.plan({ issue: input.issue, classification, memory });
  if (!cachedPlan) {
    await input.store.setCache(planCacheKey, plan, input.cacheTtlMs);
  }

  const now = toIso();
  const run: QaRunRecord = {
    runId: `run_${randomUUID().slice(0, 8)}`,
    issueId: input.issue.id,
    repoSha: input.repoSha,
    issueFingerprint,
    status: 'planned',
    planHash: buildPlanHash(plan),
    cacheKeys: [classifyCacheKey, planCacheKey],
    createdAt: now,
    updatedAt: now,
  };
  await input.store.createRun(run);

  const execution = await input.handlers.execute({
    issue: input.issue,
    classification,
    plan,
    memory,
  });
  const verification = await input.handlers.verify({
    issue: input.issue,
    classification,
    plan,
    execution,
  });

  let rollback: QaRollbackEntry | undefined;
  let nextStatus: QaRunRecord['status'] = verification.ok ? 'verified' : 'failed';

  if (!verification.ok && verification.rollback) {
    rollback = {
      key: `rb_${stableHash(`${input.issue.id}:${Date.now()}`)}`.slice(0, 16),
      issueId: input.issue.id,
      createdAt: toIso(),
      ...verification.rollback,
    };
    await input.store.recordRollback(rollback);
    nextStatus = 'rolled_back';
  }

  await input.store.updateRun(run.runId, {
    status: nextStatus,
    rollbackKey: rollback?.key,
  });

  const learnedEntries = input.handlers.learn
    ? await input.handlers.learn({
      issue: input.issue,
      classification,
      plan,
      execution,
      verification,
      rollbackKey: rollback?.key,
    })
    : [{
      id: `mem_${randomUUID().slice(0, 8)}`,
      kind: rollback ? 'rollback' : verification.ok ? 'resolution' : 'failure',
      issueId: input.issue.id,
      summary: verification.ok ? input.issue.title : `${input.issue.title} 검증 실패`,
      tags: memoryTags,
      detail: rollback?.reason,
      createdAt: toIso(),
    }];

  for (const entry of learnedEntries) {
    await input.store.addMemory(entry);
  }

  return {
    run: { ...run, status: nextStatus, rollbackKey: rollback?.key, updatedAt: toIso() },
    classification,
    plan,
    execution,
    verification,
    memory,
    rollback,
  };
}

export async function getLatestRun(baseDir: string): Promise<QaRunRecord | null> {
  const runsDir = path.join(baseDir, 'runs');
  await ensureDir(runsDir);
  const files = await readdir(runsDir);
  const stats = await Promise.all(
    files.map(async (file) => ({
      file,
      stat: await stat(path.join(runsDir, file)),
    })),
  );
  const latest = stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
  if (!latest) return null;
  return readJsonFile<QaRunRecord | null>(path.join(runsDir, latest.file), null);
}
