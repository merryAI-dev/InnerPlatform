import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { router } from './routes';
import { AuthProvider } from './data/auth-store';
import { HrAnnouncementProvider } from './data/hr-announcements-store';
import { BoardProvider } from './data/board-store';
import { PayrollProvider } from './data/payroll-store';
import { FirebaseProvider } from './lib/firebase-context';

export default function App() {
  return (
    <FirebaseProvider>
      <AuthProvider>
        <HrAnnouncementProvider>
          <PayrollProvider>
            <BoardProvider>
              <RouterProvider router={router} />
              <Toaster position="bottom-right" />
            </BoardProvider>
          </PayrollProvider>
        </HrAnnouncementProvider>
      </AuthProvider>
    </FirebaseProvider>
  );
}
