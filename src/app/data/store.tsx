import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type {
  Project,
  Ledger,
  Transaction,
  Comment,
  Evidence,
  AuditLog,
  LedgerTemplate,
  OrgMember,
  Organization,
  TransactionState,
  ParticipationEntry,
} from './types';
import {
  ORGANIZATION,
  ORG_MEMBERS,
  CURRENT_USER,
  PROJECTS,
  LEDGERS,
  TRANSACTIONS,
  COMMENTS,
  EVIDENCES,
  AUDIT_LOGS,
  LEDGER_TEMPLATES,
} from './mock-data';
import { PARTICIPATION_ENTRIES } from './participation-data';
import { resolveAppWriteStrategy } from './store-write-strategy';
import { useFirebase } from '../lib/firebase-context';
import { featureFlags } from '../config/feature-flags';
import { useAuth } from './auth-store';
import {
  listenMembers,
  listenPartEntries,
  listenProjects,
  listenLedgers,
  listenTransactions,
  listenComments,
  listenEvidences,
  listenAuditLogs,
  addPartEntry,
  updatePartEntry,
  deletePartEntry,
  upsertProject,
  upsertLedger,
  upsertTransaction,
  changeTransactionStateFS,
  addCommentFS,
  addEvidenceFS,
  upsertMember as upsertMemberFS,
  deleteMember as deleteMemberFS,
} from '../lib/firestore-service';
import {
  addCommentViaBff,
  addEvidenceViaBff,
  changeTransactionStateViaBff,
  upsertLedgerViaBff,
  upsertProjectViaBff,
  upsertTransactionViaBff,
} from '../lib/platform-bff-client';
import type { Unsubscribe } from 'firebase/firestore';

interface EtlStagingUiPayload {
  projects?: Project[];
  members?: OrgMember[];
  ledgers?: Ledger[];
  transactions?: Transaction[];
  comments?: Comment[];
  evidences?: Evidence[];
  auditLogs?: AuditLog[];
  participationEntries?: ParticipationEntry[];
}

interface AppState {
  org: Organization;
  currentUser: OrgMember;
  members: OrgMember[];
  templates: LedgerTemplate[];
  projects: Project[];
  ledgers: Ledger[];
  transactions: Transaction[];
  comments: Comment[];
  evidences: Evidence[];
  auditLogs: AuditLog[];
  participationEntries: ParticipationEntry[];
  dataSource: 'local' | 'firestore';
}

interface AppActions {
  upsertMember: (member: OrgMember & Record<string, unknown>) => void;
  removeMember: (uid: string) => void;
  addProject: (p: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  addLedger: (l: Ledger) => void;
  addTransaction: (t: Transaction) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  changeTransactionState: (id: string, newState: TransactionState, reason?: string) => void;
  addComment: (c: Comment) => void;
  addEvidence: (e: Evidence) => void;
  addParticipation: (pe: ParticipationEntry) => void;
  updateParticipation: (id: string, updates: Partial<ParticipationEntry>) => void;
  removeParticipation: (id: string) => void;
  getProjectLedgers: (projectId: string) => Ledger[];
  getLedgerTransactions: (ledgerId: string) => Transaction[];
  getTransactionComments: (txId: string) => Comment[];
  getTransactionEvidences: (txId: string) => Evidence[];
  getProjectById: (id: string) => Project | undefined;
  getLedgerById: (id: string) => Ledger | undefined;
}

const _g = globalThis as any;
if (!_g.__MYSC_APP_CTX__) {
  _g.__MYSC_APP_CTX__ = createContext<(AppState & AppActions) | null>(null);
}
const AppContext: React.Context<(AppState & AppActions) | null> = _g.__MYSC_APP_CTX__;

function logBffWriteFailure(operation: string, err: unknown) {
  console.error(`[BFF] ${operation} failed; Firestore fallback disabled:`, err);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { db, isOnline, orgId } = useFirebase();
  const { user: authUser } = useAuth();

  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db;
  const platformApiEnabled = featureFlags.platformApiEnabled;
  const writeStrategy = useMemo(
    () => resolveAppWriteStrategy(platformApiEnabled, firestoreEnabled),
    [platformApiEnabled, firestoreEnabled],
  );

  const [projects, setProjects] = useState<Project[]>(PROJECTS);
  const [ledgers, setLedgers] = useState<Ledger[]>(LEDGERS);
  const [transactions, setTransactions] = useState<Transaction[]>(TRANSACTIONS);
  const [comments, setComments] = useState<Comment[]>(COMMENTS);
  const [evidences, setEvidences] = useState<Evidence[]>(EVIDENCES);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(AUDIT_LOGS);
  const [participationEntries, setParticipationEntries] = useState<ParticipationEntry[]>(PARTICIPATION_ENTRIES);
  const [localMembers, setLocalMembers] = useState<Array<OrgMember & Record<string, unknown>>>(ORG_MEMBERS);
  const [dataSource, setDataSource] = useState<'local' | 'firestore'>('local');

  const unsubsRef = useRef<Unsubscribe[]>([]);

  const currentUser = useMemo<OrgMember>(() => {
    if (!authUser) return CURRENT_USER;
    return {
      uid: authUser.uid,
      name: authUser.name,
      email: authUser.email,
      role: authUser.role,
      avatarUrl: authUser.avatarUrl,
    };
  }, [authUser]);

  const auditActor = useMemo(
    () => ({ id: currentUser.uid, name: currentUser.name, role: currentUser.role }),
    [currentUser.uid, currentUser.name, currentUser.role],
  );

  const bffActor = useMemo(
    () => ({
      uid: currentUser.uid,
      email: currentUser.email,
      role: currentUser.role,
      idToken: authUser?.idToken,
    }),
    [currentUser.uid, currentUser.email, currentUser.role, authUser?.idToken],
  );

  const members = useMemo<OrgMember[]>(() => {
    const baseMembers = dataSource === 'firestore'
      ? localMembers
      : (localMembers.length > 0 ? localMembers : ORG_MEMBERS);
    if (!authUser) return baseMembers;
    if (baseMembers.some((m) => m.uid === authUser.uid)) return baseMembers;
    return [currentUser, ...baseMembers];
  }, [authUser, currentUser, dataSource, localMembers]);

  useEffect(() => {
    unsubsRef.current.forEach((unsub) => unsub());
    unsubsRef.current = [];

    if (!firestoreEnabled || !db) {
      setDataSource('local');
      setProjects(PROJECTS);
      setLedgers(LEDGERS);
      setTransactions(TRANSACTIONS);
      setComments(COMMENTS);
      setEvidences(EVIDENCES);
      setAuditLogs(AUDIT_LOGS);
      setParticipationEntries(PARTICIPATION_ENTRIES);
      setLocalMembers(ORG_MEMBERS);
      return;
    }

    setDataSource('firestore');
    setLocalMembers([]);

    unsubsRef.current.push(
      listenMembers(db, orgId, (items) => setLocalMembers(items)),
    );

    unsubsRef.current.push(
      listenPartEntries(db, orgId, (entries) => setParticipationEntries(entries)),
    );

    unsubsRef.current.push(
      listenProjects(db, orgId, (projs) => setProjects(projs as Project[])),
    );

    unsubsRef.current.push(
      listenLedgers(db, orgId, (ldgs) => setLedgers(ldgs as Ledger[])),
    );

    unsubsRef.current.push(
      listenTransactions(db, orgId, (txs) => setTransactions(txs as Transaction[])),
    );

    unsubsRef.current.push(
      listenComments(db, orgId, (cmts) => setComments(cmts as Comment[])),
    );

    unsubsRef.current.push(
      listenEvidences(db, orgId, (evs) => setEvidences(evs as Evidence[])),
    );

    unsubsRef.current.push(
      listenAuditLogs(db, orgId, (logs) => setAuditLogs(logs as AuditLog[])),
    );

    return () => {
      unsubsRef.current.forEach((unsub) => unsub());
      unsubsRef.current = [];
    };
  }, [firestoreEnabled, db, orgId]);

  useEffect(() => {
    if (firestoreEnabled || !featureFlags.etlStagingLocalEnabled) return;

    let cancelled = false;
    fetch('/data/etl-staging-ui.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((payload: EtlStagingUiPayload) => {
        if (cancelled) return;
        if (Array.isArray(payload.projects) && payload.projects.length > 0) {
          setProjects(payload.projects);
        }
        if (Array.isArray(payload.members) && payload.members.length > 0) {
          setLocalMembers(payload.members);
        }
        if (Array.isArray(payload.ledgers) && payload.ledgers.length > 0) {
          setLedgers(payload.ledgers);
        }
        if (Array.isArray(payload.transactions) && payload.transactions.length > 0) {
          setTransactions(payload.transactions);
        }
        if (Array.isArray(payload.comments) && payload.comments.length > 0) {
          setComments(payload.comments);
        }
        if (Array.isArray(payload.evidences) && payload.evidences.length > 0) {
          setEvidences(payload.evidences);
        }
        if (Array.isArray(payload.auditLogs) && payload.auditLogs.length > 0) {
          setAuditLogs(payload.auditLogs);
        }
        if (Array.isArray(payload.participationEntries) && payload.participationEntries.length > 0) {
          setParticipationEntries(payload.participationEntries);
        }
      })
      .catch((err) => {
        console.error('[ETL staging] local json load failed:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [firestoreEnabled]);

  const addProject = useCallback((p: Project) => {
    if (writeStrategy.target === 'bff') {
      upsertProjectViaBff({
        tenantId: orgId,
        actor: bffActor,
        project: p,
      }).catch((err) => logBffWriteFailure('addProject', err));

      if (writeStrategy.mirrorRemoteWritesLocally) {
        setProjects((prev) => [...prev, p]);
      }
      return;
    }

    if (writeStrategy.target === 'firestore' && db) {
      upsertProject(db, orgId, p, auditActor).catch(console.error);
      return;
    }
    setProjects((prev) => [...prev, p]);
  }, [writeStrategy, orgId, bffActor, db, auditActor]);

  const upsertMember = useCallback((member: OrgMember & Record<string, unknown>) => {
    if (firestoreEnabled && db) {
      upsertMemberFS(db, orgId, member, auditActor).catch(console.error);
      return;
    }
    setLocalMembers((prev) => {
      const idx = prev.findIndex((m) => m.uid === member.uid);
      if (idx === -1) return [member, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...member };
      return next;
    });
  }, [firestoreEnabled, db, orgId, auditActor]);

  const removeMember = useCallback((uid: string) => {
    if (firestoreEnabled && db) {
      deleteMemberFS(db, orgId, uid, auditActor).catch(console.error);
      return;
    }
    setLocalMembers((prev) => prev.filter((m) => m.uid !== uid));
  }, [firestoreEnabled, db, orgId, auditActor]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    if (writeStrategy.target === 'bff') {
      const existing = projects.find((project) => project.id === id);
      if (existing) {
        const merged = { ...existing, ...updates } as Project;
        upsertProjectViaBff({
          tenantId: orgId,
          actor: bffActor,
          project: {
            ...merged,
            expectedVersion: existing.version ?? 1,
          },
        }).catch((err) => logBffWriteFailure('updateProject', err));
      }

      if (writeStrategy.mirrorRemoteWritesLocally) {
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
      }
      return;
    }

    if (writeStrategy.target === 'firestore' && db) {
      setProjects((prev) => {
        const existing = prev.find((p) => p.id === id);
        if (existing) {
          upsertProject(db, orgId, { ...existing, ...updates }, auditActor).catch(console.error);
        }
        return prev;
      });
      return;
    }
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, [writeStrategy, projects, orgId, bffActor, db, auditActor]);

  const addLedger = useCallback((l: Ledger) => {
    if (writeStrategy.target === 'bff') {
      upsertLedgerViaBff({
        tenantId: orgId,
        actor: bffActor,
        ledger: l as any,
      }).catch((err) => logBffWriteFailure('addLedger', err));

      if (writeStrategy.mirrorRemoteWritesLocally) {
        setLedgers((prev) => [...prev, l]);
      }
      return;
    }

    if (writeStrategy.target === 'firestore' && db) {
      upsertLedger(db, orgId, l, auditActor).catch(console.error);
      return;
    }
    setLedgers((prev) => [...prev, l]);
  }, [writeStrategy, orgId, bffActor, db, auditActor]);

  const addTransaction = useCallback((t: Transaction) => {
    if (writeStrategy.target === 'bff') {
      upsertTransactionViaBff({
        tenantId: orgId,
        actor: bffActor,
        transaction: t as any,
      }).catch((err) => logBffWriteFailure('addTransaction', err));

      if (writeStrategy.mirrorRemoteWritesLocally) {
        setTransactions((prev) => [...prev, t]);
      }
      return;
    }

    if (writeStrategy.target === 'firestore' && db) {
      upsertTransaction(db, orgId, t, auditActor).catch(console.error);
      return;
    }
    setTransactions((prev) => [...prev, t]);
  }, [writeStrategy, orgId, bffActor, db, auditActor]);

  const updateTransaction = useCallback((id: string, updates: Partial<Transaction>) => {
    if (writeStrategy.target === 'bff') {
      const existing = transactions.find((tx) => tx.id === id);
      if (existing) {
        upsertTransactionViaBff({
          tenantId: orgId,
          actor: bffActor,
          transaction: {
            ...existing,
            ...updates,
            expectedVersion: existing.version ?? 1,
          } as any,
        }).catch((err) => logBffWriteFailure('updateTransaction', err));
      }

      if (writeStrategy.mirrorRemoteWritesLocally) {
        setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
      }
      return;
    }

    if (writeStrategy.target === 'firestore' && db) {
      setTransactions((prev) => {
        const existing = prev.find((t) => t.id === id);
        if (existing) {
          upsertTransaction(db, orgId, { ...existing, ...updates }, auditActor).catch(console.error);
        }
        return prev;
      });
      return;
    }
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, [writeStrategy, transactions, orgId, bffActor, db, auditActor]);

  const changeTransactionState = useCallback((id: string, newState: TransactionState, reason?: string) => {
    if (writeStrategy.target === 'bff') {
      const currentTx = transactions.find((tx) => tx.id === id);
      changeTransactionStateViaBff({
        tenantId: orgId,
        actor: bffActor,
        transactionId: id,
        newState,
        expectedVersion: currentTx?.version ?? 1,
        reason,
      }).catch((err) => logBffWriteFailure('changeTransactionState', err));

      if (writeStrategy.mirrorRemoteWritesLocally) {
        setTransactions((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const updates: Partial<Transaction> = { state: newState };
          if (newState === 'SUBMITTED') {
            updates.submittedBy = currentUser.uid;
            updates.submittedAt = new Date().toISOString();
          } else if (newState === 'APPROVED') {
            updates.approvedBy = currentUser.uid;
            updates.approvedAt = new Date().toISOString();
          } else if (newState === 'REJECTED') {
            updates.rejectedReason = reason || '';
          }
          return { ...t, ...updates };
        }));
      }
      return;
    }

    if (writeStrategy.target === 'firestore' && db) {
      changeTransactionStateFS(db, orgId, id, newState, auditActor, reason).catch(console.error);
      return;
    }

    setTransactions((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const updates: Partial<Transaction> = { state: newState };
      if (newState === 'SUBMITTED') {
        updates.submittedBy = currentUser.uid;
        updates.submittedAt = new Date().toISOString();
      } else if (newState === 'APPROVED') {
        updates.approvedBy = currentUser.uid;
        updates.approvedAt = new Date().toISOString();
      } else if (newState === 'REJECTED') {
        updates.rejectedReason = reason || '';
      }
      return { ...t, ...updates };
    }));
  }, [writeStrategy, transactions, orgId, bffActor, db, currentUser.uid, auditActor]);

  const addComment = useCallback((c: Comment) => {
    if (writeStrategy.target === 'bff') {
      addCommentViaBff({
        tenantId: orgId,
        actor: bffActor,
        transactionId: c.transactionId,
        comment: {
          id: c.id,
          content: c.content,
          authorName: c.authorName,
        },
      }).catch((err) => logBffWriteFailure('addComment', err));

      if (writeStrategy.mirrorRemoteWritesLocally) {
        setComments((prev) => [...prev, c]);
      }
      return;
    }

    if (writeStrategy.target === 'firestore' && db) {
      addCommentFS(db, orgId, c, auditActor).catch(console.error);
      return;
    }
    setComments((prev) => [...prev, c]);
  }, [writeStrategy, orgId, bffActor, db, auditActor]);

  const addEvidence = useCallback((e: Evidence) => {
    if (writeStrategy.target === 'bff') {
      addEvidenceViaBff({
        tenantId: orgId,
        actor: bffActor,
        transactionId: e.transactionId,
        evidence: {
          id: e.id,
          fileName: e.fileName,
          fileType: e.fileType,
          fileSize: e.fileSize,
          category: e.category,
          status: e.status,
        },
      }).catch((err) => logBffWriteFailure('addEvidence', err));

      if (writeStrategy.mirrorRemoteWritesLocally) {
        setEvidences((prev) => [...prev, e]);
      }
      return;
    }

    if (writeStrategy.target === 'firestore' && db) {
      addEvidenceFS(db, orgId, e, auditActor).catch(console.error);
      return;
    }
    setEvidences((prev) => [...prev, e]);
  }, [writeStrategy, orgId, bffActor, db, auditActor]);

  const addParticipation = useCallback((pe: ParticipationEntry) => {
    if (firestoreEnabled && db) {
      addPartEntry(db, orgId, pe, auditActor).catch(console.error);
      return;
    }
    setParticipationEntries((prev) => [...prev, pe]);
  }, [firestoreEnabled, db, orgId, auditActor]);

  const updateParticipation = useCallback((id: string, updates: Partial<ParticipationEntry>) => {
    if (firestoreEnabled && db) {
      updatePartEntry(db, orgId, id, updates, auditActor).catch(console.error);
      return;
    }
    setParticipationEntries((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, [firestoreEnabled, db, orgId, auditActor]);

  const removeParticipation = useCallback((id: string) => {
    if (firestoreEnabled && db) {
      deletePartEntry(db, orgId, id, auditActor).catch(console.error);
      return;
    }
    setParticipationEntries((prev) => prev.filter((p) => p.id !== id));
  }, [firestoreEnabled, db, orgId, auditActor]);

  const getProjectLedgers = useCallback((projectId: string) => {
    return ledgers.filter((l) => l.projectId === projectId);
  }, [ledgers]);

  const getLedgerTransactions = useCallback((ledgerId: string) => {
    return transactions.filter((t) => t.ledgerId === ledgerId);
  }, [transactions]);

  const getTransactionComments = useCallback((txId: string) => {
    return comments.filter((c) => c.transactionId === txId);
  }, [comments]);

  const getTransactionEvidences = useCallback((txId: string) => {
    return evidences.filter((e) => e.transactionId === txId);
  }, [evidences]);

  const getProjectById = useCallback((id: string) => {
    return projects.find((p) => p.id === id);
  }, [projects]);

  const getLedgerById = useCallback((id: string) => {
    return ledgers.find((l) => l.id === id);
  }, [ledgers]);

  const value: AppState & AppActions = {
    org: { ...ORGANIZATION, id: orgId, members },
    currentUser,
    members,
    templates: LEDGER_TEMPLATES,
    projects,
    ledgers,
    transactions,
    comments,
    evidences,
    auditLogs,
    participationEntries,
    dataSource,
    upsertMember,
    removeMember,
    addProject,
    updateProject,
    addLedger,
    addTransaction,
    updateTransaction,
    changeTransactionState,
    addComment,
    addEvidence,
    addParticipation,
    updateParticipation,
    removeParticipation,
    getProjectLedgers,
    getLedgerTransactions,
    getTransactionComments,
    getTransactionEvidences,
    getProjectById,
    getLedgerById,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppStore() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppStore must be used within AppProvider');
  return ctx;
}
