import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { PortalEntryLayout } from './components/portal/PortalEntryLayout';
import { PortalLayout } from './components/portal/PortalLayout';
import { AdminRouteProviders } from './data/admin-route-providers';
import { PortalRouteProviders } from './data/portal-route-providers';
import { loadLazyRouteModule } from './platform/lazy-route';

// Lazy-loaded pages — each becomes a separate chunk
const LoginPage = lazy(() => import('./components/auth/LoginPage').then(m => ({ default: m.LoginPage })));
const WorkspaceSelectPage = lazy(() => import('./components/auth/WorkspaceSelectPage').then(m => ({ default: m.WorkspaceSelectPage })));
const DashboardPage = lazy(() => import('./components/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const BoardFeedPage = lazy(() => import('./components/board/BoardFeedPage').then(m => ({ default: m.BoardFeedPage })));
const BoardPostPage = lazy(() => import('./components/board/BoardPostPage').then(m => ({ default: m.BoardPostPage })));
const ProjectListPage = lazy(() => import('./components/projects/ProjectListPage').then(m => ({ default: m.ProjectListPage })));
const ProjectMigrationAuditPage = lazy(() => import('./components/projects/ProjectMigrationAuditPage').then(m => ({ default: m.ProjectMigrationAuditPage })));
const ProjectDetailPage = lazy(() => import('./components/projects/ProjectDetailPage').then(m => ({ default: m.ProjectDetailPage })));
const ProjectWizardPage = lazy(() => import('./components/projects/ProjectWizardPage').then(m => ({ default: m.ProjectWizardPage })));
const ProjectRegisterRedirectPage = lazy(() => import('./components/projects/ProjectRegisterRedirectPage').then(m => ({ default: m.ProjectRegisterRedirectPage })));
const LedgerDetailPage = lazy(() => import('./components/ledgers/LedgerDetailPage').then(m => ({ default: m.LedgerDetailPage })));
const CashflowPage = lazy(() => import('./components/cashflow/CashflowPage').then(m => ({ default: m.CashflowPage })));
const CashflowWeeklyPage = lazy(() => import('./components/cashflow/CashflowWeeklyPage').then(m => ({ default: m.CashflowWeeklyPage })));
const CashflowAnalyticsPage = lazy(() => import('./components/cashflow/CashflowAnalyticsPage').then(m => ({ default: m.CashflowAnalyticsPage })));
const CashflowExportPage = lazy(() => import('./components/cashflow/CashflowExportPage').then(m => ({ default: m.CashflowExportPage })));
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
const PortalProjectSelectPage = lazy(() => import('./components/portal/PortalProjectSelectPage').then(m => ({ default: m.PortalProjectSelectPage })));
const PortalProjectSettings = lazy(() => import('./components/portal/PortalProjectSettings').then(m => ({ default: m.PortalProjectSettings })));
const PortalDashboard = lazy(() => import('./components/portal/PortalDashboard').then(m => ({ default: m.PortalDashboard })));
const PortalBudget = lazy(() => import('./components/portal/PortalBudget').then(m => ({ default: m.PortalBudget })));
const PortalPersonnel = lazy(() => import('./components/portal/PortalPersonnel').then(m => ({ default: m.PortalPersonnel })));
const PortalChangeRequests = lazy(() => import('./components/portal/PortalChangeRequests').then(m => ({ default: m.PortalChangeRequests })));
const PortalProjectRegister = lazy(() => import('./components/portal/PortalProjectRegister').then(m => ({ default: m.PortalProjectRegister })));
const PortalProjectEdit = lazy(() => import('./components/portal/PortalProjectEdit').then(m => ({ default: m.PortalProjectEdit })));
const PortalPayrollPage = lazy(() => import('./components/portal/PortalPayrollPage').then(m => ({ default: m.PortalPayrollPage })));
const PortalCashflowPage = lazy(() => import('./components/portal/PortalCashflowPage').then(m => ({ default: m.PortalCashflowPage })));
const CareerProfilePage = lazy(() => import('./components/portal/CareerProfilePage').then(m => ({ default: m.CareerProfilePage })));
const PortalTrainingPage = lazy(() => import('./components/portal/PortalTrainingPage').then(m => ({ default: m.PortalTrainingPage })));
function RouteChunkFallback() {
  return (
    <div className="flex min-h-[240px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
      페이지를 다시 불러오고 있습니다. 새로고침하거나 홈으로 이동한 뒤 다시 시도해 주세요.
    </div>
  );
}

const PortalWeeklyExpensePage = lazy(() => loadLazyRouteModule(
  () => import('./components/portal/PortalWeeklyExpensePage'),
  'PortalWeeklyExpensePage',
  RouteChunkFallback,
  '[routes] failed to load PortalWeeklyExpensePage:',
));
const PortalBankStatementPage = lazy(() => import('./components/portal/PortalBankStatementPage').then(m => ({ default: m.PortalBankStatementPage })));
const GuideChatPage = lazy(() => import('./components/guide-chat/GuideChatPage').then(m => ({ default: m.GuideChatPage })));

// Suspense wrapper — layouts already provide visual chrome, so a minimal fallback suffices
function S({ C }: { C: ComponentType }) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-40 text-sm text-muted-foreground">로딩 중…</div>}>
      <C />
    </Suspense>
  );
}

function AdminRouteShell() {
  return <AdminRouteProviders><AppLayout /></AdminRouteProviders>;
}

function PortalRouteShell() {
  return <PortalRouteProviders><PortalLayout /></PortalRouteProviders>;
}

function PortalEntryRouteShell() {
  return <PortalEntryLayout />;
}

export const router = createBrowserRouter([
  // ── Login ──
  { path: '/login', element: <S C={LoginPage} /> },
  { path: '/workspace-select', element: <S C={WorkspaceSelectPage} /> },
  // ── Admin (관리자) ──
  {
    path: '/',
    element: <AdminRouteShell />,
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
      { path: 'projects/migration-audit', element: <S C={ProjectMigrationAuditPage} /> },
      { path: 'projects/new', element: <S C={ProjectRegisterRedirectPage} /> },
      { path: 'projects/:projectId', element: <S C={ProjectDetailPage} /> },
      { path: 'projects/:projectId/edit', element: <S C={ProjectWizardPage} /> },
      { path: 'projects/:projectId/ledgers/:ledgerId', element: <S C={LedgerDetailPage} /> },
      { path: 'cashflow', element: <S C={CashflowPage} /> },
      { path: 'cashflow/weekly', element: <S C={CashflowWeeklyPage} /> },
      { path: 'cashflow/analytics', element: <S C={CashflowAnalyticsPage} /> },
      { path: 'cashflow/export', element: <S C={CashflowExportPage} /> },
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
  {
    path: '/portal',
    element: <PortalEntryRouteShell />,
    children: [
      { path: 'project-select', element: <S C={PortalProjectSelectPage} /> },
    ],
  },
  // ── Portal (사용자/PM 전용) ──
  {
    path: '/portal',
    element: <PortalRouteShell />,
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
      { path: 'submissions', element: <Navigate to="/portal" replace /> },
      { path: 'payroll', element: <S C={PortalPayrollPage} /> },
      { path: 'cashflow', element: <S C={PortalCashflowPage} /> },
      { path: 'budget', element: <S C={PortalBudget} /> },
      { path: 'weekly-expenses', element: <S C={PortalWeeklyExpensePage} /> },
      { path: 'bank-statements', element: <S C={PortalBankStatementPage} /> },
      { path: 'personnel', element: <S C={PortalPersonnel} /> },
      { path: 'change-requests', element: <S C={PortalChangeRequests} /> },
      { path: 'register-project', element: <S C={PortalProjectRegister} /> },
      { path: 'edit-project', element: <S C={PortalProjectEdit} /> },
      { path: 'training', element: <S C={PortalTrainingPage} /> },
      { path: 'career-profile', element: <S C={CareerProfilePage} /> },
      { path: 'guide-chat', element: <S C={GuideChatPage} /> },
    ],
  },
]);
