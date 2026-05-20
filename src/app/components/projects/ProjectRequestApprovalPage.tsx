import { ProjectMigrationAuditPage } from './ProjectMigrationAuditPage';

interface ProjectRequestApprovalSectionProps {
  compact?: boolean;
}

export function ProjectRequestApprovalSection({ compact = false }: ProjectRequestApprovalSectionProps) {
  return (
    <section className={compact ? 'space-y-4' : 'space-y-5'}>
      <ProjectMigrationAuditPage embedded={compact} />
    </section>
  );
}

export function ProjectRequestApprovalPage() {
  return <ProjectMigrationAuditPage />;
}

export default ProjectRequestApprovalPage;
