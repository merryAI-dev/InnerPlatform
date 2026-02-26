import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { PortalLayout } from './components/portal/PortalLayout';

// Lazy-loaded pages — each becomes a separate chunk
const LoginPage = lazy(() => import('./components/auth/LoginPage').then(m => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import('./components/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const BoardFeedPage = lazy(() => import('./components/board/BoardFeedPage').then(m => ({ default: m.BoardFeedPage })));
const BoardPostPage = lazy(() => import('./components/board/BoardPostPage').then(m => ({ default: m.BoardPostPage })));
const ProjectListPage = lazy(() => import('./components/projects/ProjectListPage').then(m => ({ default: m.ProjectListPage })));
const ProjectDetailPage = lazy(() => import('./components/projects/ProjectDetailPage').then(m => ({ default: m.ProjectDetailPage })));
const ProjectWizardPage = lazy(() => import('./components/projects/ProjectWizardPage').then(m => ({ default: m.ProjectWizardPage })));
const LedgerDetailPage = lazy(() => import('./components/ledgers/LedgerDetailPage').then(m => ({ default: m.LedgerDetailPage })));
const CashflowPage = lazy(() => import('./components/cashflow/CashflowPage').then(m => ({ default: m.CashflowPage })));
const ProjectCashflowSheetPage = lazy(() => import('./components/cashflow/ProjectCashflowSheetPage').then(m => ({ default: m.ProjectCashflowSheetPage })));
const EvidenceQueuePage = lazy(() => import('./components/evidence/EvidenceQueuePage').then(m => ({ default: m.EvidenceQueuePage })));
const AuditLogPage = lazy(() => import('./components/audit/AuditLogPage').then(m => ({ default: m.AuditLogPage })));
const SettingsPage = lazy(() => import('./components/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ParticipationPage = lazy(() => import('./components/participation/ParticipationPage').then(m => ({ default: m.ParticipationPage })));
const KoicaPersonnelPage = lazy(() => import('./components/koica/KoicaPersonnelPage').then(m => ({ default: m.KoicaPersonnelPage })));
const PersonnelChangePage = lazy(() => import('./components/koica/PersonnelChangePage').then(m => ({ default: m.PersonnelChangePage })));
const BudgetSummaryPage = lazy(() => import('./components/budget/BudgetSummaryPage').then(m => ({ default: m.BudgetSummaryPage })));
const ExpenseManagementPage = lazy(() => import('./components/expense/ExpenseManagementPage').then(m => ({ default: m.ExpenseManagementPage })));
const AdminApprovalPage = lazy(() => import('./components/approval/AdminApprovalPage').then(m => ({ default: m.AdminApprovalPage })));
const UserManagementPage = lazy(() => import('./components/users/UserManagementPage').then(m => ({ default: m.UserManagementPage })));
const AdminHrAnnouncementPage = lazy(() => import('./components/hr/AdminHrAnnouncementPage').then(m => ({ default: m.AdminHrAnnouncementPage })));
const AdminPayrollPage = lazy(() => import('./components/payroll/AdminPayrollPage').then(m => ({ default: m.AdminPayrollPage })));
const TrainingManagePage = lazy(() => import('./components/training/TrainingManagePage').then(m => ({ default: m.TrainingManagePage })));
const BankReconciliationPage = lazy(() => import('./components/cashflow/BankReconciliationPage').then(m => ({ default: m.BankReconciliationPage })));
const NotFoundPage = lazy(() => import('./components/layout/NotFoundPage').then(m => ({ default: m.NotFoundPage })));

// Portal pages
const PortalOnboarding = lazy(() => import('./components/portal/PortalOnboarding').then(m => ({ default: m.PortalOnboarding })));
const PortalProjectSettings = lazy(() => import('./components/portal/PortalProjectSettings').then(m => ({ default: m.PortalProjectSettings })));
const PortalDashboard = lazy(() => import('./components/portal/PortalDashboard').then(m => ({ default: m.PortalDashboard })));
const PortalExpenses = lazy(() => import('./components/portal/PortalExpenses').then(m => ({ default: m.PortalExpenses })));
const PortalBudget = lazy(() => import('./components/portal/PortalBudget').then(m => ({ default: m.PortalBudget })));
const PortalPersonnel = lazy(() => import('./components/portal/PortalPersonnel').then(m => ({ default: m.PortalPersonnel })));
const PortalChangeRequests = lazy(() => import('./components/portal/PortalChangeRequests').then(m => ({ default: m.PortalChangeRequests })));
const PortalProjectRegister = lazy(() => import('./components/portal/PortalProjectRegister').then(m => ({ default: m.PortalProjectRegister })));
const PortalPayrollPage = lazy(() => import('./components/portal/PortalPayrollPage').then(m => ({ default: m.PortalPayrollPage })));
const PortalCashflowPage = lazy(() => import('./components/portal/PortalCashflowPage').then(m => ({ default: m.PortalCashflowPage })));
const PortalSubmissionsPage = lazy(() => import('./components/portal/PortalSubmissionsPage').then(m => ({ default: m.PortalSubmissionsPage })));
const CareerProfilePage = lazy(() => import('./components/portal/CareerProfilePage').then(m => ({ default: m.CareerProfilePage })));
const PortalTrainingPage = lazy(() => import('./components/portal/PortalTrainingPage').then(m => ({ default: m.PortalTrainingPage })));
const PortalWeeklyExpensePage = lazy(() => import('./components/portal/PortalWeeklyExpensePage').then(m => ({ default: m.PortalWeeklyExpensePage })));
const GuideChatPage = lazy(() => import('./components/guide-chat/GuideChatPage').then(m => ({ default: m.GuideChatPage })));

// Suspense wrapper — layouts already provide visual chrome, so a minimal fallback suffices
function S({ C }: { C: ComponentType }) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-40 text-sm text-muted-foreground">로딩 중…</div>}>
      <C />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  // ── Login ──
  { path: '/login', element: <S C={LoginPage} /> },
  // ── Admin (관리자) ──
  {
    path: '/',
    Component: AppLayout,
    children: [
      { index: true, element: <S C={DashboardPage} /> },
      // ── Company Board (전사 게시판) ──
      {
        path: 'board',
        children: [
          { index: true, element: <S C={BoardFeedPage} /> },
          { path: ':postId', element: <S C={BoardPostPage} /> },
        ],
      },
      { path: 'projects', element: <S C={ProjectListPage} /> },
      { path: 'projects/new', element: <S C={ProjectWizardPage} /> },
      { path: 'projects/:projectId', element: <S C={ProjectDetailPage} /> },
      { path: 'projects/:projectId/edit', element: <S C={ProjectWizardPage} /> },
      { path: 'projects/:projectId/ledgers/:ledgerId', element: <S C={LedgerDetailPage} /> },
      { path: 'cashflow', element: <S C={CashflowPage} /> },
      { path: 'cashflow/projects', element: <S C={CashflowPage} /> },
      { path: 'cashflow/projects/:projectId', element: <S C={ProjectCashflowSheetPage} /> },
      { path: 'evidence', element: <S C={EvidenceQueuePage} /> },
      { path: 'bank-reconciliation', element: <S C={BankReconciliationPage} /> },
      { path: 'participation', element: <S C={ParticipationPage} /> },
      { path: 'koica-personnel', element: <S C={KoicaPersonnelPage} /> },
      { path: 'personnel-changes', element: <S C={PersonnelChangePage} /> },
      { path: 'budget-summary', element: <S C={BudgetSummaryPage} /> },
      { path: 'expense-management', element: <S C={ExpenseManagementPage} /> },
      { path: 'payroll', element: <S C={AdminPayrollPage} /> },
      { path: 'approvals', element: <S C={AdminApprovalPage} /> },
      { path: 'users', element: <S C={UserManagementPage} /> },
      { path: 'hr-announcements', element: <S C={AdminHrAnnouncementPage} /> },
      { path: 'training', element: <S C={TrainingManagePage} /> },
      { path: 'audit', element: <S C={AuditLogPage} /> },
      { path: 'settings', element: <S C={SettingsPage} /> },
      { path: '*', element: <S C={NotFoundPage} /> },
    ],
  },
  // ── Portal (사용자/PM 전용) ──
  {
    path: '/portal',
    Component: PortalLayout,
    children: [
      { index: true, element: <S C={PortalDashboard} /> },
      // ── Company Board (전사 게시판) ──
      {
        path: 'board',
        children: [
          { index: true, element: <S C={BoardFeedPage} /> },
          { path: ':postId', element: <S C={BoardPostPage} /> },
        ],
      },
      { path: 'onboarding', element: <S C={PortalOnboarding} /> },
      { path: 'project-settings', element: <S C={PortalProjectSettings} /> },
      { path: 'submissions', element: <S C={PortalSubmissionsPage} /> },
      { path: 'payroll', element: <S C={PortalPayrollPage} /> },
      { path: 'cashflow', element: <S C={PortalCashflowPage} /> },
      { path: 'budget', element: <S C={PortalBudget} /> },
      { path: 'expenses', element: <S C={PortalExpenses} /> },
      { path: 'weekly-expenses', element: <S C={PortalWeeklyExpensePage} /> },
      { path: 'personnel', element: <S C={PortalPersonnel} /> },
      { path: 'change-requests', element: <S C={PortalChangeRequests} /> },
      { path: 'register-project', element: <S C={PortalProjectRegister} /> },
      { path: 'training', element: <S C={PortalTrainingPage} /> },
      { path: 'career-profile', element: <S C={CareerProfilePage} /> },
      { path: 'guide-chat', element: <S C={GuideChatPage} /> },
    ],
  },
]);
