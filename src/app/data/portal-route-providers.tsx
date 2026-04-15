import type { ReactNode } from 'react';
import { BoardProvider } from './board-store';
import { CareerProfileProvider } from './career-profile-store';
import { CashflowWeekProvider } from './cashflow-weeks-store';
import { FirestoreRouteModeProvider } from './firestore-realtime-mode';
import { HrAnnouncementProvider } from './hr-announcements-store';
import { PayrollProvider } from './payroll-store';
import { TrainingProvider } from './training-store';

export function PortalRouteProviders({ children }: { children: ReactNode }) {
  return (
    <FirestoreRouteModeProvider mode="portal-safe">
      <HrAnnouncementProvider>
        <PayrollProvider>
          <CashflowWeekProvider>
            <BoardProvider>
              <CareerProfileProvider>
                <TrainingProvider>{children}</TrainingProvider>
              </CareerProfileProvider>
            </BoardProvider>
          </CashflowWeekProvider>
        </PayrollProvider>
      </HrAnnouncementProvider>
    </FirestoreRouteModeProvider>
  );
}
