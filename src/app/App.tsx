import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { router } from './routes';
import { AuthProvider } from './data/auth-store';
import { HrAnnouncementProvider } from './data/hr-announcements-store';
import { BoardProvider } from './data/board-store';
import { FirebaseProvider } from './lib/firebase-context';

export default function App() {
  return (
    <FirebaseProvider>
      <AuthProvider>
        <HrAnnouncementProvider>
          <BoardProvider>
            <RouterProvider router={router} />
            <Toaster position="bottom-right" />
          </BoardProvider>
        </HrAnnouncementProvider>
      </AuthProvider>
    </FirebaseProvider>
  );
}
