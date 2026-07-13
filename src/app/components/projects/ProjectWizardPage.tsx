import { Navigate, useParams } from 'react-router';

export function ProjectWizardPage() {
  const { projectId } = useParams();
  if (!projectId) return <Navigate to="/portal/project-select" replace />;
  return <Navigate to={`/portal/edit-project/${encodeURIComponent(projectId)}`} replace />;
}
