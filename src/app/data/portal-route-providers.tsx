import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { BoardProvider } from './board-store';
import { CareerProfileProvider } from './career-profile-store';
import { CashflowWeekProvider } from './cashflow-weeks-store';
import { FirestoreRouteModeProvider } from './firestore-realtime-mode';
import { HrAnnouncementProvider } from './hr-announcements-store';
import { PayrollProvider } from './payroll-store';
import { TrainingProvider } from './training-store';

export function resolvePortalProviderScope(pathname = typeof window !== 'undefined' ? window.location.pathname : '') {
  const path = pathname.replace(/\/+$/, '') || '/portal';
  if (path === '/portal/cashflow' || path === '/portal/cashflow/sheets-lab') {
    return {
      hrAnnouncements: false,
      payroll: false,
      cashflowWeeks: true,
      board: false,
      careerProfile: false,
      training: false,
    };
  }
  if (path === '/portal/payroll') {
    return {
      hrAnnouncements: true,
      payroll: true,
      cashflowWeeks: true,
      board: false,
      careerProfile: false,
      training: false,
    };
  }
  if (path.startsWith('/portal/board')) {
    return {
      hrAnnouncements: true,
      payroll: true,
      cashflowWeeks: false,
      board: true,
      careerProfile: false,
      training: false,
    };
  }
  if (path === '/portal/training') {
    return {
      hrAnnouncements: true,
      payroll: true,
      cashflowWeeks: false,
      board: false,
      careerProfile: false,
      training: true,
    };
  }
  if (path === '/portal/career-profile') {
    return {
      hrAnnouncements: true,
      payroll: true,
      cashflowWeeks: false,
      board: false,
      careerProfile: true,
      training: true,
    };
  }
  return {
    hrAnnouncements: true,
    payroll: true,
    cashflowWeeks: true,
    board: true,
    careerProfile: true,
    training: true,
  };
}

export function PortalRouteProviderFrame({
  children,
  pathname = typeof window !== 'undefined' ? window.location.pathname : '',
}: {
  children: ReactNode;
  pathname?: string;
}) {
  const scope = resolvePortalProviderScope(pathname);
  let tree = children;
  if (scope.training) tree = <TrainingProvider>{tree}</TrainingProvider>;
  if (scope.careerProfile) tree = <CareerProfileProvider>{tree}</CareerProfileProvider>;
  if (scope.board) tree = <BoardProvider>{tree}</BoardProvider>;
  if (scope.cashflowWeeks) tree = <CashflowWeekProvider>{tree}</CashflowWeekProvider>;
  if (scope.payroll) tree = <PayrollProvider>{tree}</PayrollProvider>;
  if (scope.hrAnnouncements) tree = <HrAnnouncementProvider>{tree}</HrAnnouncementProvider>;

  return (
    <FirestoreRouteModeProvider mode="portal-safe">
      {tree}
    </FirestoreRouteModeProvider>
  );
}

export function PortalRouteProviders({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <PortalRouteProviderFrame pathname={location.pathname}>{children}</PortalRouteProviderFrame>;
}
