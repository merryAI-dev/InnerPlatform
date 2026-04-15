import type { ReactNode } from 'react';
import { BoardProvider } from './board-store';
import { CashflowWeekProvider } from './cashflow-weeks-store';
import { FirestoreRouteModeProvider } from './firestore-realtime-mode';
import { HrAnnouncementProvider } from './hr-announcements-store';
import { PayrollProvider } from './payroll-store';
import { TrainingProvider } from './training-store';

export function AdminRouteProviders({ children }: { children: ReactNode }) {
  return (
    <FirestoreRouteModeProvider mode="admin-live">
      <HrAnnouncementProvider>
        <PayrollProvider>
          <CashflowWeekProvider>
            <BoardProvider>
              <TrainingProvider>{children}</TrainingProvider>
            </BoardProvider>
          </CashflowWeekProvider>
        </PayrollProvider>
      </HrAnnouncementProvider>
    </FirestoreRouteModeProvider>
  );
}
