import { shouldUseBusinessCardMobileEntry } from '../../platform/mobile-entry';
import { BusinessCardLabPage } from '../business-cards/BusinessCardLabPage';

export function MobileEntryPage() {
  const useBusinessCardEntry = shouldUseBusinessCardMobileEntry({
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
    requestedPath: typeof window !== 'undefined' ? window.location.pathname : '/mobile-entry',
  });

  if (useBusinessCardEntry) {
    return <BusinessCardLabPage />;
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 text-center">
      <div className="max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-950">모바일 명함 DB 진입 화면입니다</p>
        <p className="mt-2 text-xs leading-5 text-slate-600">
          데스크톱에서는 좌측 상단 로고 또는 메뉴를 통해 필요한 화면으로 이동해 주세요.
        </p>
        <a className="mt-4 inline-flex text-sm font-semibold text-[#001e46]" href="/">
          홈으로 이동
        </a>
      </div>
    </div>
  );
}
