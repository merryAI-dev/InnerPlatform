import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { router } from './routes';
import { AuthProvider } from './data/auth-store';
import { HrAnnouncementProvider } from './data/hr-announcements-store';
import { FirebaseProvider } from './lib/firebase-context';

export default function App() {
  return (
    <FirebaseProvider>
      <AuthProvider>
        <HrAnnouncementProvider>
          <RouterProvider router={router} />
          <Toaster position="bottom-right" />
        </HrAnnouncementProvider>
      </AuthProvider>
    </FirebaseProvider>
  );
}
