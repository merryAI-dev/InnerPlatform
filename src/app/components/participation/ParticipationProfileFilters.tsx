import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import type { ParticipationDashboardSnapshot } from '../../lib/platform-bff-client';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

type ProfileFilterOptions = NonNullable<ParticipationDashboardSnapshot['profileFilterOptions']>;
const MAX_CERTIFICATION_FILTERS = 20;

export function ParticipationProfileFilters({
  options,
  education,
  englishEvidence,
  certifications,
  onEducationChange,
  onEnglishEvidenceChange,
  onCertificationToggle,
  onClear,
}: {
  options: ProfileFilterOptions;
  education: string | null;
  englishEvidence: string | null;
  certifications: string[];
  onEducationChange: (value: string | null) => void;
  onEnglishEvidenceChange: (value: string | null) => void;
  onCertificationToggle: (value: string) => void;
  onClear: () => void;
}) {
  const atCertificationLimit = certifications.length >= MAX_CERTIFICATION_FILTERS;
  const toggleCertification = (value: string) => {
    const selected = certifications.includes(value);
    if (!selected && value !== '__MISSING__' && atCertificationLimit) return;
    onCertificationToggle(value);
  };
  const active = Boolean(education || englishEvidence || certifications.length);

  return (
    <div className={`flex flex-wrap items-end gap-2 border-b px-4 py-3 ${active ? 'border-sky-200 bg-sky-50/40' : 'border-slate-200 bg-white'}`} aria-label="전문 프로필 필터">
      <div className={`mr-1 flex h-8 items-center gap-1.5 text-xs font-semibold ${active ? 'text-sky-800' : 'text-slate-700'}`}>
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        데이터 필터
      </div>
      <label className="grid gap-1 text-[11px] font-medium text-slate-500">
        <span>최종학력</span>
        <select
          aria-label="최종학력 필터"
          value={education || ''}
          onChange={(event) => onEducationChange(event.target.value || null)}
          className={`h-8 min-w-[150px] rounded-md border px-2 text-xs ${education ? 'border-sky-300 bg-sky-50 font-medium text-sky-900 shadow-sm' : 'border-slate-300 bg-white text-slate-800'}`}
        >
          <option value="">전체</option>
          {options.education.map((option) => (
            <option key={option.value} value={option.value}>{option.label} · {option.memberCount}명</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-[11px] font-medium text-slate-500">
        <span>영어</span>
        <select
          aria-label="영어 필터"
          value={englishEvidence || ''}
          onChange={(event) => onEnglishEvidenceChange(event.target.value || null)}
          className={`h-8 min-w-[140px] rounded-md border px-2 text-xs ${englishEvidence ? 'border-sky-300 bg-sky-50 font-medium text-sky-900 shadow-sm' : 'border-slate-300 bg-white text-slate-800'}`}
        >
          <option value="">전체</option>
          {options.englishEvidence.map((option) => (
            <option key={option.value} value={option.value}>{option.label} · {option.memberCount}명</option>
          ))}
        </select>
      </label>
      <div className="grid gap-1 text-[11px] font-medium text-slate-500">
        <span>자격증</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={`h-8 min-w-[150px] justify-between px-2 text-xs ${certifications.length ? 'border-sky-300 bg-sky-50 font-medium text-sky-900 shadow-sm hover:bg-sky-100' : 'border-slate-300 bg-white font-normal text-slate-800'}`}
              aria-label="자격증 필터"
            >
              <span>{certifications.length ? `${certifications.length}개 선택` : '전체'}</span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <p className="px-2 pb-1 text-[11px] text-slate-500" aria-live="polite">
              <span>{certifications.length}/{MAX_CERTIFICATION_FILTERS}개 선택</span> · <span>최대 {MAX_CERTIFICATION_FILTERS}개</span>
            </p>
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {options.certifications.map((option) => {
                const isSelected = certifications.includes(option.value);
                const isCertificationDisabled = !isSelected
                  && option.value !== '__MISSING__'
                  && atCertificationLimit;
                return (
                <label key={option.value} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${isCertificationDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-100'}`}>
                  <Checkbox
                    checked={isSelected}
                    disabled={isCertificationDisabled}
                    onCheckedChange={() => toggleCertification(option.value)}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="tabular-nums text-slate-400">{option.memberCount}명</span>
                </label>
              );})}
              {options.certifications.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-slate-500">등록된 자격증이 없습니다.</p>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {active ? (
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 bg-white/80 px-2 text-xs text-sky-800 hover:bg-white hover:text-sky-900" onClick={onClear}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />초기화
        </Button>
      ) : null}
    </div>
  );
}
