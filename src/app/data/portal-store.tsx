import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Ledger, Project, ParticipationEntry, Transaction, TransactionState } from './types';
import type { ExpenseSet, ExpenseItem, ExpenseSetStatus } from './budget-data';
import { EXPENSE_SETS } from './budget-data';
import {
  CHANGE_REQUESTS,
  type ChangeRequest,
  type ChangeRequestState,
} from './personnel-change-data';
import { PARTICIPATION_ENTRIES } from './participation-data';
import { LEDGERS, PROJECTS, TRANSACTIONS } from './mock-data';
import type { ImportRow } from '../platform/settlement-csv';
import { mapBankStatementsToImportRows, type BankStatementRow } from '../platform/bank-statement';
import { useAuth } from './auth-store';
import { useFirebase } from '../lib/firebase-context';
import { getOrgCollectionPath, getOrgDocumentPath } from '../lib/firebase';
import { duplicateExpenseSetAsDraft, withExpenseItems } from './portal-store.helpers';
import { toast } from 'sonner';
import { includesProject, normalizeProjectIds, resolvePrimaryProjectId } from './project-assignment';

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  role: string;
  projectId: string;
  projectIds: string[];
  projectNames?: Record<string, string>;
  registeredAt: string;
}

interface PortalState {
  isRegistered: boolean;
  isLoading: boolean;
  portalUser: PortalUser | null;
  projects: Project[];
  ledgers: Ledger[];
  myProject: Project | null;
  participationEntries: ParticipationEntry[];
  expenseSets: ExpenseSet[];
  changeRequests: ChangeRequest[];
  transactions: Transaction[];
  evidenceRequiredMap: Record<string, string>;
  expenseSheetRows: ImportRow[] | null;
  bankStatementRows: BankStatementRow[] | null;
}

interface PortalActions {
  register: (
    user: Omit<PortalUser, 'id' | 'registeredAt' | 'projectId' | 'projectIds'> & {
      projectId?: string;
      projectIds?: string[];
    },
  ) => Promise<boolean>;
  setActiveProject: (projectId: string) => Promise<boolean>;
  logout: () => void;
  addExpenseSet: (set: ExpenseSet) => void;
  updateExpenseSet: (id: string, updates: Partial<ExpenseSet>) => void;
  addExpenseItem: (setId: string, item: ExpenseItem) => void;
  updateExpenseItem: (setId: string, itemId: string, item: ExpenseItem) => void;
  deleteExpenseItem: (setId: string, itemId: string) => void;
  changeExpenseStatus: (setId: string, status: ExpenseSetStatus, reason?: string) => void;
  duplicateExpenseSet: (setId: string) => void;
  addChangeRequest: (req: ChangeRequest) => void;
  submitChangeRequest: (id: string) => Promise<boolean>;
  addTransaction: (tx: Transaction) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  changeTransactionState: (id: string, newState: TransactionState, reason?: string) => void;
  saveEvidenceRequiredMap: (map: Record<string, string>) => Promise<void>;
  saveExpenseSheetRows: (rows: ImportRow[]) => Promise<void>;
  saveBankStatementRows: (rows: BankStatementRow[]) => Promise<void>;
}

const _g = globalThis as any;
if (!_g.__PORTAL_CTX__) {
  _g.__PORTAL_CTX__ = createContext<(PortalState & PortalActions) | null>(null);
}
const PortalContext: React.Context<(PortalState & PortalActions) | null> = _g.__PORTAL_CTX__;

function withTenantScope<T extends Record<string, unknown>>(orgId: string, payload: T): T & { tenantId: string } {
  return {
    ...payload,
    tenantId: orgId,
  };
}

function normalizePortalUser(candidate: Partial<PortalUser> | null | undefined): PortalUser | null {
  if (!candidate) return null;
  const projectIds = normalizeProjectIds([
    ...(Array.isArray(candidate.projectIds) ? candidate.projectIds : []),
    candidate.projectId,
  ]);
  const projectId = resolvePrimaryProjectId(projectIds, candidate.projectId);
  if (!projectId) return null;
  return {
    id: (candidate.id || '').trim(),
    name: candidate.name || '사용자',
    email: candidate.email || '',
    role: (candidate.role || 'pm').toLowerCase(),
    projectId,
    projectIds,
    projectNames: candidate.projectNames,
    registeredAt: candidate.registeredAt || new Date().toISOString(),
  };
}

export function PortalProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user: authUser } = useAuth();
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = isOnline && !!db;

  const [portalUser, setPortalUser] = useState<PortalUser | null>(null);

  const [expenseSets, setExpenseSets] = useState<ExpenseSet[]>(EXPENSE_SETS);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>(CHANGE_REQUESTS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [participationEntries, setParticipationEntries] = useState<ParticipationEntry[]>(PARTICIPATION_ENTRIES);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [evidenceRequiredMap, setEvidenceRequiredMap] = useState<Record<string, string>>({});
  const [expenseSheetRows, setExpenseSheetRows] = useState<ImportRow[] | null>(null);
  const [bankStatementRows, setBankStatementRows] = useState<BankStatementRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMemberLoading, setIsMemberLoading] = useState(true);
  const unsubsRef = useRef<Unsubscribe[]>([]);

  const myProject = useMemo(() => {
    return portalUser ? projects.find((project) => project.id === portalUser.projectId) || null : null;
  }, [portalUser, projects]);

  useEffect(() => {
    if (!isAuthenticated || !authUser) {
      setIsMemberLoading(false);
      return;
    }
    if (authUser.role !== 'pm' && authUser.role !== 'viewer') {
      setIsMemberLoading(false);
      return;
    }

    const loadFromStore = async () => {
      setIsMemberLoading(true);
      try {
        if (!firestoreEnabled || !db) {
          setPortalUser(null);
          return;
        }
        const memberRef = doc(db, getOrgDocumentPath(orgId, 'members', authUser.uid));
        const snap = await getDoc(memberRef);
        if (!snap.exists()) {
          setPortalUser(null);
          return;
        }
        const member = snap.data() as Partial<PortalUser> & {
          projectIds?: Array<string | { id?: string; name?: string }>;
          projectId?: string | { id?: string; name?: string };
        };
        const allowedProjectIds = new Set(PROJECTS.map((p) => p.id));
        const nameMap: Record<string, string> = {};
        const rawIds = Array.isArray(member.projectIds) ? member.projectIds : [];
        const coercedIds = rawIds
          .map((entry) => {
            if (typeof entry === 'string') return entry;
            const id = String(entry?.id || '').trim();
            const name = String(entry?.name || '').trim();
            if (id && name) nameMap[id] = name;
            return id;
          })
          .filter((id) => allowedProjectIds.has(id))
          .filter(Boolean);
        const preferredId = typeof member.projectId === 'string'
          ? member.projectId
          : String((member.projectId as any)?.id || '');
        const normalizedPreferred = allowedProjectIds.has(preferredId) ? preferredId : '';
        const normalized = normalizePortalUser({
          id: authUser.uid,
          name: member.name || authUser.name,
          email: member.email || authUser.email,
          role: authUser.role,
          projectId: normalizedPreferred,
          projectIds: coercedIds,
          projectNames: Object.keys(nameMap).length ? nameMap : undefined,
          registeredAt: member.registeredAt || authUser.registeredAt || new Date().toISOString(),
        });
        if (!normalized) {
          setPortalUser(null);
          return;
        }
        // Normalize member projectIds to string array for security rules (one-time fix)
        try {
          const rawProjectIds = Array.isArray(member.projectIds) ? member.projectIds : [];
          const hasObjectIds = rawProjectIds.some((entry) => typeof entry === 'object');
          if (hasObjectIds || member.projectId !== normalized.projectId) {
            await updateDoc(doc(db, getOrgDocumentPath(orgId, 'members', authUser.uid)), {
              projectId: normalized.projectId,
              projectIds: normalized.projectIds,
              tenantId: orgId,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.error('[PortalStore] member projectIds normalize failed:', err);
        }
        setPortalUser(normalized);
      } catch (err) {
        console.error('[PortalStore] member load failed:', err);
      } finally {
        setIsMemberLoading(false);
      }
    };

    loadFromStore();
  }, [isAuthenticated, authUser?.uid, authUser?.role, firestoreEnabled, db, orgId]);

  useEffect(() => {
    unsubsRef.current.forEach((unsub) => unsub());
    unsubsRef.current = [];

    if (!firestoreEnabled || !db) {
      setProjects([]);
      setLedgers([]);
      setExpenseSets([]);
      setChangeRequests([]);
      setParticipationEntries([]);
      setTransactions([]);
      setEvidenceRequiredMap({});
      setExpenseSheetRows(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let projectReady = false;
    let ledgerReady = false;
    let expenseReady = false;
    let changeReady = false;
    let partReady = false;
    let txReady = false;
    const markReady = () => {
      if (projectReady && ledgerReady && expenseReady && changeReady && partReady && txReady) setIsLoading(false);
    };

    if (!portalUser?.projectId) {
      setProjects(PROJECTS);
      setLedgers([]);
      setExpenseSets(EXPENSE_SETS);
      setChangeRequests(CHANGE_REQUESTS);
      setParticipationEntries([]);
      setTransactions([]);
      projectReady = true;
      ledgerReady = true;
      expenseReady = true;
      changeReady = true;
      partReady = true;
      txReady = true;
      markReady();
    } else {
      setProjects(PROJECTS);
      projectReady = true;
      markReady();

      const ledgerQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'ledgers')),
        where('projectId', '==', portalUser.projectId),
      );
      const expenseQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'expenseSets')),
        where('projectId', '==', portalUser.projectId),
      );

      const changeRequestQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'changeRequests')),
        where('projectId', '==', portalUser.projectId),
      );

      const participationQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'partEntries')),
        where('projectId', '==', portalUser.projectId),
      );

      unsubsRef.current.push(
        onSnapshot(ledgerQuery, (snap) => {
          const list = snap.docs
            .map((docItem) => docItem.data() as Ledger)
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
          setLedgers(list);
          ledgerReady = true;
          markReady();
        }, (err) => {
          console.error('[PortalStore] ledgers listen error:', err);
          if ((err as any)?.code !== 'permission-denied') {
            toast.error('원장 데이터를 불러오지 못했습니다');
          }
          setLedgers(LEDGERS.filter((l) => l.projectId === portalUser.projectId));
          ledgerReady = true;
          markReady();
        }),
      );

      unsubsRef.current.push(
        onSnapshot(expenseQuery, (snap) => {
          const list = snap.docs
            .map((docItem) => docItem.data() as ExpenseSet)
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
          setExpenseSets(list);
          expenseReady = true;
          markReady();
        }, (err) => {
          console.error('[PortalStore] expenseSets listen error:', err);
          toast.error('사업비 데이터를 불러오지 못했습니다');
          expenseReady = true;
          markReady();
        }),
      );

      unsubsRef.current.push(
        onSnapshot(changeRequestQuery, (snap) => {
          const list = snap.docs
            .map((docItem) => docItem.data() as ChangeRequest)
            .sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
          setChangeRequests(list);
          changeReady = true;
          markReady();
        }, (err) => {
          console.error('[PortalStore] changeRequests listen error:', err);
          toast.error('인력변경 데이터를 불러오지 못했습니다');
          changeReady = true;
          markReady();
        }),
      );

      unsubsRef.current.push(
        onSnapshot(participationQuery, (snap) => {
          const list = snap.docs
            .map((docItem) => docItem.data() as ParticipationEntry)
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
          setParticipationEntries(list);
          partReady = true;
          markReady();
        }, (err) => {
          console.error('[PortalStore] participation entries listen error:', err);
          if ((err as any)?.code !== 'permission-denied') {
            toast.error('인력 데이터를 불러오지 못했습니다. 기본 데이터를 표시합니다.');
          }
          setParticipationEntries(PARTICIPATION_ENTRIES.filter((entry) => entry.projectId === portalUser.projectId));
          partReady = true;
          markReady();
        }),
      );

      const txQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'transactions')),
        where('projectId', '==', portalUser.projectId),
      );

      const evidenceMapRef = doc(db, getOrgDocumentPath(orgId, 'budgetEvidenceMaps', portalUser.projectId));
      const expenseSheetRef = doc(
        db,
        `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/expense_sheets/default`,
      );
      const bankStatementRef = doc(
        db,
        `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/bank_statements/default`,
      );

      unsubsRef.current.push(
        onSnapshot(txQuery, (snap) => {
          const list = snap.docs
            .map((docItem) => docItem.data() as Transaction)
            .sort((a, b) => String(b.dateTime || '').localeCompare(String(a.dateTime || '')));
          setTransactions(list);
          txReady = true;
          markReady();
        }, (err) => {
          console.error('[PortalStore] transactions listen error:', err);
          if ((err as any)?.code !== 'permission-denied') {
            toast.error('거래 데이터를 불러오지 못했습니다');
          }
          setTransactions(TRANSACTIONS.filter((t) => t.projectId === portalUser.projectId));
          txReady = true;
          markReady();
        }),
      );

      unsubsRef.current.push(
        onSnapshot(evidenceMapRef, (snap) => {
          if (!snap.exists()) {
            setEvidenceRequiredMap({});
            return;
          }
          const data = snap.data() as { map?: Record<string, string> };
          setEvidenceRequiredMap(data?.map || {});
        }, (err) => {
          console.error('[PortalStore] evidence map listen error:', err);
          setEvidenceRequiredMap({});
        }),
      );

      unsubsRef.current.push(
        onSnapshot(expenseSheetRef, (snap) => {
          if (!snap.exists()) {
            setExpenseSheetRows(null);
            return;
          }
          const data = snap.data() as { rows?: ImportRow[] };
          setExpenseSheetRows(Array.isArray(data?.rows) ? data.rows : null);
        }, (err) => {
          console.error('[PortalStore] expense sheet listen error:', err);
          setExpenseSheetRows(null);
        }),
      );

      unsubsRef.current.push(
        onSnapshot(bankStatementRef, (snap) => {
          if (!snap.exists()) {
            setBankStatementRows(null);
            return;
          }
          const data = snap.data() as { rows?: BankStatementRow[] };
          setBankStatementRows(Array.isArray(data?.rows) ? data.rows : null);
        }, (err) => {
          console.error('[PortalStore] bank statement listen error:', err);
          setBankStatementRows(null);
        }),
      );
    }

    return () => {
      unsubsRef.current.forEach((unsub) => unsub());
      unsubsRef.current = [];
    };
  }, [firestoreEnabled, db, orgId, portalUser?.projectId]);

  const persistExpenseSet = useCallback(async (set: ExpenseSet) => {
    if (!db) return;
    await setDoc(
      doc(db, getOrgDocumentPath(orgId, 'expenseSets', set.id)),
      withTenantScope(orgId, set),
      { merge: true },
    );
  }, [db, orgId]);

  const persistChangeRequest = useCallback(async (request: ChangeRequest) => {
    if (!db) return;
    await setDoc(
      doc(db, getOrgDocumentPath(orgId, 'changeRequests', request.id)),
      withTenantScope(orgId, request),
      { merge: true },
    );
  }, [db, orgId]);

  const saveEvidenceRequiredMap = useCallback(async (map: Record<string, string>) => {
    if (!db || !portalUser?.projectId) {
      toast.error('Firestore 연결이 필요합니다. 관리자에게 문의해 주세요.');
      return;
    }
    const now = new Date().toISOString();
    const payload = withTenantScope(orgId, {
      projectId: portalUser.projectId,
      map,
      updatedAt: now,
      updatedBy: portalUser.name || authUser?.name || '',
    });
    await setDoc(
      doc(db, getOrgDocumentPath(orgId, 'budgetEvidenceMaps', portalUser.projectId)),
      payload,
      { merge: true },
    );
    setEvidenceRequiredMap(map);
  }, [db, orgId, portalUser?.projectId, portalUser?.name, authUser?.name, expenseSheetRows]);

  const saveExpenseSheetRows = useCallback(async (rows: ImportRow[]) => {
    if (!db || !portalUser?.projectId) {
      toast.error('Firestore 연결이 필요합니다. 관리자에게 문의해 주세요.');
      return;
    }
    const now = new Date().toISOString();
    const sanitizedRows = rows.map((row) => ({
      tempId: row.tempId || `imp-${Date.now()}`,
      ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
      cells: Array.isArray(row.cells) ? row.cells.map((c) => (c ?? '')) : [],
    }));
    const payload = withTenantScope(orgId, {
      projectId: portalUser.projectId,
      rows: sanitizedRows,
      updatedAt: now,
      updatedBy: portalUser.name || authUser?.name || '',
    });
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/expense_sheets/default`),
      payload,
      { merge: true },
    );
    setExpenseSheetRows(sanitizedRows as ImportRow[]);
  }, [db, orgId, portalUser?.projectId, portalUser?.name, authUser?.name]);

  const saveBankStatementRows = useCallback(async (rows: BankStatementRow[]) => {
    if (!db || !portalUser?.projectId) {
      toast.error('Firestore 연결이 필요합니다. 관리자에게 문의해 주세요.');
      return;
    }
    const now = new Date().toISOString();
    const sanitizedRows = rows.map((row) => ({
      tempId: row.tempId || `bank-${Date.now()}`,
      cells: Array.isArray(row.cells) ? row.cells.map((c) => (c ?? '')) : [],
    }));
    const payload = withTenantScope(orgId, {
      projectId: portalUser.projectId,
      rows: sanitizedRows,
      updatedAt: now,
      updatedBy: portalUser.name || authUser?.name || '',
    });
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/bank_statements/default`),
      payload,
      { merge: true },
    );
    setBankStatementRows(sanitizedRows as BankStatementRow[]);

    // Sync into expense sheet rows (통장내역 → 사용내역)
    const nextExpenseRows = mapBankStatementsToImportRows(sanitizedRows as BankStatementRow[]);
    const expensePayload = withTenantScope(orgId, {
      projectId: portalUser.projectId,
      rows: nextExpenseRows,
      updatedAt: now,
      updatedBy: portalUser.name || authUser?.name || '',
    });
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/expense_sheets/default`),
      expensePayload,
      { merge: true },
    );
    setExpenseSheetRows(nextExpenseRows);
  }, [db, orgId, portalUser?.projectId, portalUser?.name, authUser?.name]);

  const persistTransaction = useCallback(async (txData: Transaction) => {
    if (!db) return;
    await setDoc(
      doc(db, getOrgDocumentPath(orgId, 'transactions', txData.id)),
      withTenantScope(orgId, txData),
      { merge: true },
    );
  }, [db, orgId]);

  const register = useCallback(async (
    user: Omit<PortalUser, 'id' | 'registeredAt' | 'projectId' | 'projectIds'> & {
      projectId?: string;
      projectIds?: string[];
    },
  ): Promise<boolean> => {
    if (!firestoreEnabled || !db) {
      toast.error('Firestore 연결이 필요합니다. 관리자에게 문의해 주세요.');
      return false;
    }
    const previousPortalUser = portalUser;
    const now = new Date().toISOString();
    const normalizedProjectIds = normalizeProjectIds([
      ...(Array.isArray(user.projectIds) ? user.projectIds : []),
      user.projectId,
    ]);
    const primaryProjectId = resolvePrimaryProjectId(normalizedProjectIds, user.projectId);
    if (!primaryProjectId) {
      toast.error('최소 1개 이상의 사업을 선택해 주세요.');
      return false;
    }

    const candidate = normalizePortalUser({
      ...user,
      id: authUser?.uid || `pu-${Date.now()}`,
      role: (authUser?.role || user.role || 'pm').toLowerCase(),
      projectId: primaryProjectId,
      projectIds: normalizedProjectIds,
      registeredAt: now,
    });

    if (!candidate) {
      toast.error('사업 정보를 저장하지 못했습니다.');
      return false;
    }

    setPortalUser(candidate);

    if (authUser) {
      let memberRole = (authUser.role || user.role || 'pm').toLowerCase();
      try {
        const memberSnap = await getDoc(doc(db, getOrgDocumentPath(orgId, 'members', authUser.uid)));
        if (memberSnap.exists()) {
          const existingRole = (memberSnap.data() as { role?: string }).role;
          if (typeof existingRole === 'string' && existingRole.trim()) {
            memberRole = existingRole.trim().toLowerCase();
          }
        }
      } catch (err) {
        // If role lookup fails, fall back to current auth role
      }
      try {
        await setDoc(doc(db, getOrgDocumentPath(orgId, 'members', authUser.uid)), {
          uid: authUser.uid,
          name: candidate.name,
          email: candidate.email,
          role: memberRole,
          tenantId: orgId,
          status: 'ACTIVE',
          projectId: candidate.projectId,
          projectIds: candidate.projectIds,
          updatedAt: now,
          createdAt: authUser.registeredAt || now,
          lastLoginAt: now,
        }, { merge: true });
        if (candidate.role !== memberRole) {
          setPortalUser({ ...candidate, role: memberRole });
        }
      } catch (err) {
        console.error('[PortalStore] register member sync error:', err);
        setPortalUser(previousPortalUser);
        toast.error('회원 정보를 저장하지 못했습니다.');
        return false;
      }
    }

    return true;
  }, [authUser, firestoreEnabled, db, orgId, portalUser]);

  const setActiveProject = useCallback(async (projectId: string): Promise<boolean> => {
    if (!firestoreEnabled || !db) {
      toast.error('Firestore 연결이 필요합니다. 관리자에게 문의해 주세요.');
      return false;
    }
    const target = projectId.trim();
    if (!target) return false;
    if (!portalUser) return false;
    const allowedIds = normalizeProjectIds([
      ...(Array.isArray(portalUser.projectIds) ? portalUser.projectIds : []),
      portalUser.projectId,
    ]);
    if (!includesProject(allowedIds, target)) {
      toast.error('배정되지 않은 사업입니다.');
      return false;
    }

    const previousUser = portalUser;
    const nextUser: PortalUser = {
      ...portalUser,
      projectId: target,
    };
    setPortalUser(nextUser);

    if (authUser) {
      try {
        await updateDoc(doc(db, getOrgDocumentPath(orgId, 'members', authUser.uid)), {
          projectId: target,
          projectIds: nextUser.projectIds,
          tenantId: orgId,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[PortalStore] setActiveProject member sync error:', err);
        setPortalUser(previousUser);
        toast.error('주사업 변경을 저장하지 못했습니다.');
        return false;
      }
    }

    return true;
  }, [portalUser, firestoreEnabled, db, authUser, orgId]);

  const logout = useCallback(() => {
    setPortalUser(null);
  }, []);

  const addExpenseSet = useCallback((set: ExpenseSet) => {
    setExpenseSets((prev) => [set, ...prev]);

    if (firestoreEnabled) {
      persistExpenseSet(set).catch((err) => {
        console.error('[PortalStore] persistExpenseSet error:', err);
        toast.error('사업비 세트 저장에 실패했습니다');
      });
    }
  }, [firestoreEnabled, persistExpenseSet]);

  const updateExpenseSet = useCallback((id: string, updates: Partial<ExpenseSet>) => {
    setExpenseSets((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      return { ...item, ...updates };
    }));

    if (firestoreEnabled && db) {
      updateDoc(doc(db, getOrgDocumentPath(orgId, 'expenseSets', id)), {
        ...updates,
        tenantId: orgId,
        updatedAt: new Date().toISOString(),
      }).catch((err) => {
        console.error('[PortalStore] updateExpenseSet error:', err);
        toast.error('사업비 세트 저장에 실패했습니다');
      });
    }
  }, [firestoreEnabled, db, orgId]);

  const addExpenseItem = useCallback((setId: string, item: ExpenseItem) => {
    const now = new Date().toISOString();
    let nextSet: ExpenseSet | null = null;

    setExpenseSets((prev) => prev.map((set) => {
      if (set.id !== setId) return set;
      nextSet = withExpenseItems(set, [...set.items, item], now);
      return nextSet;
    }));

    if (firestoreEnabled && nextSet) {
      persistExpenseSet(nextSet).catch((err) => {
        console.error('[PortalStore] addExpenseItem persist error:', err);
        toast.error('지출 항목 저장에 실패했습니다');
      });
    }
  }, [firestoreEnabled, persistExpenseSet]);

  const updateExpenseItem = useCallback((setId: string, itemId: string, item: ExpenseItem) => {
    const now = new Date().toISOString();
    let nextSet: ExpenseSet | null = null;

    setExpenseSets((prev) => prev.map((set) => {
      if (set.id !== setId) return set;
      nextSet = withExpenseItems(
        set,
        set.items.map((existing) => (existing.id === itemId ? item : existing)),
        now,
      );
      return nextSet;
    }));

    if (firestoreEnabled && nextSet) {
      persistExpenseSet(nextSet).catch((err) => {
        console.error('[PortalStore] updateExpenseItem persist error:', err);
        toast.error('지출 항목 저장에 실패했습니다');
      });
    }
  }, [firestoreEnabled, persistExpenseSet]);

  const deleteExpenseItem = useCallback((setId: string, itemId: string) => {
    const now = new Date().toISOString();
    let nextSet: ExpenseSet | null = null;

    setExpenseSets((prev) => prev.map((set) => {
      if (set.id !== setId) return set;
      nextSet = withExpenseItems(
        set,
        set.items.filter((item) => item.id !== itemId),
        now,
      );
      return nextSet;
    }));

    if (firestoreEnabled && nextSet) {
      persistExpenseSet(nextSet).catch((err) => {
        console.error('[PortalStore] deleteExpenseItem persist error:', err);
        toast.error('지출 항목 삭제에 실패했습니다');
      });
    }
  }, [firestoreEnabled, persistExpenseSet]);

  const changeExpenseStatus = useCallback((setId: string, status: ExpenseSetStatus, reason?: string) => {
    const now = new Date().toISOString();
    let nextSet: ExpenseSet | null = null;

    setExpenseSets((prev) => prev.map((set) => {
      if (set.id !== setId) return set;
      const updates: Partial<ExpenseSet> = { status, updatedAt: now };
      if (status === 'SUBMITTED') updates.submittedAt = now;
      if (status === 'REJECTED') updates.rejectedReason = reason;
      nextSet = { ...set, ...updates };
      return nextSet;
    }));

    if (firestoreEnabled && nextSet) {
      persistExpenseSet(nextSet).catch((err) => {
        console.error('[PortalStore] changeExpenseStatus persist error:', err);
        toast.error('사업비 상태 변경에 실패했습니다');
      });
    }
  }, [firestoreEnabled, persistExpenseSet]);

  const duplicateExpenseSet = useCallback((setId: string) => {
    let duplicated: ExpenseSet | null = null;

    setExpenseSets((prev) => {
      const src = prev.find((set) => set.id === setId);
      if (!src) return prev;

      duplicated = duplicateExpenseSetAsDraft(
        src,
        new Date().toISOString(),
        () => `es-dup-${Date.now()}`,
        () => `ei-dup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );

      return duplicated ? [duplicated, ...prev] : prev;
    });

    if (firestoreEnabled && duplicated) {
      persistExpenseSet(duplicated).catch((err) => {
        console.error('[PortalStore] duplicateExpenseSet persist error:', err);
        toast.error('사업비 세트 복제에 실패했습니다');
      });
    }
  }, [firestoreEnabled, persistExpenseSet]);

  const addChangeRequest = useCallback((req: ChangeRequest) => {
    setChangeRequests((prev) => [req, ...prev]);

    if (firestoreEnabled) {
      persistChangeRequest(req).catch((err) => {
        console.error('[PortalStore] persistChangeRequest error:', err);
        toast.error('인력변경 요청 저장에 실패했습니다');
      });
    }
  }, [firestoreEnabled, persistChangeRequest]);

  const submitChangeRequest = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    let previousRequest: ChangeRequest | null = null;
    let nextRequest: ChangeRequest | null = null;

    setChangeRequests((prev) => prev.map((request) => (
      request.id === id
        ? (() => {
          previousRequest = request;
          nextRequest = {
            ...request,
            state: 'SUBMITTED' as ChangeRequestState,
            timeline: [
              ...request.timeline,
              {
                id: `tl-${Date.now()}`,
                action: '요청서 제출',
                actor: portalUser?.name || request.requestedBy || '사용자',
                timestamp: now,
                type: 'SUBMIT',
              },
            ],
          };
          return nextRequest;
        })()
        : request
    )));

    if (!firestoreEnabled || !db) return true;

    try {
      if (!nextRequest) return true;
      await persistChangeRequest(nextRequest);
      return true;
    } catch (err) {
      console.error('[PortalStore] submitChangeRequest error:', err);
      toast.error('인력변경 제출에 실패했습니다');
      if (previousRequest) {
        setChangeRequests((prev) => prev.map((request) => (
          request.id === id ? previousRequest as ChangeRequest : request
        )));
      }
      return false;
    }
  }, [firestoreEnabled, db, portalUser?.name, persistChangeRequest]);

  const addTransaction = useCallback((txData: Transaction) => {
    setTransactions((prev) => [txData, ...prev]);

    if (firestoreEnabled) {
      persistTransaction(txData).catch((err) => {
        console.error('[PortalStore] persistTransaction error:', err);
        toast.error('거래 저장에 실패했습니다');
      });
    }
  }, [firestoreEnabled, persistTransaction]);

  const updateTransaction = useCallback((id: string, updates: Partial<Transaction>) => {
    const now = new Date().toISOString();
    let nextTx: Transaction | null = null;

    setTransactions((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      nextTx = { ...t, ...updates, updatedAt: now };
      return nextTx;
    }));

    if (firestoreEnabled && nextTx) {
      persistTransaction(nextTx).catch((err) => {
        console.error('[PortalStore] updateTransaction error:', err);
        toast.error('거래 수정에 실패했습니다');
      });
    }
  }, [firestoreEnabled, persistTransaction]);

  const changeTransactionState = useCallback((id: string, newState: TransactionState, reason?: string) => {
    const now = new Date().toISOString();
    let nextTx: Transaction | null = null;

    setTransactions((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const stateUpdates: Partial<Transaction> = {
        state: newState,
        updatedAt: now,
        updatedBy: portalUser?.id || 'unknown',
      };
      if (newState === 'SUBMITTED') {
        stateUpdates.submittedBy = portalUser?.name || portalUser?.id;
        stateUpdates.submittedAt = now;
      } else if (newState === 'APPROVED') {
        stateUpdates.approvedBy = portalUser?.name || portalUser?.id;
        stateUpdates.approvedAt = now;
      } else if (newState === 'REJECTED' && reason) {
        stateUpdates.rejectedReason = reason;
      }
      nextTx = { ...t, ...stateUpdates };
      return nextTx;
    }));

    if (firestoreEnabled && nextTx) {
      persistTransaction(nextTx).catch((err) => {
        console.error('[PortalStore] changeTransactionState error:', err);
        toast.error('거래 상태 변경에 실패했습니다');
      });
    }
  }, [firestoreEnabled, persistTransaction, portalUser?.id, portalUser?.name]);

  const value: PortalState & PortalActions = {
    isRegistered: !!(portalUser && portalUser.projectIds.length > 0),
    isLoading: isLoading || isMemberLoading,
    portalUser,
    projects,
    ledgers,
    myProject,
    participationEntries,
    expenseSets,
    changeRequests,
    transactions,
    evidenceRequiredMap,
    expenseSheetRows,
    bankStatementRows,
    register,
    setActiveProject,
    logout,
    addExpenseSet,
    updateExpenseSet,
    addExpenseItem,
    updateExpenseItem,
    deleteExpenseItem,
    changeExpenseStatus,
    duplicateExpenseSet,
    addChangeRequest,
    submitChangeRequest,
    addTransaction,
    updateTransaction,
    changeTransactionState,
    saveEvidenceRequiredMap,
    saveExpenseSheetRows,
    saveBankStatementRows,
  };

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortalStore() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error('usePortalStore must be inside PortalProvider');
  return ctx;
}
