import { Navigate, useLocation } from 'react-router';

export function ProjectRegisterRedirectPage() {
  const location = useLocation();
  return <Navigate to={`/portal/register-project${location.search}`} replace />;
}

export default ProjectRegisterRedirectPage;
