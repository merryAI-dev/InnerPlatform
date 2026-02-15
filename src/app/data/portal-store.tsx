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
import type { Project } from './types';
import type { ExpenseSet, ExpenseItem, ExpenseSetStatus } from './budget-data';
import { EXPENSE_SETS } from './budget-data';
import {
  CHANGE_REQUESTS,
  type ChangeRequest,
  type ChangeRequestState,
} from './personnel-change-data';
import { PROJECTS } from './mock-data';
import { useAuth } from './auth-store';
import { useFirebase } from '../lib/firebase-context';
import { featureFlags } from '../config/feature-flags';
import { getOrgCollectionPath, getOrgDocumentPath } from '../lib/firebase';
import { duplicateExpenseSetAsDraft, withExpenseItems } from './portal-store.helpers';

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
  portalUser: PortalUser | null;
  myProject: Project | null;
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
  const unsubsRef = useRef<Unsubscribe[]>([]);

  const myProject = useMemo(() => {
    return portalUser ? PROJECTS.find((project) => project.id === portalUser.projectId) || null : null;
  }, [portalUser]);

  useEffect(() => {
    if (!isAuthenticated || !authUser || portalUser) return;
    if (authUser.role !== 'pm' && authUser.role !== 'viewer') return;

    const projectId =
      authUser.projectId || PROJECTS.find((project) => project.managerId === authUser.uid)?.id || '';

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
  }, [isAuthenticated, authUser, portalUser]);

  useEffect(() => {
    unsubsRef.current.forEach((unsub) => unsub());
    unsubsRef.current = [];

    if (!firestoreEnabled || !db || !portalUser?.projectId) {
      setExpenseSets(EXPENSE_SETS);
      setChangeRequests(CHANGE_REQUESTS);
      return;
    }

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

    unsubsRef.current.push(
      onSnapshot(expenseQuery, (snap) => {
        const list = snap.docs.map((docItem) => docItem.data() as ExpenseSet);
        setExpenseSets(list);
      }, (err) => {
        console.error('[PortalStore] expenseSets listen error:', err);
      }),
    );

    unsubsRef.current.push(
      onSnapshot(changeRequestQuery, (snap) => {
        const list = snap.docs.map((docItem) => docItem.data() as ChangeRequest);
        setChangeRequests(list);
      }, (err) => {
        console.error('[PortalStore] changeRequests listen error:', err);
      }),
    );

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
      persistExpenseSet(set).catch(console.error);
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
      }).catch(console.error);
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
      persistExpenseSet(nextSet).catch(console.error);
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
      persistExpenseSet(nextSet).catch(console.error);
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
      persistExpenseSet(nextSet).catch(console.error);
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
      persistExpenseSet(nextSet).catch(console.error);
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
      persistExpenseSet(duplicated).catch(console.error);
    }
  }, [firestoreEnabled, persistExpenseSet]);

  const addChangeRequest = useCallback((req: ChangeRequest) => {
    setChangeRequests((prev) => [req, ...prev]);

    if (firestoreEnabled) {
      persistChangeRequest(req).catch(console.error);
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
      }).catch(console.error);
    }
  }, [firestoreEnabled, db, orgId]);

  const value: PortalState & PortalActions = {
    isRegistered: !!portalUser,
    portalUser,
    myProject,
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
