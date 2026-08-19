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
        {/* 알림은 저절로 닫히지 않고 닫을 때까지 쌓인다(2026-08-19 보람). 읽기 전에 사라지면 없는 것과 같다. */}
        <Toaster
          position="bottom-right"
          expand
          closeButton
          visibleToasts={8}
          gap={10}
          toastOptions={{
            duration: Infinity,
            classNames: {
              toast: '!w-[420px] !max-w-[calc(100vw-2rem)] !p-4 !text-[14px] !leading-5 !shadow-lg',
              title: '!text-[14px] !font-semibold',
              description: 'whitespace-pre-line !text-[13px] !leading-5',
              closeButton: '!h-6 !w-6',
            },
          }}
        />
      </AuthProvider>
    </FirebaseProvider>
  );
}
