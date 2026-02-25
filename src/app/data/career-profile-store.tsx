import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import {
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import type { CareerProfile, EducationEntry, WorkHistoryEntry, CertificationEntry } from './types';
import { MOCK_CAREER_PROFILES } from './mock-data';
import { useAuth } from './auth-store';
import { useFirebase } from '../lib/firebase-context';
import { featureFlags } from '../config/feature-flags';
import { getOrgDocumentPath } from '../lib/firebase';
import { toast } from 'sonner';

// ── Empty profile factory ──

export function createEmptyCareerProfile(uid: string, orgId: string, nameKo: string): CareerProfile {
  return {
    uid,
    orgId,
    nameKo,
    education: [],
    workHistory: [],
    certifications: [],
    updatedAt: new Date().toISOString(),
  };
}

// ── State / Actions ──

interface CareerProfileState {
  myProfile: CareerProfile | null;
  viewedProfile: CareerProfile | null; // admin이 타인 프로필 조회 시
  isLoading: boolean;
}

interface CareerProfileActions {
  saveMyProfile: (updates: Partial<CareerProfile>) => Promise<boolean>;
  loadProfileByUid: (uid: string) => Promise<CareerProfile | null>;
  addEducation: (entry: Omit<EducationEntry, 'id'>) => Promise<boolean>;
  updateEducation: (id: string, entry: Partial<EducationEntry>) => Promise<boolean>;
  removeEducation: (id: string) => Promise<boolean>;
  addWorkHistory: (entry: Omit<WorkHistoryEntry, 'id'>) => Promise<boolean>;
  updateWorkHistory: (id: string, entry: Partial<WorkHistoryEntry>) => Promise<boolean>;
  removeWorkHistory: (id: string) => Promise<boolean>;
  addCertification: (entry: Omit<CertificationEntry, 'id'>) => Promise<boolean>;
  removeCertification: (id: string) => Promise<boolean>;
}

const _g = globalThis as any;
if (!_g.__CAREER_PROFILE_CTX__) {
  _g.__CAREER_PROFILE_CTX__ = createContext<(CareerProfileState & CareerProfileActions) | null>(null);
}
const CareerProfileContext: React.Context<(CareerProfileState & CareerProfileActions) | null> =
  _g.__CAREER_PROFILE_CTX__;

// ── Helpers ──

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Provider ──

export function CareerProfileProvider({ children }: { children: ReactNode }) {
  const { authUser } = useAuth();
  const { db, orgId } = useFirebase();
  const [myProfile, setMyProfile] = useState<CareerProfile | null>(null);
  const [viewedProfile, setViewedProfile] = useState<CareerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const firestoreEnabled = featureFlags.firestoreCoreEnabled && !!db;
  const tenantId = orgId;

  // 로그인 시 내 프로필 로드
  useEffect(() => {
    if (!authUser) {
      setMyProfile(null);
      return;
    }

    if (firestoreEnabled && db) {
      setIsLoading(true);
      const ref = doc(db, getOrgDocumentPath(tenantId, 'careerProfiles', authUser.uid));
      getDoc(ref)
        .then((snap) => {
          if (snap.exists()) {
            setMyProfile(snap.data() as CareerProfile);
          } else {
            // 프로필 없으면 빈 프로필 생성
            const empty = createEmptyCareerProfile(authUser.uid, tenantId, authUser.name);
            setMyProfile(empty);
          }
        })
        .catch((err) => {
          console.error('[CareerProfile] load failed:', err);
          const fallback = MOCK_CAREER_PROFILES.find((p) => p.uid === authUser.uid) ||
            createEmptyCareerProfile(authUser.uid, tenantId, authUser.name);
          setMyProfile(fallback);
        })
        .finally(() => setIsLoading(false));
    } else {
      // Local fallback
      const fallback = MOCK_CAREER_PROFILES.find((p) => p.uid === authUser.uid) ||
        createEmptyCareerProfile(authUser.uid, tenantId, authUser.name);
      setMyProfile(fallback);
    }
  }, [authUser?.uid, authUser?.name, firestoreEnabled, db, tenantId]);

  // 프로필 저장 (Firestore 또는 local state)
  const saveMyProfile = useCallback(async (updates: Partial<CareerProfile>): Promise<boolean> => {
    if (!authUser || !myProfile) return false;
    const now = new Date().toISOString();
    const updated: CareerProfile = { ...myProfile, ...updates, updatedAt: now };

    if (firestoreEnabled && db) {
      try {
        const ref = doc(db, getOrgDocumentPath(tenantId, 'careerProfiles', authUser.uid));
        await setDoc(ref, updated, { merge: true });
        setMyProfile(updated);
        return true;
      } catch (err) {
        console.error('[CareerProfile] save failed:', err);
        toast.error('프로필 저장에 실패했습니다.');
        return false;
      }
    } else {
      setMyProfile(updated);
      return true;
    }
  }, [authUser, myProfile, firestoreEnabled, db, tenantId]);

  // admin이 타인 프로필 조회
  const loadProfileByUid = useCallback(async (uid: string): Promise<CareerProfile | null> => {
    setIsLoading(true);
    try {
      if (firestoreEnabled && db) {
        const ref = doc(db, getOrgDocumentPath(tenantId, 'careerProfiles', uid));
        const snap = await getDoc(ref);
        const profile = snap.exists()
          ? (snap.data() as CareerProfile)
          : createEmptyCareerProfile(uid, tenantId, uid);
        setViewedProfile(profile);
        return profile;
      } else {
        const profile = MOCK_CAREER_PROFILES.find((p) => p.uid === uid) ||
          createEmptyCareerProfile(uid, tenantId, uid);
        setViewedProfile(profile);
        return profile;
      }
    } catch (err) {
      console.error('[CareerProfile] loadByUid failed:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [firestoreEnabled, db, tenantId]);

  // ── 학력 CRUD ──

  const addEducation = useCallback(async (entry: Omit<EducationEntry, 'id'>): Promise<boolean> => {
    if (!myProfile) return false;
    const newEntry: EducationEntry = { ...entry, id: generateId('edu') };
    return saveMyProfile({ education: [...myProfile.education, newEntry] });
  }, [myProfile, saveMyProfile]);

  const updateEducation = useCallback(async (id: string, entry: Partial<EducationEntry>): Promise<boolean> => {
    if (!myProfile) return false;
    const updated = myProfile.education.map((e) => e.id === id ? { ...e, ...entry } : e);
    return saveMyProfile({ education: updated });
  }, [myProfile, saveMyProfile]);

  const removeEducation = useCallback(async (id: string): Promise<boolean> => {
    if (!myProfile) return false;
    return saveMyProfile({ education: myProfile.education.filter((e) => e.id !== id) });
  }, [myProfile, saveMyProfile]);

  // ── 직장경력 CRUD ──

  const addWorkHistory = useCallback(async (entry: Omit<WorkHistoryEntry, 'id'>): Promise<boolean> => {
    if (!myProfile) return false;
    const newEntry: WorkHistoryEntry = { ...entry, id: generateId('wh') };
    return saveMyProfile({ workHistory: [...myProfile.workHistory, newEntry] });
  }, [myProfile, saveMyProfile]);

  const updateWorkHistory = useCallback(async (id: string, entry: Partial<WorkHistoryEntry>): Promise<boolean> => {
    if (!myProfile) return false;
    const updated = myProfile.workHistory.map((e) => e.id === id ? { ...e, ...entry } : e);
    return saveMyProfile({ workHistory: updated });
  }, [myProfile, saveMyProfile]);

  const removeWorkHistory = useCallback(async (id: string): Promise<boolean> => {
    if (!myProfile) return false;
    return saveMyProfile({ workHistory: myProfile.workHistory.filter((e) => e.id !== id) });
  }, [myProfile, saveMyProfile]);

  // ── 자격증 CRUD ──

  const addCertification = useCallback(async (entry: Omit<CertificationEntry, 'id'>): Promise<boolean> => {
    if (!myProfile) return false;
    const newEntry: CertificationEntry = { ...entry, id: generateId('cert') };
    return saveMyProfile({ certifications: [...myProfile.certifications, newEntry] });
  }, [myProfile, saveMyProfile]);

  const removeCertification = useCallback(async (id: string): Promise<boolean> => {
    if (!myProfile) return false;
    return saveMyProfile({ certifications: myProfile.certifications.filter((e) => e.id !== id) });
  }, [myProfile, saveMyProfile]);

  const value = {
    myProfile,
    viewedProfile,
    isLoading,
    saveMyProfile,
    loadProfileByUid,
    addEducation,
    updateEducation,
    removeEducation,
    addWorkHistory,
    updateWorkHistory,
    removeWorkHistory,
    addCertification,
    removeCertification,
  };

  return <CareerProfileContext.Provider value={value}>{children}</CareerProfileContext.Provider>;
}

export function useCareerProfile() {
  const ctx = useContext(CareerProfileContext);
  if (!ctx) throw new Error('useCareerProfile must be used within CareerProfileProvider');
  return ctx;
}
