import { useParams, useSearchParams } from 'react-router';
import { ProjectWizard } from './ProjectWizard';
import { useAppStore } from '../../data/store';
import type { ProjectPhase } from '../../data/types';

export function ProjectWizardPage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const { getProjectById } = useAppStore();

  const editProject = projectId ? getProjectById(projectId) : undefined;
  const initialPhase = (searchParams.get('phase') as ProjectPhase) || 'PROSPECT';

  return <ProjectWizard editProject={editProject} initialPhase={initialPhase} />;
}
