import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { TrainingCourse, TrainingEnrollment, EnrollmentStatus } from './types';
import { MOCK_TRAINING_COURSES, MOCK_TRAINING_ENROLLMENTS } from './mock-data';
import { useAuth } from './auth-store';
import { useFirebase } from '../lib/firebase-context';
import { featureFlags } from '../config/feature-flags';
import { getOrgCollectionPath } from '../lib/firebase';
import { toast } from 'sonner';

// ── State / Actions ──

interface TrainingState {
  courses: TrainingCourse[];
  myEnrollments: TrainingEnrollment[];   // portal: 내 수강 신청
  allEnrollments: TrainingEnrollment[];  // admin: 전체
  isLoading: boolean;
}

interface TrainingActions {
  enrollTraining: (courseId: string) => Promise<boolean>;
  dropTraining: (enrollmentId: string) => Promise<boolean>;
  completeEnrollment: (enrollmentId: string) => Promise<boolean>; // admin only
  createCourse: (data: Omit<TrainingCourse, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string | null>;
  updateCourse: (id: string, data: Partial<TrainingCourse>) => Promise<boolean>;
  getEnrollmentsForCourse: (courseId: string) => TrainingEnrollment[];
}

const _g = globalThis as any;
if (!_g.__TRAINING_CTX__) {
  _g.__TRAINING_CTX__ = createContext<(TrainingState & TrainingActions) | null>(null);
}
const TrainingContext: React.Context<(TrainingState & TrainingActions) | null> = _g.__TRAINING_CTX__;

// ── Provider ──

export function TrainingProvider({ children }: { children: ReactNode }) {
  const { authUser } = useAuth();
  const { db, orgId } = useFirebase();
  const [courses, setCourses] = useState<TrainingCourse[]>(MOCK_TRAINING_COURSES);
  const [myEnrollments, setMyEnrollments] = useState<TrainingEnrollment[]>([]);
  const [allEnrollments, setAllEnrollments] = useState<TrainingEnrollment[]>(MOCK_TRAINING_ENROLLMENTS);
  const [isLoading, setIsLoading] = useState(false);

  const firestoreEnabled = featureFlags.firestoreCoreEnabled && !!db;
  const tenantId = orgId;

  // Firestore 실시간 구독
  useEffect(() => {
    if (!firestoreEnabled || !db || !authUser) return;

    const unsubs: Unsubscribe[] = [];

    // 강의 목록 구독
    const coursesRef = collection(db, getOrgCollectionPath(tenantId, 'trainingCourses'));
    unsubs.push(
      onSnapshot(query(coursesRef, orderBy('startDate', 'desc')), (snap) => {
        setCourses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TrainingCourse)));
      }, (err) => {
        console.error('[Training] courses subscription error:', err);
        setCourses(MOCK_TRAINING_COURSES);
      })
    );

    // 내 수강 신청 구독 (portal용)
    const enrollRef = collection(db, getOrgCollectionPath(tenantId, 'trainingEnrollments'));
    unsubs.push(
      onSnapshot(
        query(enrollRef, where('memberId', '==', authUser.uid)),
        (snap) => {
          setMyEnrollments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TrainingEnrollment)));
        },
        (err) => {
          console.error('[Training] myEnrollments subscription error:', err);
          setMyEnrollments(MOCK_TRAINING_ENROLLMENTS.filter((e) => e.memberId === authUser.uid));
        }
      )
    );

    // 전체 수강 신청 구독 (admin용)
    if (authUser.role === 'admin' || authUser.role === 'tenant_admin') {
      unsubs.push(
        onSnapshot(query(enrollRef, orderBy('enrolledAt', 'desc')), (snap) => {
          setAllEnrollments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TrainingEnrollment)));
        }, (err) => {
          console.error('[Training] allEnrollments subscription error:', err);
          setAllEnrollments(MOCK_TRAINING_ENROLLMENTS);
        })
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [authUser?.uid, authUser?.role, firestoreEnabled, db, tenantId]);

  // Local fallback: 내 수강 초기화
  useEffect(() => {
    if (!firestoreEnabled && authUser) {
      setMyEnrollments(MOCK_TRAINING_ENROLLMENTS.filter((e) => e.memberId === authUser.uid));
    }
  }, [authUser?.uid, firestoreEnabled]);

  // 수강 신청
  const enrollTraining = useCallback(async (courseId: string): Promise<boolean> => {
    if (!authUser) return false;

    const course = courses.find((c) => c.id === courseId);
    if (!course) return false;

    // 중복 신청 방지
    const alreadyEnrolled = myEnrollments.some(
      (e) => e.courseId === courseId && e.status !== 'DROPPED'
    );
    if (alreadyEnrolled) {
      toast.error('이미 신청한 강의입니다.');
      return false;
    }

    const now = new Date().toISOString();
    const enrollment: Omit<TrainingEnrollment, 'id'> = {
      courseId,
      courseTitle: course.title,
      memberId: authUser.uid,
      memberName: authUser.name,
      enrolledAt: now,
      status: 'ENROLLED',
    };

    if (firestoreEnabled && db) {
      try {
        const ref = collection(db, getOrgCollectionPath(tenantId, 'trainingEnrollments'));
        await addDoc(ref, { ...enrollment, enrolledAt: serverTimestamp() });
        toast.success(`"${course.title}" 수강 신청이 완료되었습니다.`);
        return true;
      } catch (err) {
        console.error('[Training] enroll failed:', err);
        toast.error('수강 신청에 실패했습니다.');
        return false;
      }
    } else {
      const newEnrollment: TrainingEnrollment = { ...enrollment, id: `te_${Date.now()}` };
      setMyEnrollments((prev) => [...prev, newEnrollment]);
      setAllEnrollments((prev) => [...prev, newEnrollment]);
      toast.success(`"${course.title}" 수강 신청이 완료되었습니다.`);
      return true;
    }
  }, [authUser, courses, myEnrollments, firestoreEnabled, db, tenantId]);

  // 수강 취소
  const dropTraining = useCallback(async (enrollmentId: string): Promise<boolean> => {
    if (firestoreEnabled && db) {
      try {
        const ref = doc(db, getOrgCollectionPath(tenantId, 'trainingEnrollments'), enrollmentId);
        await updateDoc(ref, { status: 'DROPPED' as EnrollmentStatus });
        toast.success('수강 취소되었습니다.');
        return true;
      } catch (err) {
        console.error('[Training] drop failed:', err);
        toast.error('수강 취소에 실패했습니다.');
        return false;
      }
    } else {
      const updater = (list: TrainingEnrollment[]) =>
        list.map((e) => e.id === enrollmentId ? { ...e, status: 'DROPPED' as EnrollmentStatus } : e);
      setMyEnrollments(updater);
      setAllEnrollments(updater);
      toast.success('수강 취소되었습니다.');
      return true;
    }
  }, [firestoreEnabled, db, tenantId]);

  // 이수 처리 (admin only) → enrollmentId 기준
  const completeEnrollment = useCallback(async (enrollmentId: string): Promise<boolean> => {
    const now = new Date().toISOString();
    if (firestoreEnabled && db) {
      try {
        const ref = doc(db, getOrgCollectionPath(tenantId, 'trainingEnrollments'), enrollmentId);
        await updateDoc(ref, {
          status: 'COMPLETED' as EnrollmentStatus,
          completedAt: now,
        });
        toast.success('이수 처리되었습니다.');
        return true;
      } catch (err) {
        console.error('[Training] complete failed:', err);
        toast.error('이수 처리에 실패했습니다.');
        return false;
      }
    } else {
      const updater = (list: TrainingEnrollment[]) =>
        list.map((e) =>
          e.id === enrollmentId
            ? { ...e, status: 'COMPLETED' as EnrollmentStatus, completedAt: now }
            : e
        );
      setMyEnrollments(updater);
      setAllEnrollments(updater);
      toast.success('이수 처리되었습니다.');
      return true;
    }
  }, [firestoreEnabled, db, tenantId]);

  // 강의 생성 (admin only)
  const createCourse = useCallback(async (
    data: Omit<TrainingCourse, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<string | null> => {
    const now = new Date().toISOString();
    const courseData: Omit<TrainingCourse, 'id'> = { ...data, createdAt: now, updatedAt: now };

    if (firestoreEnabled && db) {
      try {
        const ref = collection(db, getOrgCollectionPath(tenantId, 'trainingCourses'));
        const docRef = await addDoc(ref, courseData);
        toast.success(`강의 "${data.title}"가 등록되었습니다.`);
        return docRef.id;
      } catch (err) {
        console.error('[Training] createCourse failed:', err);
        toast.error('강의 등록에 실패했습니다.');
        return null;
      }
    } else {
      const newCourse: TrainingCourse = { ...courseData, id: `tc_${Date.now()}` };
      setCourses((prev) => [newCourse, ...prev]);
      toast.success(`강의 "${data.title}"가 등록되었습니다.`);
      return newCourse.id;
    }
  }, [firestoreEnabled, db, tenantId]);

  // 강의 수정 (admin only)
  const updateCourse = useCallback(async (id: string, data: Partial<TrainingCourse>): Promise<boolean> => {
    const now = new Date().toISOString();
    if (firestoreEnabled && db) {
      try {
        const ref = doc(db, getOrgCollectionPath(tenantId, 'trainingCourses'), id);
        await updateDoc(ref, { ...data, updatedAt: now });
        return true;
      } catch (err) {
        console.error('[Training] updateCourse failed:', err);
        toast.error('강의 수정에 실패했습니다.');
        return false;
      }
    } else {
      setCourses((prev) => prev.map((c) => c.id === id ? { ...c, ...data, updatedAt: now } : c));
      return true;
    }
  }, [firestoreEnabled, db, tenantId]);

  // 특정 강의의 수강자 목록
  const getEnrollmentsForCourse = useCallback((courseId: string): TrainingEnrollment[] => {
    return allEnrollments.filter((e) => e.courseId === courseId);
  }, [allEnrollments]);

  const value = {
    courses,
    myEnrollments,
    allEnrollments,
    isLoading,
    enrollTraining,
    dropTraining,
    completeEnrollment,
    createCourse,
    updateCourse,
    getEnrollmentsForCourse,
  };

  return <TrainingContext.Provider value={value}>{children}</TrainingContext.Provider>;
}

export function useTraining() {
  const ctx = useContext(TrainingContext);
  if (!ctx) throw new Error('useTraining must be used within TrainingProvider');
  return ctx;
}
