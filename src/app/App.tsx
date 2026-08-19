import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { router } from './routes';
import { AuthProvider } from './data/auth-store';
import { FirebaseProvider } from './lib/firebase-context';

export default function App() {
  return (
    <FirebaseProvider>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" toastOptions={{ classNames: { description: 'whitespace-pre-line' } }} />
      </AuthProvider>
    </FirebaseProvider>
  );
}
