import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { featureFlags } from '../config/feature-flags';
import { useAuth } from './auth-store';
import type { BoardChannel, BoardComment, BoardPost } from './types';
import { getOrgCollectionPath, getOrgDocumentPath } from '../lib/firebase';
import { useFirebase } from '../lib/firebase-context';
import { buildVoteDelta, normalizeTags } from './board.helpers';

type VoteDirection = 'up' | 'down';

interface BoardState {
  posts: BoardPost[];
}

interface BoardActions {
  createPost: (data: { title: string; body: string; channel: BoardChannel; tagsInput?: string }) => Promise<BoardPost | null>;
  updatePost: (postId: string, patch: Partial<Pick<BoardPost, 'title' | 'body' | 'tags' | 'channel'>>) => Promise<boolean>;
  deletePost: (postId: string) => Promise<boolean>;
  votePost: (postId: string, direction: VoteDirection) => Promise<{ ok: boolean; value: -1 | 0 | 1 }>;
  addComment: (postId: string, body: string, parentId?: string | null) => Promise<BoardComment | null>;
  updateComment: (commentId: string, body: string) => Promise<boolean>;
  deleteComment: (postId: string, commentId: string) => Promise<boolean>;
  buildVoteDocId: (postId: string, voterId: string) => string;
}

const _g = globalThis as any;
if (!_g.__MYSC_BOARD_CTX__) {
  _g.__MYSC_BOARD_CTX__ = createContext<(BoardState & BoardActions) | null>(null);
}
const BoardContext: React.Context<(BoardState & BoardActions) | null> = _g.__MYSC_BOARD_CTX__;

function safeText(value: unknown, max = 5000): string {
  return String(value || '').trim().slice(0, max);
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function buildVoteDocId(postId: string, voterId: string): string {
  const safePost = safeText(postId, 80).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeVoter = safeText(voterId, 80).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `bv_${safePost}_${safeVoter}`;
}

const INITIAL_POSTS: BoardPost[] = [
  {
    id: 'bp-001',
    tenantId: 'mysc',
    channel: 'general',
    title: '전사 게시판 사용 안내',
    body: [
      '이 공간은 전사 공지, 질문(Q&A), 아이디어, 도움요청을 공유하는 게시판입니다.',
      '',
      '- 질문은 Q&A 채널을 사용하세요.',
      '- 운영상 긴급한 이슈는 별도 승인/업무 플로우를 따르세요.',
      '',
      '좋은 글에는 추천을 눌러주세요.',
    ].join('\n'),
    tags: ['guide'],
    createdBy: 'system',
    createdByName: '시스템',
    createdByRole: 'admin',
    createdAt: '2026-02-15T00:00:00.000Z',
    updatedAt: '2026-02-15T00:00:00.000Z',
    lastActivityAt: '2026-02-15T00:00:00.000Z',
    commentCount: 0,
    upvoteCount: 0,
    downvoteCount: 0,
    voteScore: 0,
  },
];

export function BoardProvider({ children }: { children: ReactNode }) {
  const { db, isOnline, orgId } = useFirebase();
  const { user } = useAuth();
  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db && !!user?.uid;

  const [posts, setPosts] = useState<BoardPost[]>(INITIAL_POSTS);
  const [localVotesByPostId, setLocalVotesByPostId] = useState<Record<string, -1 | 0 | 1>>({});
  const unsubsRef = useRef<Unsubscribe[]>([]);
  const localVotesRef = useRef<Record<string, -1 | 0 | 1>>({});

  useEffect(() => {
    localVotesRef.current = localVotesByPostId;
  }, [localVotesByPostId]);

  useEffect(() => {
    // Local vote state should not leak across users.
    setLocalVotesByPostId({});
  }, [user?.uid]);

  useEffect(() => {
    unsubsRef.current.forEach((unsub) => unsub());
    unsubsRef.current = [];

    if (!firestoreEnabled || !db) {
      setPosts(INITIAL_POSTS);
      return;
    }

    const postsQuery = query(
      collection(db, getOrgCollectionPath(orgId, 'boardPosts')),
      orderBy('lastActivityAt', 'desc'),
      limit(300),
    );

    unsubsRef.current.push(
      onSnapshot(postsQuery, (snap) => {
        const list = snap.docs.map((d) => d.data() as BoardPost);
        setPosts(list);
      }, (err) => {
        console.error('[Board] posts listen error:', err);
      }),
    );

    return () => {
      unsubsRef.current.forEach((unsub) => unsub());
      unsubsRef.current = [];
    };
  }, [firestoreEnabled, db, orgId]);

  const createPost = useCallback(async (data: {
    title: string;
    body: string;
    channel: BoardChannel;
    tagsInput?: string;
  }): Promise<BoardPost | null> => {
    const actor = user;
    const title = safeText(data.title, 120);
    const body = safeText(data.body, 8000);
    const channel = data.channel;
    const tags = normalizeTags(data.tagsInput || '');
    if (!title || !body || !actor) return null;

    const now = new Date().toISOString();
    const id = generateId('bp');
    const post: BoardPost = {
      id,
      tenantId: orgId,
      channel,
      title,
      body,
      tags,
      createdBy: actor.uid,
      createdByName: actor.name || '사용자',
      createdByRole: actor.role,
      createdByAvatarUrl: actor.avatarUrl,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      commentCount: 0,
      upvoteCount: 0,
      downvoteCount: 0,
      voteScore: 0,
      deletedAt: null,
    };

    setPosts((prev) => [post, ...prev]);

    if (firestoreEnabled && db) {
      const ref = doc(db, getOrgDocumentPath(orgId, 'boardPosts', id));
      await setDoc(ref, post, { merge: true });
    }

    return post;
  }, [db, firestoreEnabled, orgId, user]);

  const updatePost = useCallback(async (
    postId: string,
    patch: Partial<Pick<BoardPost, 'title' | 'body' | 'tags' | 'channel'>>,
  ): Promise<boolean> => {
    const title = patch.title !== undefined ? safeText(patch.title, 120) : undefined;
    const body = patch.body !== undefined ? safeText(patch.body, 8000) : undefined;
    const tags = patch.tags ? patch.tags.slice(0, 10) : undefined;
    const channel = patch.channel;
    const now = new Date().toISOString();

    setPosts((prev) => prev.map((p) => (
      p.id !== postId
        ? p
        : {
            ...p,
            ...(title !== undefined ? { title } : null),
            ...(body !== undefined ? { body } : null),
            ...(tags !== undefined ? { tags } : null),
            ...(channel !== undefined ? { channel } : null),
            updatedAt: now,
            lastActivityAt: now,
          }
    )));

    if (firestoreEnabled && db) {
      const ref = doc(db, getOrgDocumentPath(orgId, 'boardPosts', postId));
      await updateDoc(ref, {
        ...(title !== undefined ? { title } : null),
        ...(body !== undefined ? { body } : null),
        ...(tags !== undefined ? { tags } : null),
        ...(channel !== undefined ? { channel } : null),
        updatedAt: now,
        lastActivityAt: now,
      } as any);
    }
    return true;
  }, [db, firestoreEnabled, orgId]);

  const deletePost = useCallback(async (postId: string): Promise<boolean> => {
    const now = new Date().toISOString();

    setPosts((prev) => prev.map((p) => (
      p.id !== postId ? p : { ...p, deletedAt: now, updatedAt: now }
    )));

    if (firestoreEnabled && db) {
      const ref = doc(db, getOrgDocumentPath(orgId, 'boardPosts', postId));
      await updateDoc(ref, { deletedAt: now, updatedAt: now } as any);
    }
    return true;
  }, [db, firestoreEnabled, orgId]);

  const votePost = useCallback(async (postId: string, direction: VoteDirection) => {
    const actor = user;
    if (!actor) return { ok: false, value: 0 as const };

    const voterId = actor.uid;
    const docId = buildVoteDocId(postId, voterId);

    if (!firestoreEnabled || !db) {
      const prevLocal: -1 | 0 | 1 = localVotesRef.current[postId] ?? 0;
      const nextLocal: -1 | 0 | 1 =
        direction === 'up'
          ? (prevLocal === 1 ? 0 : 1)
          : (prevLocal === -1 ? 0 : -1);

      const delta = buildVoteDelta(prevLocal, nextLocal);
      setLocalVotesByPostId((prev) => {
        const next = { ...prev };
        if (nextLocal === 0) {
          delete next[postId];
        } else {
          next[postId] = nextLocal;
        }
        return next;
      });
      setPosts((prev) => prev.map((p) => (
        p.id !== postId
          ? p
          : {
              ...p,
              upvoteCount: (p.upvoteCount || 0) + delta.upDelta,
              downvoteCount: (p.downvoteCount || 0) + delta.downDelta,
              voteScore: (p.voteScore || 0) + delta.scoreDelta,
            }
      )));
      return { ok: true, value: nextLocal };
    }

    const postRef = doc(db, getOrgDocumentPath(orgId, 'boardPosts', postId));
    const voteRef = doc(db, getOrgDocumentPath(orgId, 'boardVotes', docId));
    const now = new Date().toISOString();

    const result = await runTransaction(db, async (tx) => {
      const [postSnap, voteSnap] = await Promise.all([tx.get(postRef), tx.get(voteRef)]);
      if (!postSnap.exists()) {
        return { ok: false, value: 0 as const };
      }

      const prev = voteSnap.exists() ? (voteSnap.data()?.value as any) : 0;
      const prevValue: -1 | 0 | 1 = prev === 1 ? 1 : prev === -1 ? -1 : 0;
      const nextValue: -1 | 0 | 1 =
        direction === 'up'
          ? (prevValue === 1 ? 0 : 1)
          : (prevValue === -1 ? 0 : -1);

      const delta = buildVoteDelta(prevValue, nextValue);
      tx.update(postRef, {
        upvoteCount: increment(delta.upDelta),
        downvoteCount: increment(delta.downDelta),
        voteScore: increment(delta.scoreDelta),
        updatedAt: now,
      });

      if (nextValue === 0) {
        if (voteSnap.exists()) tx.delete(voteRef);
      } else if (voteSnap.exists()) {
        tx.update(voteRef, { value: nextValue, updatedAt: now });
      } else {
        tx.set(voteRef, {
          id: docId,
          tenantId: orgId,
          postId,
          voterId,
          value: nextValue,
          createdAt: now,
          updatedAt: now,
        });
      }

      return { ok: true, value: nextValue };
    });

    return result;
  }, [db, firestoreEnabled, orgId, user]);

  const addComment = useCallback(async (postId: string, bodyInput: string, parentId?: string | null) => {
    const actor = user;
    const body = safeText(bodyInput, 5000);
    if (!actor || !body) return null;

    const now = new Date().toISOString();
    const id = generateId('bc');
    const comment: BoardComment = {
      id,
      tenantId: orgId,
      postId,
      parentId: parentId || null,
      body,
      createdBy: actor.uid,
      createdByName: actor.name || '사용자',
      createdByAvatarUrl: actor.avatarUrl,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    if (!firestoreEnabled || !db) {
      setPosts((prev) => prev.map((p) => (
        p.id !== postId
          ? p
          : {
              ...p,
              commentCount: (p.commentCount || 0) + 1,
              lastActivityAt: now,
              updatedAt: now,
            }
      )));
      return comment;
    }

    const commentRef = doc(db, getOrgDocumentPath(orgId, 'boardComments', id));
    const postRef = doc(db, getOrgDocumentPath(orgId, 'boardPosts', postId));
    const batch = writeBatch(db);
    batch.set(commentRef, comment, { merge: true });
    batch.update(postRef, {
      commentCount: increment(1),
      lastActivityAt: now,
      updatedAt: now,
    });
    await batch.commit();
    return comment;
  }, [db, firestoreEnabled, orgId, user]);

  const updateComment = useCallback(async (commentId: string, bodyInput: string): Promise<boolean> => {
    const body = safeText(bodyInput, 5000);
    if (!body) return false;
    const now = new Date().toISOString();

    if (firestoreEnabled && db) {
      const ref = doc(db, getOrgDocumentPath(orgId, 'boardComments', commentId));
      await updateDoc(ref, { body, updatedAt: now } as any);
    }
    return true;
  }, [db, firestoreEnabled, orgId]);

  const deleteComment = useCallback(async (postId: string, commentId: string): Promise<boolean> => {
    const now = new Date().toISOString();

    if (!firestoreEnabled || !db) {
      setPosts((prev) => prev.map((p) => (
        p.id !== postId
          ? p
          : { ...p, commentCount: Math.max(0, (p.commentCount || 0) - 1), updatedAt: now }
      )));
      return true;
    }

    const commentRef = doc(db, getOrgDocumentPath(orgId, 'boardComments', commentId));
    const postRef = doc(db, getOrgDocumentPath(orgId, 'boardPosts', postId));
    const batch = writeBatch(db);
    batch.update(commentRef, { deletedAt: now, updatedAt: now });
    batch.update(postRef, {
      commentCount: increment(-1),
      updatedAt: now,
    });
    await batch.commit();
    return true;
  }, [db, firestoreEnabled, orgId]);

  const value = useMemo<BoardState & BoardActions>(() => ({
    posts,
    createPost,
    updatePost,
    deletePost,
    votePost,
    addComment,
    updateComment,
    deleteComment,
    buildVoteDocId,
  }), [posts, createPost, updatePost, deletePost, votePost, addComment, updateComment, deleteComment]);

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

export function useBoard() {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('useBoard must be inside BoardProvider');
  return ctx;
}
