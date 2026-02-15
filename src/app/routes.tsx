import { createBrowserRouter } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { ProjectListPage } from './components/projects/ProjectListPage';
import { ProjectDetailPage } from './components/projects/ProjectDetailPage';
import { ProjectWizardPage } from './components/projects/ProjectWizardPage';
import { LedgerDetailPage } from './components/ledgers/LedgerDetailPage';
import { CashflowPage } from './components/cashflow/CashflowPage';
import { EvidenceQueuePage } from './components/evidence/EvidenceQueuePage';
import { AuditLogPage } from './components/audit/AuditLogPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { ParticipationPage } from './components/participation/ParticipationPage';
import { KoicaPersonnelPage } from './components/koica/KoicaPersonnelPage';
import { PersonnelChangePage } from './components/koica/PersonnelChangePage';
import { BudgetSummaryPage } from './components/budget/BudgetSummaryPage';
import { ExpenseManagementPage } from './components/expense/ExpenseManagementPage';
import { AdminApprovalPage } from './components/approval/AdminApprovalPage';
import { UserManagementPage } from './components/users/UserManagementPage';
import { AdminHrAnnouncementPage } from './components/hr/AdminHrAnnouncementPage';
import { NotFoundPage } from './components/layout/NotFoundPage';
// Portal (사용자 전용)
import { PortalLayout } from './components/portal/PortalLayout';
import { PortalOnboarding } from './components/portal/PortalOnboarding';
import { PortalDashboard } from './components/portal/PortalDashboard';
import { PortalExpenses } from './components/portal/PortalExpenses';
import { PortalBudget } from './components/portal/PortalBudget';
import { PortalPersonnel } from './components/portal/PortalPersonnel';
import { PortalChangeRequests } from './components/portal/PortalChangeRequests';
import { PortalProjectRegister } from './components/portal/PortalProjectRegister';
import { PortalSubmissions } from './components/portal/PortalSubmissions';
import { LoginPage } from './components/auth/LoginPage';

export const router = createBrowserRouter([
  // ── Login ──
  { path: '/login', Component: LoginPage },
  // ── Admin (관리자) ──
  {
    path: '/',
    Component: AppLayout,
    children: [
      { index: true, Component: DashboardPage },
      { path: 'projects', Component: ProjectListPage },
      { path: 'projects/new', Component: ProjectWizardPage },
      { path: 'projects/:projectId', Component: ProjectDetailPage },
      { path: 'projects/:projectId/edit', Component: ProjectWizardPage },
      { path: 'projects/:projectId/ledgers/:ledgerId', Component: LedgerDetailPage },
      { path: 'cashflow', Component: CashflowPage },
      { path: 'evidence', Component: EvidenceQueuePage },
      { path: 'participation', Component: ParticipationPage },
      { path: 'koica-personnel', Component: KoicaPersonnelPage },
      { path: 'personnel-changes', Component: PersonnelChangePage },
      { path: 'budget-summary', Component: BudgetSummaryPage },
      { path: 'expense-management', Component: ExpenseManagementPage },
      { path: 'approvals', Component: AdminApprovalPage },
      { path: 'users', Component: UserManagementPage },
      { path: 'hr-announcements', Component: AdminHrAnnouncementPage },
      { path: 'audit', Component: AuditLogPage },
      { path: 'settings', Component: SettingsPage },
      { path: '*', Component: NotFoundPage },
    ],
  },
  // ── Portal (사용자/PM 전용) ──
  {
    path: '/portal',
    Component: PortalLayout,
    children: [
      { index: true, Component: PortalDashboard },
      { path: 'onboarding', Component: PortalOnboarding },
      { path: 'budget', Component: PortalBudget },
      { path: 'expenses', Component: PortalExpenses },
      { path: 'submissions', Component: PortalSubmissions },
      { path: 'personnel', Component: PortalPersonnel },
      { path: 'change-requests', Component: PortalChangeRequests },
      { path: 'register-project', Component: PortalProjectRegister },
    ],
  },
]);
