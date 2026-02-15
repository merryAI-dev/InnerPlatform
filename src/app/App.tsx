import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { router } from './routes';
import { AuthProvider } from './data/auth-store';
import { HrAnnouncementProvider } from './data/hr-announcements-store';
import { BoardProvider } from './data/board-store';
import { PayrollProvider } from './data/payroll-store';
import { CashflowWeekProvider } from './data/cashflow-weeks-store';
import { FirebaseProvider } from './lib/firebase-context';

export default function App() {
  return (
    <FirebaseProvider>
      <AuthProvider>
        <HrAnnouncementProvider>
          <PayrollProvider>
            <CashflowWeekProvider>
              <BoardProvider>
                <RouterProvider router={router} />
                <Toaster position="bottom-right" />
              </BoardProvider>
            </CashflowWeekProvider>
          </PayrollProvider>
        </HrAnnouncementProvider>
      </AuthProvider>
    </FirebaseProvider>
  );
}
