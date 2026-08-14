import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { ProjectMigrationAuditPage } from '../projects/ProjectMigrationAuditPage';
import { useAppStore } from '../../data/store';

export function AdminApprovalPage() {
  const { projects } = useAppStore();
  const pendingProjectReviews = useMemo(
    () => projects.filter((project) => (
      (project.executiveReviewStatus || 'PENDING') === 'PENDING'
    )),
    [projects],
  );
  const totalPending = pendingProjectReviews.length;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CheckCircle2}
        iconGradient="linear-gradient(135deg, #0f766e, #14b8a6)"
        title="프로젝트 등록/승인"
        description="프로젝트 등록·수정 요청을 설정된 조직장이 확인하고 승인하거나 반려합니다"
        badge={`대기 ${totalPending}건`}
      />

      <ProjectMigrationAuditPage embedded reviewScope="pending" />
    </div>
  );
}
