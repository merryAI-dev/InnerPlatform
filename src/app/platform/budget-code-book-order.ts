import type { BudgetCodeEntry } from '../data/types';

export function moveBudgetSubCode(
  entries: BudgetCodeEntry[],
  codeIndex: number,
  subIndex: number,
  direction: 'up' | 'down',
): BudgetCodeEntry[] {
  const entry = entries[codeIndex];
  if (!entry) return entries;

  const targetIndex = direction === 'up' ? subIndex - 1 : subIndex + 1;
  if (targetIndex < 0 || targetIndex >= entry.subCodes.length) return entries;

  const next = entries.map((item, index) => (
    index === codeIndex
      ? { ...item, subCodes: [...item.subCodes] }
      : item
  ));
  const subCodes = next[codeIndex].subCodes;
  [subCodes[subIndex], subCodes[targetIndex]] = [subCodes[targetIndex], subCodes[subIndex]];
  return next;
}
