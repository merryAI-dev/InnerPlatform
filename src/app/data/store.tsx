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
import { reportError } from '../platform/observability';
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
  addProject: (p: Project) => Promise<void>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  addLedger: (l: Ledger) => Promise<void>;
  addTransaction: (t: Transaction) => Promise<void>;
  updateTransaction: (id: string, updates: Partial<Transaction>) => Promise<void>;
  changeTransactionState: (id: string, newState: TransactionState, reason?: string) => Promise<void>;
  addComment: (c: Comment) => Promise<void>;
  addEvidence: (e: Evidence) => Promise<void>;
  addParticipation: (pe: ParticipationEntry) => Promise<void>;
  updateParticipation: (id: string, updates: Partial<ParticipationEntry>) => Promise<void>;
  removeParticipation: (id: string) => Promise<void>;
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

  const reportWriteFailure = useCallback((operation: string, error: unknown) => {
    reportError(error, {
      message: `[AppStore] ${operation} failed:`,
      options: {
        level: 'error',
        tags: {
          surface: 'app_store',
          action: operation,
          writeTarget: writeStrategy.target,
        },
        extra: {
          orgId,
          actorId: currentUser.uid,
          actorRole: currentUser.role,
          platformApiEnabled,
          firestoreEnabled,
          dataSource,
        },
      },
    });
  }, [
    currentUser.role,
    currentUser.uid,
    dataSource,
    firestoreEnabled,
    orgId,
    platformApiEnabled,
    writeStrategy.target,
  ]);

  const runStoreMutation = useCallback(async function runStoreMutation<T>(
    operation: string,
    perform: () => Promise<T>,
  ): Promise<T> {
    try {
      return await perform();
    } catch (error) {
      reportWriteFailure(operation, error);
      throw error;
    }
  }, [reportWriteFailure]);

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

  const addProject = useCallback(async (p: Project) => {
    await runStoreMutation('addProject', async () => {
      if (writeStrategy.target === 'bff') {
        await upsertProjectViaBff({
          tenantId: orgId,
          actor: bffActor,
          project: p,
        });

        if (writeStrategy.mirrorRemoteWritesLocally) {
          setProjects((prev) => [...prev, p]);
        }
        return;
      }

      if (writeStrategy.target === 'firestore' && db) {
        await upsertProject(db, orgId, p, auditActor);
        return;
      }

      setProjects((prev) => [...prev, p]);
    });
  }, [runStoreMutation, writeStrategy, orgId, bffActor, db, auditActor]);

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

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    await runStoreMutation('updateProject', async () => {
      if (writeStrategy.target === 'bff') {
        const existing = projects.find((project) => project.id === id);
        if (existing) {
          const merged = { ...existing, ...updates } as Project;
          await upsertProjectViaBff({
            tenantId: orgId,
            actor: bffActor,
            project: {
              ...merged,
              expectedVersion: existing.version ?? 1,
            },
          });
        }

        if (writeStrategy.mirrorRemoteWritesLocally) {
          setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
        }
        return;
      }

      if (writeStrategy.target === 'firestore' && db) {
        const existing = projects.find((project) => project.id === id);
        if (existing) {
          await upsertProject(db, orgId, { ...existing, ...updates }, auditActor);
        }
        return;
      }

      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    });
  }, [runStoreMutation, writeStrategy, projects, orgId, bffActor, db, auditActor]);

  const addLedger = useCallback(async (l: Ledger) => {
    await runStoreMutation('addLedger', async () => {
      if (writeStrategy.target === 'bff') {
        await upsertLedgerViaBff({
          tenantId: orgId,
          actor: bffActor,
          ledger: l as any,
        });

        if (writeStrategy.mirrorRemoteWritesLocally) {
          setLedgers((prev) => [...prev, l]);
        }
        return;
      }

      if (writeStrategy.target === 'firestore' && db) {
        await upsertLedger(db, orgId, l, auditActor);
        return;
      }

      setLedgers((prev) => [...prev, l]);
    });
  }, [runStoreMutation, writeStrategy, orgId, bffActor, db, auditActor]);

  const addTransaction = useCallback(async (t: Transaction) => {
    await runStoreMutation('addTransaction', async () => {
      if (writeStrategy.target === 'bff') {
        await upsertTransactionViaBff({
          tenantId: orgId,
          actor: bffActor,
          transaction: t as any,
        });

        if (writeStrategy.mirrorRemoteWritesLocally) {
          setTransactions((prev) => [...prev, t]);
        }
        return;
      }

      if (writeStrategy.target === 'firestore' && db) {
        await upsertTransaction(db, orgId, t, auditActor);
        return;
      }

      setTransactions((prev) => [...prev, t]);
    });
  }, [runStoreMutation, writeStrategy, orgId, bffActor, db, auditActor]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Transaction>) => {
    await runStoreMutation('updateTransaction', async () => {
      if (writeStrategy.target === 'bff') {
        const existing = transactions.find((tx) => tx.id === id);
        if (existing) {
          await upsertTransactionViaBff({
            tenantId: orgId,
            actor: bffActor,
            transaction: {
              ...existing,
              ...updates,
              expectedVersion: existing.version ?? 1,
            } as any,
          });
        }

        if (writeStrategy.mirrorRemoteWritesLocally) {
          setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
        }
        return;
      }

      if (writeStrategy.target === 'firestore' && db) {
        const existing = transactions.find((tx) => tx.id === id);
        if (existing) {
          await upsertTransaction(db, orgId, { ...existing, ...updates }, auditActor);
        }
        return;
      }

      setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    });
  }, [runStoreMutation, writeStrategy, transactions, orgId, bffActor, db, auditActor]);

  const changeTransactionState = useCallback(async (id: string, newState: TransactionState, reason?: string) => {
    await runStoreMutation('changeTransactionState', async () => {
      if (writeStrategy.target === 'bff') {
        const currentTx = transactions.find((tx) => tx.id === id);
        await changeTransactionStateViaBff({
          tenantId: orgId,
          actor: bffActor,
          transactionId: id,
          newState,
          expectedVersion: currentTx?.version ?? 1,
          reason,
        });

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
        await changeTransactionStateFS(db, orgId, id, newState, auditActor, reason);
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
    });
  }, [runStoreMutation, writeStrategy, transactions, orgId, bffActor, db, currentUser.uid, auditActor]);

  const addComment = useCallback(async (c: Comment) => {
    await runStoreMutation('addComment', async () => {
      if (writeStrategy.target === 'bff') {
        await addCommentViaBff({
          tenantId: orgId,
          actor: bffActor,
          transactionId: c.transactionId,
          comment: {
            id: c.id,
            content: c.content,
            authorName: c.authorName,
          },
        });

        if (writeStrategy.mirrorRemoteWritesLocally) {
          setComments((prev) => [...prev, c]);
        }
        return;
      }

      if (writeStrategy.target === 'firestore' && db) {
        await addCommentFS(db, orgId, c, auditActor);
        return;
      }

      setComments((prev) => [...prev, c]);
    });
  }, [runStoreMutation, writeStrategy, orgId, bffActor, db, auditActor]);

  const addEvidence = useCallback(async (e: Evidence) => {
    await runStoreMutation('addEvidence', async () => {
      if (writeStrategy.target === 'bff') {
        await addEvidenceViaBff({
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
        });

        if (writeStrategy.mirrorRemoteWritesLocally) {
          setEvidences((prev) => [...prev, e]);
        }
        return;
      }

      if (writeStrategy.target === 'firestore' && db) {
        await addEvidenceFS(db, orgId, e, auditActor);
        return;
      }

      setEvidences((prev) => [...prev, e]);
    });
  }, [runStoreMutation, writeStrategy, orgId, bffActor, db, auditActor]);

  const addParticipation = useCallback(async (pe: ParticipationEntry) => {
    await runStoreMutation('addParticipation', async () => {
      if (firestoreEnabled && db) {
        await addPartEntry(db, orgId, pe, auditActor);
        return;
      }
      setParticipationEntries((prev) => [...prev, pe]);
    });
  }, [runStoreMutation, firestoreEnabled, db, orgId, auditActor]);

  const updateParticipation = useCallback(async (id: string, updates: Partial<ParticipationEntry>) => {
    await runStoreMutation('updateParticipation', async () => {
      if (firestoreEnabled && db) {
        await updatePartEntry(db, orgId, id, updates, auditActor);
        return;
      }
      setParticipationEntries((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    });
  }, [runStoreMutation, firestoreEnabled, db, orgId, auditActor]);

  const removeParticipation = useCallback(async (id: string) => {
    await runStoreMutation('removeParticipation', async () => {
      if (firestoreEnabled && db) {
        await deletePartEntry(db, orgId, id, auditActor);
        return;
      }
      setParticipationEntries((prev) => prev.filter((p) => p.id !== id));
    });
  }, [runStoreMutation, firestoreEnabled, db, orgId, auditActor]);

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
