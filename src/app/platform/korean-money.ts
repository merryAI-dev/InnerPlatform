export function formatKoreanWonCompact(value: number): string {
  if (!Number.isFinite(value)) return '-';

  const rounded = Math.round(value);
  const absolute = Math.abs(rounded);
  const eok = Math.floor(absolute / 100_000_000);
  const man = Math.floor((absolute % 100_000_000) / 10_000);
  const won = absolute % 10_000;
  const parts = [
    eok ? `${eok.toLocaleString('ko-KR')}억` : '',
    man ? `${man.toLocaleString('ko-KR')}만` : '',
    won || (!eok && !man) ? won.toLocaleString('ko-KR') : '',
  ].filter(Boolean);

  return `${rounded < 0 ? '-' : ''}${parts.join(' ')}`;
}
