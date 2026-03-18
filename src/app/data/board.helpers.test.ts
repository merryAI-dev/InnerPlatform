import { describe, expect, it } from 'vitest';
import { buildVoteDelta, computeHotScore, normalizeTags, previewText, sortBoardPosts } from './board.helpers';
import type { BoardPost } from './types';

describe('board helpers', () => {
  it('normalizes tags', () => {
    expect(normalizeTags('  a  b, c, #C  a  ')).toEqual(['a', 'b', 'c']);
    expect(normalizeTags('')).toEqual([]);
    expect(normalizeTags('x'.repeat(100))).toEqual(['x'.repeat(24)]);
  });

  it('builds preview text', () => {
    expect(previewText('')).toBe('');
    expect(previewText('  hello\nworld  ')).toBe('hello world');
    expect(previewText('a'.repeat(10), 10)).toBe('a'.repeat(10));
    expect(previewText('a'.repeat(11), 10)).toBe('a'.repeat(7) + '...');
  });

  it('computes vote deltas', () => {
    expect(buildVoteDelta(0, 1)).toEqual({ upDelta: 1, downDelta: 0, scoreDelta: 1 });
    expect(buildVoteDelta(1, 0)).toEqual({ upDelta: -1, downDelta: 0, scoreDelta: -1 });
    expect(buildVoteDelta(0, -1)).toEqual({ upDelta: 0, downDelta: 1, scoreDelta: -1 });
    expect(buildVoteDelta(-1, 0)).toEqual({ upDelta: 0, downDelta: -1, scoreDelta: 1 });
    expect(buildVoteDelta(-1, 1)).toEqual({ upDelta: 1, downDelta: -1, scoreDelta: 2 });
    expect(buildVoteDelta(1, -1)).toEqual({ upDelta: -1, downDelta: 1, scoreDelta: -2 });
  });

  it('computes hot score with time decay', () => {
    const now = '2026-02-15T12:00:00.000Z';
    const recent = computeHotScore({ voteScore: 5, commentCount: 0, createdAt: '2026-02-15T11:00:00.000Z', nowIso: now });
    const old = computeHotScore({ voteScore: 5, commentCount: 0, createdAt: '2026-02-10T11:00:00.000Z', nowIso: now });
    expect(recent).toBeGreaterThan(old);
  });

  it('sorts posts by selected mode', () => {
    const now = '2026-02-15T12:00:00.000Z';
    const posts: BoardPost[] = [
      {
        id: 'a',
        channel: 'general',
        title: 'a',
        body: 'a',
        tags: [],
        createdBy: 'u1',
        createdByName: 'u1',
        createdAt: '2026-02-15T10:00:00.000Z',
        updatedAt: '2026-02-15T10:00:00.000Z',
        lastActivityAt: '2026-02-15T10:00:00.000Z',
        commentCount: 0,
        upvoteCount: 0,
        downvoteCount: 0,
        voteScore: 10,
      },
      {
        id: 'b',
        channel: 'general',
        title: 'b',
        body: 'b',
        tags: [],
        createdBy: 'u1',
        createdByName: 'u1',
        createdAt: '2026-02-15T11:00:00.000Z',
        updatedAt: '2026-02-15T11:00:00.000Z',
        lastActivityAt: '2026-02-15T11:30:00.000Z',
        commentCount: 5,
        upvoteCount: 0,
        downvoteCount: 0,
        voteScore: 1,
      },
    ];

    expect(sortBoardPosts(posts, 'new', now).map((p) => p.id)).toEqual(['b', 'a']);
    expect(sortBoardPosts(posts, 'active', now).map((p) => p.id)).toEqual(['b', 'a']);
    expect(sortBoardPosts(posts, 'top', now).map((p) => p.id)).toEqual(['a', 'b']);

    const hot = sortBoardPosts(posts, 'hot', now).map((p) => p.id);
    expect(hot.length).toBe(2);
  });
});
