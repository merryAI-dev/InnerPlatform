import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Project, ParticipationEntry } from './types';
import type { ExpenseSet, ExpenseItem, ExpenseSetStatus } from './budget-data';
import { EXPENSE_SETS } from './budget-data';
import {
  CHANGE_REQUESTS,
  type ChangeRequest,
  type ChangeRequestState,
} from './personnel-change-data';
import { PARTICIPATION_ENTRIES } from './participation-data';
import { PROJECTS } from './mock-data';
import { useAuth } from './auth-store';
import { useFirebase } from '../lib/firebase-context';
import { featureFlags } from '../config/feature-flags';
import { getOrgCollectionPath, getOrgDocumentPath } from '../lib/firebase';
import { duplicateExpenseSetAsDraft, withExpenseItems } from './portal-store.helpers';
import { toast } from 'sonner';

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  role: string;
  projectId: string;
  registeredAt: string;
}

interface PortalState {
  isRegistered: boolean;
  isLoading: boolean;
  portalUser: PortalUser | null;
  projects: Project[];
  myProject: Project | null;
  participationEntries: ParticipationEntry[];
  expenseSets: ExpenseSet[];
  changeRequests: ChangeRequest[];
}

interface PortalActions {
  register: (user: Omit<PortalUser, 'id' | 'registeredAt'>) => void;
  logout: () => void;
  addExpenseSet: (set: ExpenseSet) => void;
  updateExpenseSet: (id: string, updates: Partial<ExpenseSet>) => void;
  addExpenseItem: (setId: string, item: ExpenseItem) => void;
  updateExpenseItem: (setId: string, itemId: string, item: ExpenseItem) => void;
  deleteExpenseItem: (setId: string, itemId: string) => void;
  changeExpenseStatus: (setId: string, status: ExpenseSetStatus, reason?: string) => void;
  duplicateExpenseSet: (setId: string) => void;
  addChangeRequest: (req: ChangeRequest) => void;
  submitChangeRequest: (id: string) => void;
}

const _g = globalThis as any;
if (!_g.__PORTAL_CTX__) {
  _g.__PORTAL_CTX__ = createContext<(PortalState & PortalActions) | null>(null);
}
const PortalContext: React.Context<(PortalState & PortalActions) | null> = _g.__PORTAL_CTX__;

export function PortalProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user: authUser } = useAuth();
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db;

  const [portalUser, setPortalUser] = useState<PortalUser | null>(() => {
    try {
      const saved = localStorage.getItem('mysc-portal-user');
      return saved ? (JSON.parse(saved) as PortalUser) : null;
    } catch {
      return null;
    }
  });

  const [expenseSets, setExpenseSets] = useState<ExpenseSet[]>(EXPENSE_SETS);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>(CHANGE_REQUESTS);
  const [projects, setProjects] = useState<Project[]>(PROJECTS);
  const [participationEntries, setParticipationEntries] = useState<ParticipationEntry[]>(PARTICIPATION_ENTRIES);
  const [isLoading, setIsLoading] = useState(false);
  const unsubsRef = useRef<Unsubscribe[]>([]);

  const myProject = useMemo(() => {
    return portalUser ? projects.find((project) => project.id === portalUser.projectId) || null : null;
  }, [portalUser, projects]);

  useEffect(() => {
    if (!isAuthenticated || !authUser || portalUser) return;
    if (authUser.role !== 'pm' && authUser.role !== 'viewer') return;

    const projectId =
      authUser.projectId || projects.find((project) => project.managerId === authUser.uid)?.id || '';

    if (!projectId) return;

    const syncedUser: PortalUser = {
      id: authUser.uid,
      name: authUser.name,
      email: authUser.email,
      role: authUser.role,
      projectId,
      registeredAt: authUser.registeredAt || new Date().toISOString(),
    };

    setPortalUser(syncedUser);
    localStorage.setItem('mysc-portal-user', JSON.stringify(syncedUser));
  }, [isAuthenticated, authUser, portalUser, projects]);

  useEffect(() => {
    unsubsRef.current.forEach((unsub) => unsub());
    unsubsRef.current = [];

    if (!firestoreEnabled || !db) {
      setProjects(PROJECTS);
      setExpenseSets(EXPENSE_SETS);
      setChangeRequests(CHANGE_REQUESTS);
      setParticipationEntries(PARTICIPATION_ENTRIES);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let projectReady = false;
    let expenseReady = false;
    let changeReady = false;
    let partReady = false;
    const markReady = () => {
      if (projectReady && expenseReady && changeReady && partReady) setIsLoading(false);
    };

    if (!portalUser?.projectId) {
      setProjects(PROJECTS);
      setExpenseSets(EXPENSE_SETS);
      setChangeRequests(CHANGE_REQUESTS);
      setParticipationEntries([]);
      projectReady = true;
      expenseReady = true;
      changeReady = true;
      partReady = true;
      markReady();
    } else {
      const projectRef = doc(db, getOrgDocumentPath(orgId, 'projects', portalUser.projectId));
      const expenseQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'expenseSets')),
        where('projectId', '==', portalUser.projectId),
        orderBy('updatedAt', 'desc'),
      );

      const changeRequestQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'changeRequests')),
        where('projectId', '==', portalUser.projectId),
        orderBy('requestedAt', 'desc'),
      );

      const participationQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'partEntries')),
        where('projectId', '==', portalUser.projectId),
        orderBy('updatedAt', 'desc'),
      );

      unsubsRef.current.push(
        onSnapshot(projectRef, (snap) => {
          if (snap.exists()) {
            setProjects([snap.data() as Project]);
          } else {
            setProjects(PROJECTS.filter((project) => project.id === portalUser.projectId));
          }
          projectReady = true;
          markReady();
        }, (err) => {
          console.error('[PortalStore] project listen error:', err);
          setProjects(PROJECTS.filter((project) => project.id === portalUser.projectId));
          projectReady = true;
          markReady();
        }),
      );

      unsubsRef.current.push(
        onSnapshot(expenseQuery, (snap) => {
          const list = snap.docs.map((docItem) => docItem.data() as ExpenseSet);
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
          const list = snap.docs.map((docItem) => docItem.data() as ChangeRequest);
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
          const list = snap.docs.map((docItem) => docItem.data() as ParticipationEntry);
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
    }

    return () => {
      unsubsRef.current.forEach((unsub) => unsub());
      unsubsRef.current = [];
    };
  }, [firestoreEnabled, db, orgId, portalUser?.projectId]);

  const persistExpenseSet = useCallback(async (set: ExpenseSet) => {
    if (!db) return;
    await setDoc(doc(db, getOrgDocumentPath(orgId, 'expenseSets', set.id)), set, { merge: true });
  }, [db, orgId]);

  const persistChangeRequest = useCallback(async (request: ChangeRequest) => {
    if (!db) return;
    await setDoc(doc(db, getOrgDocumentPath(orgId, 'changeRequests', request.id)), request, { merge: true });
  }, [db, orgId]);

  const register = useCallback((user: Omit<PortalUser, 'id' | 'registeredAt'>) => {
    const newUser: PortalUser = {
      ...user,
      id: authUser?.uid || `pu-${Date.now()}`,
      registeredAt: new Date().toISOString(),
    };
    setPortalUser(newUser);
    localStorage.setItem('mysc-portal-user', JSON.stringify(newUser));
  }, [authUser?.uid]);

  const logout = useCallback(() => {
    setPortalUser(null);
    localStorage.removeItem('mysc-portal-user');
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

  const submitChangeRequest = useCallback((id: string) => {
    const now = new Date().toISOString();

    setChangeRequests((prev) => prev.map((request) => (
      request.id === id ? { ...request, state: 'SUBMITTED' as ChangeRequestState } : request
    )));

    if (firestoreEnabled && db) {
      updateDoc(doc(db, getOrgDocumentPath(orgId, 'changeRequests', id)), {
        state: 'SUBMITTED' as ChangeRequestState,
        updatedAt: now,
      }).catch((err) => {
        console.error('[PortalStore] submitChangeRequest error:', err);
        toast.error('인력변경 제출에 실패했습니다');
      });
    }
  }, [firestoreEnabled, db, orgId]);

  const value: PortalState & PortalActions = {
    isRegistered: !!portalUser,
    isLoading,
    portalUser,
    projects,
    myProject,
    participationEntries,
    expenseSets,
    changeRequests,
    register,
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
  };

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortalStore() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error('usePortalStore must be inside PortalProvider');
  return ctx;
}
