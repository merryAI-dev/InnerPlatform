import { Link, useLocation } from 'react-router';

export function ProjectRegisterRedirectPage() {
  const location = useLocation();
  const target = `/portal/register-project${location.search}`;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-950">프로젝트 등록 요청 화면으로 이동합니다</p>
        <p className="mt-2 text-xs leading-5 text-slate-600">
          자동 이동은 사용하지 않습니다. 아래 버튼을 눌러 등록 요청 화면을 여세요.
        </p>
        <Link
          className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-[#001e46] px-4 text-sm font-semibold text-white"
          to={target}
        >
          프로젝트 등록 요청 열기
        </Link>
      </div>
    </div>
  );
}

export default ProjectRegisterRedirectPage;
