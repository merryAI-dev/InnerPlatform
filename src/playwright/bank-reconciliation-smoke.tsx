import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import { FirebaseProvider } from '../app/lib/firebase-context';
import { AuthProvider } from '../app/data/auth-store';
import { AppProvider } from '../app/data/store';
import { BankReconciliationPage } from '../app/components/cashflow/BankReconciliationPage';

function seedLocalAuth(): void {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role') === 'finance' ? 'finance' : 'pm';
  const name = role === 'finance' ? 'Finance Smoke' : 'PM Smoke';
  localStorage.setItem('MYSC_ACTIVE_TENANT', 'mysc');
  localStorage.setItem(
    'mysc-auth-user',
    JSON.stringify({
      uid: `smoke-${role}`,
      name,
      email: `${role}@mysc.co.kr`,
      role,
      tenantId: 'mysc',
      projectId: 'p002',
      projectIds: ['p002'],
    }),
  );
}

seedLocalAuth();

function BankReconciliationSmokeHarness() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 text-slate-900">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Playwright smoke</p>
          <h1 className="text-2xl font-black tracking-tight">은행 거래내역 대조</h1>
          <p className="text-sm text-slate-600">
            헤더는 그대로 두고 역할별 은행 적요 노출만 검증합니다.
          </p>
        </header>

        <FirebaseProvider>
          <AuthProvider>
            <AppProvider>
              <BankReconciliationPage />
            </AppProvider>
          </AuthProvider>
        </FirebaseProvider>
      </div>
    </div>
  );
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing root container');
}

createRoot(root).render(<BankReconciliationSmokeHarness />);
