import type { BudgetCodeEntry } from '../data/types';

export function moveBudgetSubCodeToIndex(
  entries: BudgetCodeEntry[],
  codeIndex: number,
  fromIndex: number,
  toIndex: number,
): BudgetCodeEntry[] {
  const entry = entries[codeIndex];
  if (!entry) return entries;
  if (fromIndex === toIndex) return entries;
  if (fromIndex < 0 || fromIndex >= entry.subCodes.length) return entries;
  if (toIndex < 0 || toIndex >= entry.subCodes.length) return entries;

  const next = entries.map((item, index) => (
    index === codeIndex
      ? { ...item, subCodes: [...item.subCodes] }
      : item
  ));
  const subCodes = next[codeIndex].subCodes;
  const [moved] = subCodes.splice(fromIndex, 1);
  subCodes.splice(toIndex, 0, moved);
  return next;
}

export function moveBudgetSubCode(
  entries: BudgetCodeEntry[],
  codeIndex: number,
  subIndex: number,
  direction: 'up' | 'down',
): BudgetCodeEntry[] {
  const entry = entries[codeIndex];
  if (!entry) return entries;

  const targetIndex = direction === 'up' ? subIndex - 1 : subIndex + 1;
  return moveBudgetSubCodeToIndex(entries, codeIndex, subIndex, targetIndex);
}
