import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  collection,
  doc,
  documentId,
  getDoc,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  BudgetPlanRow,
  BudgetCodeEntry,
  BudgetCodeRename,
  Comment,
  Ledger,
  Project,
  ParticipationEntry,
  Transaction,
  TransactionState,
  WeeklySubmissionStatus,
  ProjectRequest,
  ProjectRequestPayload,
} from './types';
import type { ExpenseSet, ExpenseItem, ExpenseSetStatus } from './budget-data';
import { BUDGET_CODE_BOOK, EXPENSE_SETS } from './budget-data';
import {
  CHANGE_REQUESTS,
  type ChangeRequest,
  type ChangeRequestState,
} from './personnel-change-data';
import { PARTICIPATION_ENTRIES } from './participation-data';
import { LEDGERS, PROJECTS, TRANSACTIONS } from './mock-data';
import { SETTLEMENT_COLUMNS } from '../platform/settlement-csv';
import type { ImportRow } from '../platform/settlement-csv';
import {
  BANK_STATEMENT_COLUMNS,
  mergeBankRowsIntoExpenseSheet,
  mapBankStatementsToImportRows,
  type BankStatementRow,
  type BankStatementSheet,
} from '../platform/bank-statement';
import { normalizeSpace } from '../platform/csv-utils';
import { prepareSettlementImportRows, pruneEmptySettlementRows } from '../platform/settlement-sheet-prepare';
import { useAuth } from './auth-store';
import { useFirebase } from '../lib/firebase-context';
import { getOrgCollectionPath, getOrgDocumentPath } from '../lib/firebase';
import { duplicateExpenseSetAsDraft, withExpenseItems } from './portal-store.helpers';
import { buildPortalProfilePatch, readMemberWorkspace, resolveMemberProjectAccessState } from './member-workspace';
import { toast } from 'sonner';
import { includesProject, normalizeProjectIds, resolvePrimaryProjectId } from './project-assignment';
import { canEnterPortalWorkspace } from '../platform/navigation';
import { readDevAuthHarnessConfig } from '../platform/dev-harness';

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

export interface ExpenseSheetTab {
  id: string;
  name: string;
  rows: ImportRow[] | null;
  order: number;
  createdAt?: string;
  updatedAt?: string;
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
  comments: Comment[];
  evidenceRequiredMap: Record<string, string>;
  expenseSheets: ExpenseSheetTab[];
  activeExpenseSheetId: string;
  expenseSheetRows: ImportRow[] | null;
  bankStatementRows: BankStatementSheet | null;
  budgetPlanRows: BudgetPlanRow[] | null;
  budgetCodeBook: BudgetCodeEntry[];
  weeklySubmissionStatuses: WeeklySubmissionStatus[];
}

interface PortalActions {
  register: (
    user: Omit<PortalUser, 'id' | 'registeredAt' | 'projectId' | 'projectIds'> & {
      projectId?: string;
      projectIds?: string[];
      allowEmptyProject?: boolean;
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
  addComment: (comment: Comment) => Promise<void>;
  saveEvidenceRequiredMap: (map: Record<string, string>) => Promise<void>;
  setActiveExpenseSheet: (sheetId: string) => void;
  createExpenseSheet: (name?: string) => Promise<string | null>;
  renameExpenseSheet: (sheetId: string, name: string) => Promise<boolean>;
  deleteExpenseSheet: (sheetId: string) => Promise<boolean>;
  saveExpenseSheetRows: (rows: ImportRow[]) => Promise<void>;
  saveBankStatementRows: (sheet: BankStatementSheet) => Promise<void>;
  saveBudgetPlanRows: (rows: BudgetPlanRow[]) => Promise<void>;
  saveBudgetCodeBook: (rows: BudgetCodeEntry[], renames?: BudgetCodeRename[]) => Promise<void>;
  upsertWeeklySubmissionStatus: (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    projectionUpdated?: boolean;
    expenseUpdated?: boolean;
  }) => Promise<void>;
  createProjectRequest: (payload: ProjectRequestPayload) => Promise<string | null>;
}

const _g = globalThis as any;
if (!_g.__PORTAL_CTX__) {
  _g.__PORTAL_CTX__ = createContext<(PortalState & PortalActions) | null>(null);
}
const PortalContext: React.Context<(PortalState & PortalActions) | null> = _g.__PORTAL_CTX__;

function normalizeBudgetLabel(value: string): string {
  return String(value || '')
    .replace(/^\s*\d+(?:[.\-]\d+)?\s*/, '')
    .replace(/^[.\-]+\s*/, '')
    .trim();
}

function normalizeBudgetCodeBook(input: BudgetCodeEntry[]): BudgetCodeEntry[] {
  return (input || [])
    .map((row) => ({
      code: normalizeBudgetLabel(row.code),
      subCodes: (row.subCodes || []).map(normalizeBudgetLabel).filter(Boolean),
    }))
    .filter((row) => row.code && row.subCodes.length > 0);
}

function withTenantScope<T extends Record<string, unknown>>(orgId: string, payload: T): T & { tenantId: string } {
  return {
    ...payload,
    tenantId: orgId,
  };
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
        const cleaned = stripUndefinedDeep(entry);
        return cleaned === undefined ? [] : [[key, cleaned]];
      }),
    ) as T;
  }
  return value;
}

function createExpenseSheetId(): string {
  return `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeExpenseSheetName(value: string | undefined, fallback: string): string {
  const trimmed = normalizeSpace(String(value || ''));
  return trimmed || fallback;
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
  const { isAuthenticated, isLoading: authLoading, user: authUser } = useAuth();
  const { db, isOnline, orgId } = useFirebase();
  const devHarnessConfig = readDevAuthHarnessConfig(import.meta.env, typeof window !== 'undefined' ? window.location : undefined);
  const isDevHarnessUser = authUser?.source === 'dev_harness' && devHarnessConfig.enabled;
  const firestoreEnabled = isOnline && !!db;

  const [portalUser, setPortalUser] = useState<PortalUser | null>(null);

  const [expenseSets, setExpenseSets] = useState<ExpenseSet[]>(EXPENSE_SETS);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>(CHANGE_REQUESTS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [participationEntries, setParticipationEntries] = useState<ParticipationEntry[]>(PARTICIPATION_ENTRIES);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [evidenceRequiredMap, setEvidenceRequiredMap] = useState<Record<string, string>>({});
  const [expenseSheets, setExpenseSheets] = useState<ExpenseSheetTab[]>([]);
  const [activeExpenseSheetId, setActiveExpenseSheetIdState] = useState('default');
  const [expenseSheetRows, setExpenseSheetRows] = useState<ImportRow[] | null>(null);
  const [bankStatementRows, setBankStatementRows] = useState<BankStatementSheet | null>(null);
  const [budgetPlanRows, setBudgetPlanRows] = useState<BudgetPlanRow[] | null>(null);
  const [budgetCodeBook, setBudgetCodeBook] = useState<BudgetCodeEntry[]>(
    normalizeBudgetCodeBook(BUDGET_CODE_BOOK as unknown as BudgetCodeEntry[]),
  );
  const [weeklySubmissionStatuses, setWeeklySubmissionStatuses] = useState<WeeklySubmissionStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMemberLoading, setIsMemberLoading] = useState(true);
  const unsubsRef = useRef<Unsubscribe[]>([]);

  const myProject = useMemo(() => {
    return portalUser ? projects.find((project) => project.id === portalUser.projectId) || null : null;
  }, [portalUser, projects]);

  const scopedProjectIds = useMemo(
    () => normalizeProjectIds([...(Array.isArray(portalUser?.projectIds) ? portalUser?.projectIds : []), portalUser?.projectId]),
    [portalUser?.projectIds, portalUser?.projectId],
  );

  useEffect(() => {
    if (authLoading) {
      setIsMemberLoading(true);
      return;
    }
    if (!isAuthenticated || !authUser) {
      setPortalUser(null);
      setIsMemberLoading(false);
      return;
    }
    if (!canEnterPortalWorkspace(authUser.role)) {
      setPortalUser(null);
      setIsMemberLoading(false);
      return;
    }

    if (isDevHarnessUser) {
      const now = new Date().toISOString();
      const projectIds = normalizeProjectIds([
        ...(Array.isArray(authUser.projectIds) ? authUser.projectIds : []),
        authUser.projectId,
      ]);
      const normalized = normalizePortalUser({
        id: authUser.uid,
        name: authUser.name,
        email: authUser.email,
        role: authUser.role,
        projectId: resolvePrimaryProjectId(projectIds, authUser.projectId) || '',
        projectIds,
        registeredAt: authUser.registeredAt || now,
      });
      setPortalUser(normalized);
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
        const workspace = readMemberWorkspace(member);
        const access = resolveMemberProjectAccessState(member);
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
          .filter(Boolean);
        for (const [projectId, name] of Object.entries(workspace.portalProfile?.projectNames || {})) {
          if (projectId && name) nameMap[projectId] = name;
        }
        const preferredId = workspace.portalProfile?.projectId || (
          typeof member.projectId === 'string'
            ? member.projectId
            : String((member.projectId as any)?.id || '')
        );
        const normalizedPreferred = preferredId || '';
        const normalized = normalizePortalUser({
          id: authUser.uid,
          name: member.name || authUser.name,
          email: member.email || authUser.email,
          role: authUser.role,
          projectId: normalizedPreferred,
          projectIds: normalizeProjectIds([
            ...(workspace.portalProfile?.projectIds || []),
            ...coercedIds,
          ]),
          projectNames: Object.keys(nameMap).length ? nameMap : undefined,
          registeredAt: member.registeredAt || authUser.registeredAt || new Date().toISOString(),
        });
        if (!normalized) {
          setPortalUser(null);
          return;
        }
        // Normalize member projectIds to string array for security rules (one-time fix)
        try {
          if (access.needsRootSync) {
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
  }, [authLoading, isAuthenticated, authUser, firestoreEnabled, db, orgId, isDevHarnessUser]);

  useEffect(() => {
    unsubsRef.current.forEach((unsub) => unsub());
    unsubsRef.current = [];

    if (authLoading || isMemberLoading || !isAuthenticated || !authUser) {
      setProjects([]);
      setLedgers([]);
      setExpenseSets([]);
      setChangeRequests([]);
      setParticipationEntries([]);
      setTransactions([]);
      setComments([]);
      setEvidenceRequiredMap({});
      setExpenseSheets([]);
      setActiveExpenseSheetIdState('default');
      setExpenseSheetRows(null);
      setBankStatementRows(null);
      setBudgetPlanRows(null);
      setWeeklySubmissionStatuses([]);
      setIsLoading(authLoading || isMemberLoading);
      return;
    }

    if (isDevHarnessUser) {
      const scopedIds = normalizeProjectIds([
        ...(Array.isArray(portalUser?.projectIds) ? portalUser.projectIds : []),
        portalUser?.projectId,
      ]);
      setProjects(PROJECTS.filter((project) => scopedIds.includes(project.id)));
      setLedgers(LEDGERS.filter((ledger) => scopedIds.includes(ledger.projectId)));
      setExpenseSets(EXPENSE_SETS);
      setChangeRequests(CHANGE_REQUESTS);
      setParticipationEntries(PARTICIPATION_ENTRIES.filter((entry) => scopedIds.includes(entry.projectId)));
      setTransactions(TRANSACTIONS.filter((tx) => scopedIds.includes(tx.projectId)));
      setComments([]);
      setEvidenceRequiredMap((prev) => prev || {});
      setExpenseSheets((prev) => prev || []);
      setWeeklySubmissionStatuses([]);
      setIsLoading(false);
      return;
    }

    if (!firestoreEnabled || !db) {
      setProjects([]);
      setLedgers([]);
      setExpenseSets([]);
      setChangeRequests([]);
      setParticipationEntries([]);
      setTransactions([]);
      setExpenseSheets([]);
      setActiveExpenseSheetIdState('default');
      setEvidenceRequiredMap({});
      setExpenseSheetRows(null);
      setWeeklySubmissionStatuses([]);
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
      // 프로젝트 선택 화면: 전사 프로젝트를 모두 표시 (상태 무관)
      const projectQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'projects')),
        limit(500),
      );
      unsubsRef.current.push(
        onSnapshot(projectQuery, (snap) => {
          const map = new Map<string, Project>();
          snap.docs.forEach((docItem) => {
            const data = docItem.data() as Project;
            const id = data.id || docItem.id;
            map.set(id, { ...data, id });
          });
          const list = Array.from(map.values()).sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || '')),
          );
          setProjects(list);
          projectReady = true;
          markReady();
        }, (err) => {
          console.error('[PortalStore] projects listen error:', err);
          setProjects([]);
          projectReady = true;
          markReady();
        }),
      );
      setLedgers([]);
      setExpenseSets(EXPENSE_SETS);
      setChangeRequests(CHANGE_REQUESTS);
      setParticipationEntries([]);
      setTransactions([]);
      setWeeklySubmissionStatuses([]);
      ledgerReady = true;
      expenseReady = true;
      changeReady = true;
      partReady = true;
      txReady = true;
      markReady();
    } else {
      const projectCollection = collection(db, getOrgCollectionPath(orgId, 'projects'));
      const assignedProjectIds = scopedProjectIds.length > 0 ? scopedProjectIds : [portalUser.projectId];
      const assignedChunks: string[][] = [];
      for (let i = 0; i < assignedProjectIds.length; i += 10) {
        assignedChunks.push(assignedProjectIds.slice(i, i + 10));
      }

      const assignedMaps = assignedChunks.map(() => new Map<string, Project>());
      const activeMap = new Map<string, Project>();
      const assignedReadyFlags = assignedChunks.map(() => false);
      let pendingAssigned = assignedChunks.length;
      let activeReady = false;

      const refreshProjectList = () => {
        const merged = new Map<string, Project>();
        assignedMaps.forEach((chunkMap) => {
          chunkMap.forEach((project, id) => merged.set(id, project));
        });
        activeMap.forEach((project, id) => merged.set(id, project));
        const list = Array.from(merged.values()).sort((a, b) =>
          String(a.name || '').localeCompare(String(b.name || '')),
        );
        setProjects(list);
      };

      const markAssignedReady = (index: number) => {
        if (assignedReadyFlags[index]) return;
        assignedReadyFlags[index] = true;
        pendingAssigned = Math.max(0, pendingAssigned - 1);
      };

      const maybeMarkProjectReady = () => {
        if (activeReady && pendingAssigned === 0) {
          projectReady = true;
          markReady();
        }
      };

      const activeProjectQuery = query(
        projectCollection,
        where('status', '==', 'CONTRACT_PENDING'),
        limit(500),
      );

      unsubsRef.current.push(
        onSnapshot(activeProjectQuery, (snap) => {
          activeMap.clear();
          snap.docs.forEach((docItem) => {
            const data = docItem.data() as Project;
            const id = data.id || docItem.id;
            activeMap.set(id, { ...data, id });
          });
          refreshProjectList();
          activeReady = true;
          maybeMarkProjectReady();
        }, (err) => {
          console.error('[PortalStore] active projects listen error:', err);
          activeMap.clear();
          refreshProjectList();
          activeReady = true;
          maybeMarkProjectReady();
        }),
      );

      assignedChunks.forEach((chunk, index) => {
        const assignedQuery = chunk.length === 1
          ? query(projectCollection, where(documentId(), '==', chunk[0]))
          : query(projectCollection, where(documentId(), 'in', chunk));

        unsubsRef.current.push(
          onSnapshot(assignedQuery, (snap) => {
            const chunkMap = assignedMaps[index];
            chunkMap.clear();
            snap.docs.forEach((docItem) => {
              const data = docItem.data() as Project;
              const id = data.id || docItem.id;
              chunkMap.set(id, { ...data, id });
            });
            refreshProjectList();
            markAssignedReady(index);
            maybeMarkProjectReady();
          }, (err) => {
            console.error('[PortalStore] assigned projects listen error:', err);
            assignedMaps[index].clear();
            refreshProjectList();
            markAssignedReady(index);
            maybeMarkProjectReady();
          }),
        );
      });

      if (assignedChunks.length === 0) {
        maybeMarkProjectReady();
      }

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
      const commentQuery = query(
        collection(db, getOrgCollectionPath(orgId, 'comments')),
        where('projectId', '==', portalUser.projectId),
      );

      const evidenceMapRef = doc(db, getOrgDocumentPath(orgId, 'budgetEvidenceMaps', portalUser.projectId));
      const expenseSheetCollection = collection(
        db,
        `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/expense_sheets`,
      );
      const bankStatementRef = doc(
        db,
        `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/bank_statements/default`,
      );
      const budgetPlanRef = doc(
        db,
        `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/budget_summary/default`,
      );
      const budgetCodeBookRef = doc(
        db,
        `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/budget_code_book/default`,
      );
      const weeklySubmissionBase = collection(db, getOrgCollectionPath(orgId, 'weeklySubmissionStatus'));

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
        onSnapshot(commentQuery, (snap) => {
          const list = snap.docs
            .map((docItem) => docItem.data() as Comment)
            .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
          setComments(list);
        }, (err) => {
          console.error('[PortalStore] comments listen error:', err);
          setComments([]);
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
        onSnapshot(expenseSheetCollection, (snap) => {
          const docs = snap.docs
            .map((docItem) => {
              const data = docItem.data() as {
                name?: string;
                rows?: ImportRow[];
                order?: number;
                createdAt?: string;
                updatedAt?: string;
                deletedAt?: string;
              };
              if (data?.deletedAt) return null;
              return {
                id: docItem.id,
                name: sanitizeExpenseSheetName(data?.name, docItem.id === 'default' ? '기본 탭' : '새 탭'),
                rows: Array.isArray(data?.rows) ? data.rows : null,
                order: Number.isFinite(Number(data?.order)) ? Number(data?.order) : (docItem.id === 'default' ? 0 : 999),
                createdAt: data?.createdAt,
                updatedAt: data?.updatedAt,
              } satisfies ExpenseSheetTab;
            })
            .filter((sheet): sheet is ExpenseSheetTab => !!sheet)
            .sort((a, b) => {
              if (a.order !== b.order) return a.order - b.order;
              return String(a.createdAt || a.updatedAt || '').localeCompare(String(b.createdAt || b.updatedAt || ''));
            });

          setExpenseSheets(docs);
          const fallbackId = docs.find((sheet) => sheet.id === 'default')?.id || docs[0]?.id || 'default';
          const nextActiveId = docs.some((sheet) => sheet.id === activeExpenseSheetId)
            ? activeExpenseSheetId
            : fallbackId;
          if (nextActiveId !== activeExpenseSheetId) {
            setActiveExpenseSheetIdState(nextActiveId);
          }
          const activeSheet = docs.find((sheet) => sheet.id === nextActiveId) || null;
          setExpenseSheetRows(activeSheet?.rows || null);
        }, (err) => {
          console.error('[PortalStore] expense sheet listen error:', err);
          setExpenseSheets([]);
          setExpenseSheetRows(null);
        }),
      );

      unsubsRef.current.push(
        onSnapshot(bankStatementRef, (snap) => {
          if (!snap.exists()) {
            setBankStatementRows(null);
            return;
          }
          const data = snap.data() as { rows?: BankStatementRow[]; columns?: string[] };
          const rawRows = Array.isArray(data?.rows) ? data.rows : [];
          if (rawRows.length === 0) {
            setBankStatementRows(null);
            return;
          }
          const fallbackColumnCount = Math.max(...rawRows.map((r) => (Array.isArray(r?.cells) ? r.cells.length : 0)), 0);
          const fallbackColumns = fallbackColumnCount > 0
            ? Array.from({ length: fallbackColumnCount }, (_, i) => BANK_STATEMENT_COLUMNS[i] || `컬럼${i + 1}`)
            : [];
          const columns = Array.isArray(data?.columns) && data.columns.length > 0
            ? data.columns.map((c, i) => normalizeSpace(String(c || `컬럼${i + 1}`)))
            : fallbackColumns;
          const rows = rawRows.map((row, rowIdx) => ({
            tempId: row?.tempId || `bank-${Date.now()}-${rowIdx}`,
            cells: Array.isArray(row?.cells)
              ? columns.map((_, i) => normalizeSpace(String(row.cells[i] ?? '')))
              : columns.map(() => ''),
          }));
          setBankStatementRows({ columns, rows });
        }, (err) => {
          console.error('[PortalStore] bank statement listen error:', err);
          setBankStatementRows(null);
        }),
      );

      unsubsRef.current.push(
        onSnapshot(budgetPlanRef, (snap) => {
          if (!snap.exists()) {
            setBudgetPlanRows(null);
            return;
          }
          const data = snap.data() as { rows?: BudgetPlanRow[] };
          setBudgetPlanRows(Array.isArray(data?.rows) ? data.rows : null);
        }, (err) => {
          console.error('[PortalStore] budget plan listen error:', err);
          setBudgetPlanRows(null);
        }),
      );

      unsubsRef.current.push(
        onSnapshot(budgetCodeBookRef, (snap) => {
          if (!snap.exists()) {
            setBudgetCodeBook(BUDGET_CODE_BOOK);
            return;
          }
          const data = snap.data() as { codes?: BudgetCodeEntry[] };
          const source = Array.isArray(data?.codes)
            ? data.codes
            : (BUDGET_CODE_BOOK as unknown as BudgetCodeEntry[]);
          const normalized = normalizeBudgetCodeBook(source);
          setBudgetCodeBook(normalized.length > 0 ? normalized : normalizeBudgetCodeBook(BUDGET_CODE_BOOK as unknown as BudgetCodeEntry[]));
        }, (err) => {
          console.error('[PortalStore] budget code book listen error:', err);
          setBudgetCodeBook(normalizeBudgetCodeBook(BUDGET_CODE_BOOK as unknown as BudgetCodeEntry[]));
        }),
      );

      if (scopedProjectIds.length > 0) {
        const weekQuery = scopedProjectIds.length === 1
          ? query(weeklySubmissionBase, where('projectId', '==', scopedProjectIds[0]))
          : query(weeklySubmissionBase, where('projectId', 'in', scopedProjectIds.slice(0, 10)));

        unsubsRef.current.push(
          onSnapshot(weekQuery, (snap) => {
            const list = snap.docs.map((d) => {
              const data = d.data() as WeeklySubmissionStatus;
              return { ...data, id: data.id || d.id };
            });
            list.sort((a, b) => {
              if (a.projectId !== b.projectId) return String(a.projectId).localeCompare(String(b.projectId));
              if (a.yearMonth !== b.yearMonth) return String(b.yearMonth || '').localeCompare(String(a.yearMonth || ''));
              return (a.weekNo || 0) - (b.weekNo || 0);
            });
            setWeeklySubmissionStatuses(list);
          }, (err) => {
            console.error('[PortalStore] weekly submission listen error:', err);
            setWeeklySubmissionStatuses([]);
          }),
        );
      } else {
        setWeeklySubmissionStatuses([]);
      }
    }

    return () => {
      unsubsRef.current.forEach((unsub) => unsub());
      unsubsRef.current = [];
    };
  }, [authLoading, isMemberLoading, isAuthenticated, authUser, firestoreEnabled, db, orgId, portalUser?.projectId, scopedProjectIds, activeExpenseSheetId, isDevHarnessUser, portalUser?.projectIds]);

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

  const setActiveExpenseSheet = useCallback((sheetId: string) => {
    const nextId = String(sheetId || '').trim();
    if (!nextId) return;
    setActiveExpenseSheetIdState(nextId);
    const activeSheet = expenseSheets.find((sheet) => sheet.id === nextId) || null;
    setExpenseSheetRows(activeSheet?.rows || null);
  }, [expenseSheets]);

  const createExpenseSheet = useCallback(async (name?: string): Promise<string | null> => {
    if (isDevHarnessUser) {
      const now = new Date().toISOString();
      const id = createExpenseSheetId();
      const nextOrder = expenseSheets.length > 0
        ? Math.max(...expenseSheets.map((sheet) => (Number.isFinite(sheet.order) ? sheet.order : 0))) + 1
        : 1;
      const nextSheet = {
        id,
        name: sanitizeExpenseSheetName(name, `탭 ${expenseSheets.length + 1}`),
        order: nextOrder,
        rows: [] as ImportRow[],
        createdAt: now,
        updatedAt: now,
      };
      setExpenseSheets((prev) => [...prev, nextSheet]);
      setActiveExpenseSheetIdState(id);
      setExpenseSheetRows([]);
      return id;
    }
    if (!db || !portalUser?.projectId) {
      toast.error('Firestore 연결이 필요합니다. 관리자에게 문의해 주세요.');
      return null;
    }
    const now = new Date().toISOString();
    const id = createExpenseSheetId();
    const nextOrder = expenseSheets.length > 0
      ? Math.max(...expenseSheets.map((sheet) => (Number.isFinite(sheet.order) ? sheet.order : 0))) + 1
      : 1;
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/expense_sheets/${id}`),
      withTenantScope(orgId, {
        id,
        projectId: portalUser.projectId,
        name: sanitizeExpenseSheetName(name, `탭 ${expenseSheets.length + 1}`),
        order: nextOrder,
        rows: [] as ImportRow[],
        createdAt: now,
        updatedAt: now,
        updatedBy: portalUser.name || authUser?.name || '',
      }),
      { merge: true },
    );
    setActiveExpenseSheetIdState(id);
    return id;
  }, [db, orgId, portalUser?.projectId, portalUser?.name, authUser?.name, expenseSheets, isDevHarnessUser]);

  const renameExpenseSheet = useCallback(async (sheetId: string, name: string): Promise<boolean> => {
    if (isDevHarnessUser) {
      const id = String(sheetId || '').trim();
      const nextName = sanitizeExpenseSheetName(name, '');
      if (!id || !nextName) return false;
      setExpenseSheets((prev) => prev.map((sheet) => (
        sheet.id === id
          ? { ...sheet, name: nextName, updatedAt: new Date().toISOString() }
          : sheet
      )));
      return true;
    }
    if (!db || !portalUser?.projectId) {
      toast.error('Firestore 연결이 필요합니다. 관리자에게 문의해 주세요.');
      return false;
    }
    const id = String(sheetId || '').trim();
    const nextName = sanitizeExpenseSheetName(name, '');
    if (!id || !nextName) return false;
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/expense_sheets/${id}`),
      withTenantScope(orgId, {
        id,
        projectId: portalUser.projectId,
        name: nextName,
        updatedAt: new Date().toISOString(),
        updatedBy: portalUser.name || authUser?.name || '',
      }),
      { merge: true },
    );
    return true;
  }, [db, orgId, portalUser?.projectId, portalUser?.name, authUser?.name, isDevHarnessUser]);

  const deleteExpenseSheet = useCallback(async (sheetId: string): Promise<boolean> => {
    if (isDevHarnessUser) {
      const id = String(sheetId || '').trim();
      if (!id) return false;
      if (expenseSheets.length <= 1) {
        toast.message('최소 1개의 탭은 유지되어야 합니다.');
        return false;
      }
      const nextSheets = expenseSheets.filter((sheet) => sheet.id !== id);
      setExpenseSheets(nextSheets);
      if (activeExpenseSheetId === id) {
        const fallback = nextSheets[0]?.id || 'default';
        setActiveExpenseSheetIdState(fallback);
        setExpenseSheetRows(nextSheets.find((sheet) => sheet.id === fallback)?.rows || []);
      }
      return true;
    }
    if (!db || !portalUser?.projectId) {
      toast.error('Firestore 연결이 필요합니다. 관리자에게 문의해 주세요.');
      return false;
    }
    const id = String(sheetId || '').trim();
    if (!id) return false;
    if (expenseSheets.length <= 1) {
      toast.message('최소 1개의 탭은 유지되어야 합니다.');
      return false;
    }
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/expense_sheets/${id}`),
      withTenantScope(orgId, {
        id,
        projectId: portalUser.projectId,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      { merge: true },
    );
    if (activeExpenseSheetId === id) {
      const fallback = expenseSheets.find((sheet) => sheet.id !== id)?.id || 'default';
      setActiveExpenseSheetIdState(fallback);
    }
    return true;
  }, [db, orgId, portalUser?.projectId, expenseSheets, activeExpenseSheetId, isDevHarnessUser]);

  const saveEvidenceRequiredMap = useCallback(async (map: Record<string, string>) => {
    if (isDevHarnessUser) {
      setEvidenceRequiredMap(map);
      return;
    }
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
  }, [db, orgId, portalUser?.projectId, portalUser?.name, authUser?.name, expenseSheetRows, isDevHarnessUser]);

  const saveExpenseSheetRows = useCallback(async (rows: ImportRow[]) => {
    const now = new Date().toISOString();
    const activeSheet = expenseSheets.find((sheet) => sheet.id === activeExpenseSheetId) || null;
    const activeSheetId = activeSheet?.id || activeExpenseSheetId || 'default';
    const activeSheetName = sanitizeExpenseSheetName(activeSheet?.name, activeSheetId === 'default' ? '기본 탭' : '새 탭');
    const defaultLedgerId = ledgers.find((ledger) => ledger.projectId === portalUser?.projectId)?.id
      || (portalUser?.projectId ? `l-${portalUser.projectId}` : 'l-default');
    const preparedRows = prepareSettlementImportRows(pruneEmptySettlementRows(rows), {
      projectId: portalUser?.projectId || '',
      defaultLedgerId,
      evidenceRequiredMap,
    });
    const sanitizedRows = preparedRows.map((row) => ({
      tempId: row.tempId || `imp-${Date.now()}`,
      ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
      cells: Array.isArray(row.cells) ? row.cells.map((c) => (c ?? '')) : [],
      ...(row.error ? { error: row.error } : {}),
    }));
    if (isDevHarnessUser || !db || !portalUser?.projectId) {
      setExpenseSheetRows(sanitizedRows as ImportRow[]);
      setExpenseSheets((prev) => {
        const next = [...prev];
        const index = next.findIndex((sheet) => sheet.id === activeSheetId);
        const draftSheet = {
          id: activeSheetId,
          name: activeSheetName,
          rows: sanitizedRows as ImportRow[],
          order: activeSheet?.order || (activeSheetId === 'default' ? 0 : next.length + 1),
          createdAt: activeSheet?.createdAt || now,
          updatedAt: now,
        };
        if (index >= 0) {
          next[index] = draftSheet;
        } else {
          next.push(draftSheet);
        }
        return next;
      });
      return;
    }
    const payload = withTenantScope(orgId, {
      id: activeSheetId,
      projectId: portalUser.projectId,
      name: activeSheetName,
      order: activeSheet?.order || (activeSheetId === 'default' ? 0 : expenseSheets.length + 1),
      rows: sanitizedRows,
      createdAt: activeSheet?.createdAt || now,
      updatedAt: now,
      updatedBy: portalUser.name || authUser?.name || '',
    });
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/expense_sheets/${activeSheetId}`),
      payload,
      { merge: true },
    );
    setExpenseSheetRows(sanitizedRows as ImportRow[]);
  }, [
    db,
    orgId,
    portalUser?.projectId,
    portalUser?.name,
    authUser?.name,
    activeExpenseSheetId,
    expenseSheets,
    budgetPlanRows,
    expenseSheetRows,
    evidenceRequiredMap,
    ledgers,
    isDevHarnessUser,
  ]);

  const saveBudgetPlanRows = useCallback(async (rows: BudgetPlanRow[]) => {
    const now = new Date().toISOString();
    const sanitizedRows = rows.map((row) => ({
      budgetCode: row.budgetCode || '',
      subCode: row.subCode || '',
      initialBudget: Number.isFinite(row.initialBudget) ? row.initialBudget : 0,
      revisedBudget: Number.isFinite(row.revisedBudget ?? NaN) ? row.revisedBudget : 0,
      ...(row.note ? { note: row.note } : {}),
    }));
    if (isDevHarnessUser || !db || !portalUser?.projectId) {
      setBudgetPlanRows(sanitizedRows as BudgetPlanRow[]);
      return;
    }
    const payload = withTenantScope(orgId, {
      projectId: portalUser.projectId,
      rows: sanitizedRows,
      updatedAt: now,
      updatedBy: portalUser.name || authUser?.name || '',
    });
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/budget_summary/default`),
      payload,
      { merge: true },
    );
    setBudgetPlanRows(sanitizedRows as BudgetPlanRow[]);
  }, [db, orgId, portalUser?.projectId, portalUser?.name, authUser?.name, isDevHarnessUser]);

  const saveBudgetCodeBook = useCallback(async (rows: BudgetCodeEntry[], renames: BudgetCodeRename[] = []) => {
    const now = new Date().toISOString();
    const sanitized = normalizeBudgetCodeBook(rows);
    if (sanitized.length === 0) {
      toast.error('비목/세목이 비어 있습니다.');
      return;
    }
    if (isDevHarnessUser || !db || !portalUser?.projectId) {
      setBudgetCodeBook(sanitized);
      return;
    }
    const payload = withTenantScope(orgId, {
      projectId: portalUser.projectId,
      codes: sanitized,
      updatedAt: now,
      updatedBy: portalUser.name || authUser?.name || '',
    });
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/budget_code_book/default`),
      payload,
      { merge: true },
    );
    setBudgetCodeBook(sanitized);

    if (renames.length === 0) return;
    const renameMap = new Map<string, { code: string; sub: string }>();
    renames.forEach((r) => {
      const fromCode = normalizeBudgetLabel(r.fromCode);
      const fromSub = normalizeBudgetLabel(r.fromSub);
      const toCode = normalizeBudgetLabel(r.toCode);
      const toSub = normalizeBudgetLabel(r.toSub);
      if (!fromCode || !fromSub || !toCode || !toSub) return;
      renameMap.set(`${fromCode}|${fromSub}`, { code: toCode, sub: toSub });
    });
    if (renameMap.size === 0) return;

    const budgetPlanRef = doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/budget_summary/default`);
    const expenseSheetRef = doc(
      db,
      `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/expense_sheets/${activeExpenseSheetId || 'default'}`,
    );
    const evidenceMapRef = doc(db, getOrgDocumentPath(orgId, 'budgetEvidenceMaps', portalUser.projectId));
    const updatedBy = portalUser.name || authUser?.name || '';

    if (budgetPlanRows && budgetPlanRows.length > 0) {
      let touched = false;
      const nextRows = budgetPlanRows.map((row) => {
        const key = `${normalizeBudgetLabel(row.budgetCode)}|${normalizeBudgetLabel(row.subCode)}`;
        const mapped = renameMap.get(key);
        if (!mapped) return row;
        touched = true;
        return { ...row, budgetCode: mapped.code, subCode: mapped.sub };
      });
      if (touched) {
        await setDoc(
          budgetPlanRef,
          withTenantScope(orgId, {
            projectId: portalUser.projectId,
            rows: nextRows.map((row) => ({
              budgetCode: row.budgetCode || '',
              subCode: row.subCode || '',
              initialBudget: Number.isFinite(row.initialBudget) ? row.initialBudget : 0,
              revisedBudget: Number.isFinite(row.revisedBudget ?? NaN) ? row.revisedBudget : 0,
              ...(row.note ? { note: row.note } : {}),
            })),
            updatedAt: now,
            updatedBy,
          }),
          { merge: true },
        );
        setBudgetPlanRows(nextRows);
      }
    }

    if (expenseSheetRows && expenseSheetRows.length > 0) {
      const budgetCodeIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '비목');
      const subCodeIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '세목');
      if (budgetCodeIdx >= 0 && subCodeIdx >= 0) {
        let touched = false;
        const nextRows = expenseSheetRows.map((row) => {
          const cells = Array.isArray(row.cells) ? [...row.cells] : [];
          const key = `${normalizeBudgetLabel(cells[budgetCodeIdx] || '')}|${normalizeBudgetLabel(cells[subCodeIdx] || '')}`;
          const mapped = renameMap.get(key);
          if (!mapped) return row;
          cells[budgetCodeIdx] = mapped.code;
          cells[subCodeIdx] = mapped.sub;
          touched = true;
          return { ...row, cells };
        });
        if (touched) {
          await setDoc(
            expenseSheetRef,
            withTenantScope(orgId, {
              projectId: portalUser.projectId,
              rows: nextRows.map((row) => ({
                tempId: row.tempId || `imp-${Date.now()}`,
                ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
                cells: Array.isArray(row.cells) ? row.cells.map((c) => (c ?? '')) : [],
              })),
              updatedAt: now,
              updatedBy,
            }),
            { merge: true },
          );
          setExpenseSheetRows(nextRows);
        }
      }
    }

    if (evidenceRequiredMap && Object.keys(evidenceRequiredMap).length > 0) {
      let touched = false;
      const nextMap: Record<string, string> = {};
      Object.entries(evidenceRequiredMap).forEach(([key, value]) => {
        const [rawCode, rawSub] = key.split('|');
        if (!rawSub) {
          nextMap[key] = value;
          return;
        }
        const mapKey = `${normalizeBudgetLabel(rawCode)}|${normalizeBudgetLabel(rawSub)}`;
        const mapped = renameMap.get(mapKey);
        if (!mapped) {
          nextMap[key] = value;
          return;
        }
        const nextKey = `${mapped.code}|${mapped.sub}`;
        if (!nextMap[nextKey]) nextMap[nextKey] = value;
        touched = true;
      });
      if (touched) {
        await setDoc(
          evidenceMapRef,
          withTenantScope(orgId, {
            projectId: portalUser.projectId,
            map: nextMap,
            updatedAt: now,
            updatedBy,
          }),
          { merge: true },
        );
        setEvidenceRequiredMap(nextMap);
      }
    }
  }, [db, orgId, portalUser?.projectId, portalUser?.name, authUser?.name, activeExpenseSheetId, isDevHarnessUser]);

  const upsertWeeklySubmissionStatus = useCallback(async (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    projectionUpdated?: boolean;
    expenseUpdated?: boolean;
  }) => {
    if (!db) {
      toast.error('Firestore 연결이 필요합니다. 관리자에게 문의해 주세요.');
      return;
    }
    const projectId = input.projectId?.trim();
    const yearMonth = input.yearMonth?.trim();
    const weekNo = Math.max(1, Math.min(6, Math.trunc(input.weekNo)));
    if (!projectId || !/^\d{4}-\d{2}$/.test(yearMonth)) return;

    const now = new Date().toISOString();
    const updatedBy = portalUser?.name || authUser?.name || '';
    const id = `${projectId}-${yearMonth}-w${weekNo}`;
    const ref = doc(db, getOrgDocumentPath(orgId, 'weeklySubmissionStatus', id));
    const patch: WeeklySubmissionStatus = {
      id,
      tenantId: orgId,
      projectId,
      yearMonth,
      weekNo,
      updatedAt: now,
      updatedByName: updatedBy,
    };
    if (typeof input.projectionUpdated === 'boolean') {
      patch.projectionUpdated = input.projectionUpdated;
      patch.projectionUpdatedAt = now;
      patch.projectionUpdatedByName = updatedBy;
    }
    if (typeof input.expenseUpdated === 'boolean') {
      patch.expenseUpdated = input.expenseUpdated;
      patch.expenseUpdatedAt = now;
      patch.expenseUpdatedByName = updatedBy;
    }
    try {
      await setDoc(ref, patch, { merge: true });
    } catch (err) {
      console.error('[PortalStore] weeklySubmissionStatus save failed:', err);
      toast.error('주간 제출 상태 저장에 실패했습니다.');
      throw err;
    }
  }, [db, orgId, portalUser?.name, authUser?.name]);

  const createProjectRequest = useCallback(async (payload: ProjectRequestPayload): Promise<string | null> => {
    if (!db || !authUser) {
      toast.error('로그인 정보를 확인할 수 없습니다.');
      return null;
    }
    const now = new Date().toISOString();
    const id = `pr-${Date.now()}`;
    const request: ProjectRequest = {
      id,
      tenantId: orgId,
      status: 'PENDING',
      payload,
      requestedBy: authUser.uid,
      requestedByName: authUser.name || portalUser?.name || '사용자',
      requestedByEmail: authUser.email || portalUser?.email || '',
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    // Immediately create project (no admin approval flow)
    const projectId = `p${Date.now()}`;
    const slug = String(payload.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 50);
    const project: Project = {
      id: projectId,
      slug,
      orgId,
      name: payload.name,
      officialContractName: payload.officialContractName,
      status: 'CONTRACT_PENDING',
      type: payload.type,
      phase: 'CONFIRMED',
      contractAmount: payload.contractAmount,
      contractStart: payload.contractStart,
      contractEnd: payload.contractEnd,
      settlementType: payload.settlementType,
      basis: payload.basis,
      accountType: payload.accountType,
      paymentPlan: { contract: 0, interim: 0, final: 0 },
      paymentPlanDesc: payload.paymentPlanDesc,
      clientOrg: payload.clientOrg,
      groupwareName: '',
      participantCondition: payload.participantCondition,
      teamMembersDetailed: payload.teamMembersDetailed || [],
      contractType: '계약서(날인)',
      projectPurpose: payload.projectPurpose,
      totalRevenueAmount: payload.totalRevenueAmount,
      supportAmount: payload.supportAmount,
      salesVatAmount: payload.salesVatAmount,
      settlementGuide: payload.settlementGuide,
      contractDocument: payload.contractDocument,
      department: payload.department,
      teamName: payload.teamName,
      managerId: authUser.uid,
      managerName: payload.managerName || authUser.name || portalUser?.name || '',
      budgetCurrentYear: payload.contractAmount || 0,
      taxInvoiceAmount: 0,
      profitRate: 0,
      profitAmount: 0,
      isSettled: false,
      finalPaymentNote: '',
      confirmerName: '',
      lastCheckedAt: '',
      cashflowDiffNote: '',
      description: payload.description,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, getOrgDocumentPath(orgId, 'projects', projectId)), withTenantScope(orgId, project), { merge: true });
    const nextPortalProjectIds = normalizeProjectIds([
      ...(Array.isArray(portalUser?.projectIds) ? portalUser.projectIds : []),
      portalUser?.projectId,
      projectId,
    ]);
    const nextPortalProjectId = resolvePrimaryProjectId(nextPortalProjectIds, projectId) || projectId;
    const nextPortalProjectNames = {
      ...(portalUser?.projectNames || {}),
      [projectId]: payload.name,
    };
    await setDoc(doc(db, getOrgDocumentPath(orgId, 'members', authUser.uid)), {
      uid: authUser.uid,
      name: authUser.name || portalUser?.name || '사용자',
      email: authUser.email || portalUser?.email || '',
      role: (authUser.role || portalUser?.role || 'pm').toLowerCase(),
      tenantId: orgId,
      status: 'ACTIVE',
      ...buildPortalProfilePatch({
        projectId: nextPortalProjectId,
        projectIds: nextPortalProjectIds,
        projectNames: nextPortalProjectNames,
        updatedAt: now,
        updatedByUid: authUser.uid,
        updatedByName: authUser.name || portalUser?.name || '사용자',
      }),
      updatedAt: now,
      createdAt: authUser.registeredAt || now,
      lastLoginAt: now,
    }, { merge: true });
    setPortalUser((previous) => normalizePortalUser({
      id: authUser.uid,
      name: authUser.name || previous?.name || portalUser?.name || '사용자',
      email: authUser.email || previous?.email || portalUser?.email || '',
      role: authUser.role || previous?.role || portalUser?.role || 'pm',
      projectId: nextPortalProjectId,
      projectIds: nextPortalProjectIds,
      projectNames: nextPortalProjectNames,
      registeredAt: previous?.registeredAt || authUser.registeredAt || now,
    }));
    await setDoc(doc(db, getOrgDocumentPath(orgId, 'projectRequests', id)), {
      ...request,
      status: 'APPROVED',
      reviewedBy: authUser.uid,
      reviewedByName: authUser.name || '',
      reviewedAt: now,
      approvedProjectId: projectId,
    }, { merge: true });
    return id;
  }, [db, orgId, portalUser, authUser]);

  const saveBankStatementRows = useCallback(async (sheet: BankStatementSheet) => {
    const now = new Date().toISOString();
    const incomingColumns = Array.isArray(sheet?.columns) ? sheet.columns : [];
    const maxLenFromRows = Array.isArray(sheet?.rows)
      ? sheet.rows.reduce((max, row) => Math.max(max, Array.isArray(row?.cells) ? row.cells.length : 0), 0)
      : 0;
    const rawColumns = incomingColumns.length > 0
      ? incomingColumns
      : Array.from({ length: maxLenFromRows }, (_, i) => BANK_STATEMENT_COLUMNS[i] || `컬럼${i + 1}`);
    const seen = new Set<string>();
    const sanitizedColumns = rawColumns.map((c, i) => {
      const base = normalizeSpace(String(c || `컬럼${i + 1}`)) || `컬럼${i + 1}`;
      let next = base;
      let suffix = 2;
      while (seen.has(next)) {
        next = `${base}_${suffix}`;
        suffix += 1;
      }
      seen.add(next);
      return next;
    });
    const sanitizedRows = (Array.isArray(sheet?.rows) ? sheet.rows : []).map((row, i) => ({
      tempId: row?.tempId || `bank-${Date.now()}-${i}`,
      cells: sanitizedColumns.map((_, colIdx) => normalizeSpace(String(Array.isArray(row?.cells) ? (row.cells[colIdx] ?? '') : ''))),
    }));
    const sanitizedSheet: BankStatementSheet = { columns: sanitizedColumns, rows: sanitizedRows as BankStatementRow[] };
    const mappedExpenseRows = mapBankStatementsToImportRows(sanitizedSheet);
    const nextExpenseRows = mergeBankRowsIntoExpenseSheet(expenseSheetRows, mappedExpenseRows);
    if (isDevHarnessUser || !db || !portalUser?.projectId) {
      setBankStatementRows(sanitizedSheet);
      setExpenseSheetRows(nextExpenseRows);
      return;
    }
    const payload = withTenantScope(orgId, {
      projectId: portalUser.projectId,
      columns: sanitizedColumns,
      rows: sanitizedRows,
      updatedAt: now,
      updatedBy: portalUser.name || authUser?.name || '',
    });
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/bank_statements/default`),
      payload,
      { merge: true },
    );
    setBankStatementRows(sanitizedSheet);

    // Sync into expense sheet rows (통장내역 → 사용내역)
    const activeSheet = expenseSheets.find((sheet) => sheet.id === activeExpenseSheetId) || null;
    const activeSheetId = activeSheet?.id || activeExpenseSheetId || 'default';
    const expensePayload = withTenantScope(orgId, {
      id: activeSheetId,
      projectId: portalUser.projectId,
      name: sanitizeExpenseSheetName(activeSheet?.name, activeSheetId === 'default' ? '기본 탭' : '새 탭'),
      order: activeSheet?.order || (activeSheetId === 'default' ? 0 : expenseSheets.length + 1),
      rows: nextExpenseRows,
      createdAt: activeSheet?.createdAt || now,
      updatedAt: now,
      updatedBy: portalUser.name || authUser?.name || '',
    });
    await setDoc(
      doc(db, `${getOrgDocumentPath(orgId, 'projects', portalUser.projectId)}/expense_sheets/${activeSheetId}`),
      expensePayload,
      { merge: true },
    );
    setExpenseSheetRows(nextExpenseRows);
  }, [db, orgId, portalUser?.projectId, portalUser?.name, authUser?.name, expenseSheetRows, expenseSheets, activeExpenseSheetId, isDevHarnessUser]);

  const persistTransaction = useCallback(async (txData: Transaction) => {
    if (!db) return;
    await setDoc(
      doc(db, getOrgDocumentPath(orgId, 'transactions', txData.id)),
      stripUndefinedDeep(withTenantScope(orgId, txData)),
      { merge: true },
    );
  }, [db, orgId]);

  const register = useCallback(async (
    user: Omit<PortalUser, 'id' | 'registeredAt' | 'projectId' | 'projectIds'> & {
      projectId?: string;
      projectIds?: string[];
      allowEmptyProject?: boolean;
    },
  ): Promise<boolean> => {
    if (isDevHarnessUser) {
      const now = new Date().toISOString();
      const normalizedProjectIds = normalizeProjectIds([
        ...(Array.isArray(user.projectIds) ? user.projectIds : []),
        user.projectId,
      ]);
      const primaryProjectId = resolvePrimaryProjectId(normalizedProjectIds, user.projectId);
      const allowEmpty = Boolean(user.allowEmptyProject);
      if (!primaryProjectId && !allowEmpty) {
        toast.error('최소 1개 이상의 사업을 선택해 주세요.');
        return false;
      }
      const candidate = allowEmpty && !primaryProjectId
        ? {
          id: authUser?.uid || `pu-${Date.now()}`,
          name: user.name || '사용자',
          email: user.email || '',
          role: (authUser?.role || user.role || 'pm').toLowerCase(),
          projectId: '',
          projectIds: [],
          projectNames: portalUser?.projectNames,
          registeredAt: now,
        }
        : normalizePortalUser({
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
      return true;
    }
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
    const allowEmpty = Boolean(user.allowEmptyProject);
    if (!primaryProjectId && !allowEmpty) {
      toast.error('최소 1개 이상의 사업을 선택해 주세요.');
      return false;
    }

    const candidate = allowEmpty && !primaryProjectId
      ? {
        id: authUser?.uid || `pu-${Date.now()}`,
        name: user.name || '사용자',
        email: user.email || '',
        role: (authUser?.role || user.role || 'pm').toLowerCase(),
        projectId: '',
        projectIds: [],
        projectNames: portalUser?.projectNames,
        registeredAt: now,
      }
      : normalizePortalUser({
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

    if (authUser) {
      setIsMemberLoading(true);
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
          ...buildPortalProfilePatch({
            projectId: candidate.projectId,
            projectIds: candidate.projectIds,
            projectNames: candidate.projectNames,
            updatedAt: now,
            updatedByUid: authUser.uid,
            updatedByName: authUser.name || candidate.name,
          }),
          updatedAt: now,
          createdAt: authUser.registeredAt || now,
          lastLoginAt: now,
        }, { merge: true });
        setPortalUser(candidate.role !== memberRole ? { ...candidate, role: memberRole } : candidate);
      } catch (err) {
        console.error('[PortalStore] register member sync error:', err);
        setPortalUser(previousPortalUser);
        toast.error('회원 정보를 저장하지 못했습니다.');
        return false;
      } finally {
        setIsMemberLoading(false);
      }
    } else {
      setPortalUser(candidate);
    }

    return true;
  }, [authUser, firestoreEnabled, db, orgId, portalUser, isDevHarnessUser]);

  const setActiveProject = useCallback(async (projectId: string): Promise<boolean> => {
    if (isDevHarnessUser) {
      const target = projectId.trim();
      if (!target || !portalUser) return false;
      const allowedIds = normalizeProjectIds([
        ...(Array.isArray(portalUser.projectIds) ? portalUser.projectIds : []),
        portalUser.projectId,
      ]);
      if (!includesProject(allowedIds, target)) {
        toast.error('배정되지 않은 사업입니다.');
        return false;
      }
      setPortalUser({
        ...portalUser,
        projectId: target,
      });
      return true;
    }
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

    if (authUser) {
      setIsMemberLoading(true);
      try {
        const now = new Date().toISOString();
        await updateDoc(doc(db, getOrgDocumentPath(orgId, 'members', authUser.uid)), {
          tenantId: orgId,
          ...buildPortalProfilePatch({
            projectId: target,
            projectIds: nextUser.projectIds,
            projectNames: nextUser.projectNames,
            updatedAt: now,
            updatedByUid: authUser.uid,
            updatedByName: authUser.name || nextUser.name,
          }),
          updatedAt: now,
        });
        setPortalUser(nextUser);
      } catch (err) {
        console.error('[PortalStore] setActiveProject member sync error:', err);
        setPortalUser(previousUser);
        toast.error('주사업 변경을 저장하지 못했습니다.');
        return false;
      } finally {
        setIsMemberLoading(false);
      }
    } else {
      setPortalUser(nextUser);
    }

    return true;
  }, [portalUser, firestoreEnabled, db, authUser, orgId, isDevHarnessUser]);

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

  const addComment = useCallback(async (comment: Comment) => {
    if (!portalUser?.projectId) {
      toast.error('사업 정보가 없어 메모를 저장할 수 없습니다.');
      return;
    }

    const isSheetRowComment = (comment.targetType === 'expense_sheet_row')
      || comment.transactionId.startsWith('sheet-row:')
      || comment.sheetRowId?.startsWith('sheet-row:');
    const payload = withTenantScope(orgId, {
      ...comment,
      projectId: comment.projectId || portalUser.projectId,
      targetType: isSheetRowComment ? 'expense_sheet_row' : (comment.targetType || 'transaction'),
      ...(isSheetRowComment ? { sheetRowId: comment.sheetRowId || comment.transactionId } : {}),
    });

    if (firestoreEnabled && db) {
      await setDoc(
        doc(db, getOrgDocumentPath(orgId, 'comments', comment.id)),
        payload,
        { merge: true },
      );
      return;
    }

    setComments((prev) => [...prev, payload as Comment]);
  }, [db, firestoreEnabled, orgId, portalUser?.projectId]);

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
    comments,
    evidenceRequiredMap,
    expenseSheets,
    activeExpenseSheetId,
    expenseSheetRows,
    bankStatementRows,
    budgetPlanRows,
    budgetCodeBook,
    weeklySubmissionStatuses,
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
    addComment,
    saveEvidenceRequiredMap,
    setActiveExpenseSheet,
    createExpenseSheet,
    renameExpenseSheet,
    deleteExpenseSheet,
    saveExpenseSheetRows,
    saveBankStatementRows,
    saveBudgetPlanRows,
    saveBudgetCodeBook,
    upsertWeeklySubmissionStatus,
    createProjectRequest,
  };

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortalStore() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error('usePortalStore must be inside PortalProvider');
  return ctx;
}
