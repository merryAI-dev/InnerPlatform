import type { BoardPost } from './types';

export type BoardSort = 'new' | 'top' | 'active' | 'hot';

export function normalizeTags(input: string, { max = 10 } = {}): string[] {
  const raw = String(input || '')
    .split(/[,\n]/g)
    .flatMap((chunk) => chunk.split(/\s+/g))
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw) {
    const normalized = tag.replace(/^#/, '').slice(0, 24);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

export function previewText(input: string, maxLen = 140): string {
  const raw = String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, Math.max(0, maxLen - 3)).trimEnd() + '...';
}

function parseIsoOrNow(value: string, fallback: Date): Date {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

export function computeHotScore({
  voteScore,
  commentCount,
  createdAt,
  nowIso,
}: {
  voteScore: number;
  commentCount: number;
  createdAt: string;
  nowIso: string;
}): number {
  const now = parseIsoOrNow(nowIso, new Date());
  const created = parseIsoOrNow(createdAt, now);
  const ageHours = Math.max(1, (now.getTime() - created.getTime()) / 36e5);
  const signal = (Number(voteScore) || 0) + (Number(commentCount) || 0) * 0.5;
  return signal / Math.pow(ageHours, 1.35);
}

export function buildVoteDelta(prevValue: -1 | 0 | 1, nextValue: -1 | 0 | 1) {
  const prevUp = prevValue === 1 ? 1 : 0;
  const prevDown = prevValue === -1 ? 1 : 0;
  const nextUp = nextValue === 1 ? 1 : 0;
  const nextDown = nextValue === -1 ? 1 : 0;
  return {
    upDelta: nextUp - prevUp,
    downDelta: nextDown - prevDown,
    scoreDelta: nextValue - prevValue,
  };
}

export function sortBoardPosts(posts: BoardPost[], sort: BoardSort, nowIso: string): BoardPost[] {
  const list = [...posts].filter((p) => !p.deletedAt);

  if (sort === 'new') {
    return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  if (sort === 'active') {
    return list.sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
  }
  if (sort === 'top') {
    return list.sort((a, b) => {
      const score = (b.voteScore || 0) - (a.voteScore || 0);
      if (score !== 0) return score;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }
  // hot
  return list.sort((a, b) => {
    const ah = computeHotScore({
      voteScore: a.voteScore || 0,
      commentCount: a.commentCount || 0,
      createdAt: a.createdAt,
      nowIso,
    });
    const bh = computeHotScore({
      voteScore: b.voteScore || 0,
      commentCount: b.commentCount || 0,
      createdAt: b.createdAt,
      nowIso,
    });
    const d = bh - ah;
    if (d !== 0) return d;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}
