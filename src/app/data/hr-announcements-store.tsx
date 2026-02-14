import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { PART_PROJECTS } from './participation-data';
import type { ParticipationEntry } from './types';
import { useFirebase } from '../lib/firebase-context';
import { featureFlags } from '../config/feature-flags';
import { getOrgCollectionPath, getOrgDocumentPath } from '../lib/firebase';
import { buildProjectAlerts, deriveAffectedProjectIds } from './hr-announcements.helpers';

export type HrEventType = 'RESIGNATION' | 'LEAVE' | 'TRANSFER' | 'ROLE_CHANGE' | 'RETURN';

export const HR_EVENT_LABELS: Record<HrEventType, string> = {
  RESIGNATION: '퇴사',
  LEAVE: '휴직',
  TRANSFER: '전배',
  ROLE_CHANGE: '역할 변경',
  RETURN: '복직',
};

export const HR_EVENT_COLORS: Record<HrEventType, string> = {
  RESIGNATION: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  LEAVE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  TRANSFER: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  ROLE_CHANGE: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  RETURN: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
};

export interface HrAnnouncement {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNickname: string;
  eventType: HrEventType;
  effectiveDate: string;
  announcedAt: string;
  announcedBy: string;
  description: string;
  affectedProjectIds: string[];
  resolved: boolean;
}

export interface ProjectChangeAlert {
  id: string;
  announcementId: string;
  projectId: string;
  projectName: string;
  employeeId: string;
  employeeName: string;
  eventType: HrEventType;
  effectiveDate: string;
  acknowledged: boolean;
  changeRequestCreated: boolean;
  createdAt: string;
}

interface HrAnnouncementState {
  announcements: HrAnnouncement[];
  alerts: ProjectChangeAlert[];
}

interface HrAnnouncementActions {
  createAnnouncement: (
    data: Omit<HrAnnouncement, 'id' | 'announcedAt' | 'affectedProjectIds' | 'resolved'>,
    participationEntries: ParticipationEntry[],
  ) => void;
  acknowledgeAlert: (alertId: string) => void;
  markAlertResolved: (alertId: string) => void;
  resolveAnnouncement: (announcementId: string) => void;
  getProjectAlerts: (projectId: string) => ProjectChangeAlert[];
  getUnacknowledgedCount: (projectId?: string) => number;
  getAllPendingCount: () => number;
}

const _g = globalThis as any;
if (!_g.__MYSC_HR_CTX__) {
  _g.__MYSC_HR_CTX__ = createContext<(HrAnnouncementState & HrAnnouncementActions) | null>(null);
}
const HrContext: React.Context<(HrAnnouncementState & HrAnnouncementActions) | null> = _g.__MYSC_HR_CTX__;

const INITIAL_ANNOUNCEMENTS: HrAnnouncement[] = [
  {
    id: 'hra-001',
    employeeId: 'e65',
    employeeName: '변민욱',
    employeeNickname: '보람',
    eventType: 'RESIGNATION',
    effectiveDate: '2026-06-30',
    announcedAt: '2026-02-10T09:00:00Z',
    announcedBy: '관리자',
    description: '변민욱(보람) 6월 말 퇴사 예정. 참여 사업 인력변경 필요.',
    affectedProjectIds: ['cts2', 'seed0', 'p001', 'p003'],
    resolved: false,
  },
  {
    id: 'hra-002',
    employeeId: 'e11',
    employeeName: '하윤지',
    employeeNickname: '하모니',
    eventType: 'TRANSFER',
    effectiveDate: '2026-03-01',
    announcedAt: '2026-02-05T14:00:00Z',
    announcedBy: '관리자',
    description: '하윤지(하모니) Seed 0 사업으로 전배. AP IBS 인력변경 필요.',
    affectedProjectIds: ['ap_ibs', 'p002'],
    resolved: false,
  },
];

const INITIAL_ALERTS: ProjectChangeAlert[] = [
  {
    id: 'pca-001',
    announcementId: 'hra-001',
    projectId: 'cts2',
    projectName: 'CTS 참여기업 역량강화 (2025~2028)',
    employeeId: 'e65',
    employeeName: '변민욱',
    eventType: 'RESIGNATION',
    effectiveDate: '2026-06-30',
    acknowledged: false,
    changeRequestCreated: false,
    createdAt: '2026-02-10T09:00:00Z',
  },
  {
    id: 'pca-002',
    announcementId: 'hra-001',
    projectId: 'seed0',
    projectName: 'CTS Seed 0 ODA 혁신기술 액셀러레이팅',
    employeeId: 'e65',
    employeeName: '변민욱',
    eventType: 'RESIGNATION',
    effectiveDate: '2026-06-30',
    acknowledged: false,
    changeRequestCreated: false,
    createdAt: '2026-02-10T09:00:00Z',
  },
  {
    id: 'pca-004',
    announcementId: 'hra-001',
    projectId: 'p001',
    projectName: 'KOICA 이노포트 2023',
    employeeId: 'e65',
    employeeName: '변민욱',
    eventType: 'RESIGNATION',
    effectiveDate: '2026-06-30',
    acknowledged: false,
    changeRequestCreated: false,
    createdAt: '2026-02-10T09:00:00Z',
  },
  {
    id: 'pca-005',
    announcementId: 'hra-001',
    projectId: 'p003',
    projectName: 'CTS 참여기업 역량강화 2023',
    employeeId: 'e65',
    employeeName: '변민욱',
    eventType: 'RESIGNATION',
    effectiveDate: '2026-06-30',
    acknowledged: false,
    changeRequestCreated: false,
    createdAt: '2026-02-10T09:00:00Z',
  },
  {
    id: 'pca-003',
    announcementId: 'hra-002',
    projectId: 'ap_ibs',
    projectName: 'AP IBS 인도네시아·인도 임팩트 펀드',
    employeeId: 'e11',
    employeeName: '하윤지',
    eventType: 'TRANSFER',
    effectiveDate: '2026-03-01',
    acknowledged: false,
    changeRequestCreated: false,
    createdAt: '2026-02-05T14:00:00Z',
  },
  {
    id: 'pca-006',
    announcementId: 'hra-002',
    projectId: 'p002',
    projectName: 'IBS2 ESG 투자',
    employeeId: 'e11',
    employeeName: '하윤지',
    eventType: 'TRANSFER',
    effectiveDate: '2026-03-01',
    acknowledged: false,
    changeRequestCreated: false,
    createdAt: '2026-02-05T14:00:00Z',
  },
];

export function HrAnnouncementProvider({ children }: { children: ReactNode }) {
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db;

  const [announcements, setAnnouncements] = useState<HrAnnouncement[]>(INITIAL_ANNOUNCEMENTS);
  const [alerts, setAlerts] = useState<ProjectChangeAlert[]>(INITIAL_ALERTS);
  const unsubsRef = useRef<Unsubscribe[]>([]);

  useEffect(() => {
    unsubsRef.current.forEach((unsub) => unsub());
    unsubsRef.current = [];

    if (!firestoreEnabled || !db) {
      setAnnouncements(INITIAL_ANNOUNCEMENTS);
      setAlerts(INITIAL_ALERTS);
      return;
    }

    const announcementQuery = query(
      collection(db, getOrgCollectionPath(orgId, 'hrAnnouncements')),
      orderBy('announcedAt', 'desc'),
    );

    const alertQuery = query(
      collection(db, getOrgCollectionPath(orgId, 'projectChangeAlerts')),
      orderBy('createdAt', 'desc'),
    );

    unsubsRef.current.push(
      onSnapshot(announcementQuery, (snap) => {
        const list = snap.docs.map((docItem) => docItem.data() as HrAnnouncement);
        setAnnouncements(list);
      }, (err) => {
        console.error('[HR] announcements listen error:', err);
      }),
    );

    unsubsRef.current.push(
      onSnapshot(alertQuery, (snap) => {
        const list = snap.docs.map((docItem) => docItem.data() as ProjectChangeAlert);
        setAlerts(list);
      }, (err) => {
        console.error('[HR] alerts listen error:', err);
      }),
    );

    return () => {
      unsubsRef.current.forEach((unsub) => unsub());
      unsubsRef.current = [];
    };
  }, [firestoreEnabled, db, orgId]);

  const createAnnouncement = useCallback((
    data: Omit<HrAnnouncement, 'id' | 'announcedAt' | 'affectedProjectIds' | 'resolved'>,
    participationEntries: ParticipationEntry[],
  ) => {
    const now = new Date().toISOString();
    const annId = `hra-${Date.now()}`;

    const affectedProjectIds = deriveAffectedProjectIds(data.employeeId, participationEntries);

    const announcement: HrAnnouncement = {
      ...data,
      id: annId,
      announcedAt: now,
      affectedProjectIds,
      resolved: false,
    };

    const newAlerts = buildProjectAlerts(announcement, PART_PROJECTS, now).map((alert, index) => ({
      ...alert,
      id: `pca-${Date.now()}-${index}`,
    }));

    setAnnouncements((prev) => [announcement, ...prev]);
    setAlerts((prev) => [...newAlerts, ...prev]);

    if (firestoreEnabled && db) {
      const batch = writeBatch(db);
      batch.set(doc(db, getOrgDocumentPath(orgId, 'hrAnnouncements', announcement.id)), announcement, { merge: true });
      newAlerts.forEach((alert) => {
        batch.set(doc(db, getOrgDocumentPath(orgId, 'projectChangeAlerts', alert.id)), alert, { merge: true });
      });
      batch.commit().catch(console.error);
    }
  }, [firestoreEnabled, db, orgId]);

  const acknowledgeAlert = useCallback((alertId: string) => {
    setAlerts((prev) => prev.map((item) => (item.id === alertId ? { ...item, acknowledged: true } : item)));

    if (firestoreEnabled && db) {
      updateDoc(doc(db, getOrgDocumentPath(orgId, 'projectChangeAlerts', alertId)), {
        acknowledged: true,
      }).catch(console.error);
    }
  }, [firestoreEnabled, db, orgId]);

  const markAlertResolved = useCallback((alertId: string) => {
    setAlerts((prev) => prev.map((item) => (
      item.id === alertId
        ? { ...item, changeRequestCreated: true, acknowledged: true }
        : item
    )));

    if (firestoreEnabled && db) {
      updateDoc(doc(db, getOrgDocumentPath(orgId, 'projectChangeAlerts', alertId)), {
        acknowledged: true,
        changeRequestCreated: true,
      }).catch(console.error);
    }
  }, [firestoreEnabled, db, orgId]);

  const resolveAnnouncement = useCallback((announcementId: string) => {
    setAnnouncements((prev) => prev.map((item) => (
      item.id === announcementId ? { ...item, resolved: true } : item
    )));

    if (firestoreEnabled && db) {
      updateDoc(doc(db, getOrgDocumentPath(orgId, 'hrAnnouncements', announcementId)), {
        resolved: true,
      }).catch(console.error);
    }
  }, [firestoreEnabled, db, orgId]);

  const getProjectAlerts = useCallback((projectId: string) => {
    return alerts.filter((alert) => alert.projectId === projectId);
  }, [alerts]);

  const getUnacknowledgedCount = useCallback((projectId?: string) => {
    if (projectId) {
      return alerts.filter((alert) => alert.projectId === projectId && !alert.acknowledged).length;
    }
    return alerts.filter((alert) => !alert.acknowledged).length;
  }, [alerts]);

  const getAllPendingCount = useCallback(() => {
    return alerts.filter((alert) => !alert.changeRequestCreated).length;
  }, [alerts]);

  const value: HrAnnouncementState & HrAnnouncementActions = {
    announcements,
    alerts,
    createAnnouncement,
    acknowledgeAlert,
    markAlertResolved,
    resolveAnnouncement,
    getProjectAlerts,
    getUnacknowledgedCount,
    getAllPendingCount,
  };

  return <HrContext.Provider value={value}>{children}</HrContext.Provider>;
}

export function useHrAnnouncements() {
  const ctx = useContext(HrContext);
  if (!ctx) throw new Error('useHrAnnouncements must be inside HrAnnouncementProvider');
  return ctx;
}
