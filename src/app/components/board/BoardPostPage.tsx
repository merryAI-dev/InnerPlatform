import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ArrowLeft,
  ArrowBigUp,
  ArrowBigDown,
  MessageCircle,
  Reply,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { Separator } from '../ui/separator';
import { EmptyState } from '../ui/empty-state';
import { useAuth } from '../../data/auth-store';
import { useBoard } from '../../data/board-store';
import type { BoardComment } from '../../data/types';
import { BOARD_CHANNEL_LABELS } from '../../data/types';
import { useFirebase } from '../../lib/firebase-context';
import { featureFlags } from '../../config/feature-flags';
import { getOrgCollectionPath, getOrgDocumentPath } from '../../lib/firebase';

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function groupReplies(comments: BoardComment[]) {
  const byParent = new Map<string, BoardComment[]>();
  const roots: BoardComment[] = [];
  for (const c of comments) {
    if (c.deletedAt) continue;
    const parentId = c.parentId || '';
    if (!parentId) {
      roots.push(c);
      continue;
    }
    const list = byParent.get(parentId) || [];
    list.push(c);
    byParent.set(parentId, list);
  }
  return { roots, byParent };
}

export function BoardPostPage() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { posts, votePost, addComment, buildVoteDocId } = useBoard();
  const { db, isOnline, orgId } = useFirebase();

  const [comments, setComments] = useState<BoardComment[]>([]);
  const [myVote, setMyVote] = useState<-1 | 0 | 1>(0);
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');

  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db && !!user?.uid;
  const id = String(postId || '');

  const post = useMemo(() => posts.find((p) => p.id === id) || null, [posts, id]);

  useEffect(() => {
    if (!firestoreEnabled || !db || !id) {
      setComments([]);
      return;
    }

    const q = query(
      collection(db, getOrgCollectionPath(orgId, 'boardComments')),
      where('postId', '==', id),
      orderBy('createdAt', 'asc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      setComments(snap.docs.map((d) => d.data() as BoardComment));
    }, (err) => {
      console.error('[Board] comments listen error:', err);
    });

    return () => unsub();
  }, [firestoreEnabled, db, orgId, id]);

  useEffect(() => {
    if (!firestoreEnabled || !db || !id || !user?.uid) {
      setMyVote(0);
      return;
    }

    const voteId = buildVoteDocId(id, user.uid);
    const voteRef = doc(db, getOrgDocumentPath(orgId, 'boardVotes', voteId));
    const unsub: Unsubscribe = onSnapshot(voteRef, (snap) => {
      if (!snap.exists()) {
        setMyVote(0);
        return;
      }
      const v = snap.data()?.value;
      setMyVote(v === 1 ? 1 : v === -1 ? -1 : 0);
    }, () => setMyVote(0));
    return () => unsub();
  }, [firestoreEnabled, db, orgId, id, user?.uid, buildVoteDocId]);

  const threaded = useMemo(() => groupReplies(comments), [comments]);

  async function submitComment() {
    if (!content.trim() || !id) return;
    const created = await addComment(id, content);
    if (!created) return;
    if (!firestoreEnabled) setComments((prev) => [...prev, created]);
    setContent('');
  }

  async function submitReply(parentId: string) {
    if (!replyContent.trim() || !id) return;
    const created = await addComment(id, replyContent, parentId);
    if (!created) return;
    if (!firestoreEnabled) setComments((prev) => [...prev, created]);
    setReplyContent('');
    setReplyTo(null);
  }

  if (!id || !post) {
    return (
      <Card>
        <EmptyState
          icon={MessageCircle}
          title="글을 찾을 수 없습니다"
          description="삭제되었거나 접근할 수 없는 글입니다."
          action={{ label: '게시판으로', onClick: () => navigate('/board'), icon: ArrowLeft }}
          variant="compact"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate('/board')}>
        <ArrowLeft className="w-4 h-4" />
        게시판으로
      </Button>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-12 shrink-0 flex flex-col items-center justify-start pt-0.5">
              <Button
                variant={myVote === 1 ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={async () => {
                  const result = await votePost(post.id, 'up');
                  if (result.ok) setMyVote(result.value);
                }}
              >
                <ArrowBigUp className="w-4 h-4" />
              </Button>
              <p className="text-[12px]" style={{ fontWeight: 800 }}>{post.voteScore || 0}</p>
              <Button
                variant={myVote === -1 ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={async () => {
                  const result = await votePost(post.id, 'down');
                  if (result.ok) setMyVote(result.value);
                }}
              >
                <ArrowBigDown className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-muted/20">
                  {BOARD_CHANNEL_LABELS[post.channel]}
                </Badge>
                <h1 className="text-[18px] leading-tight" style={{ fontWeight: 900, letterSpacing: '-0.03em' }}>
                  {post.title}
                </h1>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                <span style={{ fontWeight: 600 }}>{post.createdByName}</span>
                <span>·</span>
                <span>{fmtTime(post.createdAt)}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="w-3.5 h-3.5" />
                  {post.commentCount || 0}
                </span>
              </div>

              {(post.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {(post.tags || []).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] h-4 px-1.5">
                      #{t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <Separator />

          <div className="text-[13px] leading-relaxed whitespace-pre-wrap">
            {post.body}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-[12px]" style={{ fontWeight: 800 }}>댓글</p>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="댓글을 입력하세요"
            className="min-h-[90px]"
          />
          <div className="flex justify-end">
            <Button onClick={submitComment} disabled={!content.trim()}>
              댓글 등록
            </Button>
          </div>

          <Separator />

          {threaded.roots.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">아직 댓글이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {threaded.roots.map((c) => {
                const replies = threaded.byParent.get(c.id) || [];
                return (
                  <div key={c.id} className="space-y-2">
                    <div className="rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] text-muted-foreground">
                          <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>{c.createdByName}</span>
                          <span className="mx-1">·</span>
                          <span>{fmtTime(c.createdAt)}</span>
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setReplyTo((prev) => (prev === c.id ? null : c.id))}>
                          <Reply className="w-3.5 h-3.5" />
                          답글
                        </Button>
                      </div>
                      <p className="mt-2 text-[13px] whitespace-pre-wrap">{c.body}</p>

                      {replyTo === c.id && (
                        <div className="mt-3 space-y-2">
                          <Textarea
                            value={replyContent}
                            onChange={(e) => setReplyContent(e.target.value)}
                            placeholder="답글을 입력하세요"
                            className="min-h-[80px]"
                          />
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => { setReplyTo(null); setReplyContent(''); }}>
                              취소
                            </Button>
                            <Button onClick={() => submitReply(c.id)} disabled={!replyContent.trim()}>
                              답글 등록
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {replies.length > 0 && (
                      <div className="pl-6 space-y-2">
                        {replies.map((r) => (
                          <div key={r.id} className="rounded-lg border bg-muted/20 p-3">
                            <div className="text-[11px] text-muted-foreground">
                              <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>{r.createdByName}</span>
                              <span className="mx-1">·</span>
                              <span>{fmtTime(r.createdAt)}</span>
                            </div>
                            <p className="mt-2 text-[13px] whitespace-pre-wrap">{r.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
