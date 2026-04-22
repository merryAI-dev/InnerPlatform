import type {
  BudgetCodeEntry,
  BudgetPlanRow,
  BudgetTreeCode,
  BudgetTreeLeafItem,
  BudgetTreeSubItem,
} from '../data/types';
import { buildBudgetLabelKey, normalizeBudgetLabel } from './budget-labels';

function normalizeBudgetAmount(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeBudgetNote(value: unknown): string {
  return String(value ?? '').trim();
}

export function cloneBudgetTreeCodes(codes: BudgetTreeCode[] | null | undefined): BudgetTreeCode[] {
  return (codes || []).map((code) => ({
    code: code.code,
    subItems: (code.subItems || []).map((subItem) => ({
      subCode: subItem.subCode,
      ...(typeof subItem.initialBudget === 'number' ? { initialBudget: subItem.initialBudget } : {}),
      ...(typeof subItem.revisedBudget === 'number' ? { revisedBudget: subItem.revisedBudget } : {}),
      ...(subItem.note ? { note: subItem.note } : {}),
      leafItems: (subItem.leafItems || []).map((leaf) => ({
        ...(leaf.subSubCode ? { subSubCode: leaf.subSubCode } : {}),
        initialBudget: leaf.initialBudget,
        ...(typeof leaf.revisedBudget === 'number' ? { revisedBudget: leaf.revisedBudget } : {}),
        ...(leaf.note ? { note: leaf.note } : {}),
      })),
    })),
  }));
}

function normalizeBudgetTreeLeafItem(leaf: BudgetTreeLeafItem | null | undefined): BudgetTreeLeafItem {
  const subSubCode = normalizeBudgetLabel(leaf?.subSubCode);
  const note = normalizeBudgetNote(leaf?.note);
  const revisedBudget = normalizeBudgetAmount(leaf?.revisedBudget);
  return {
    ...(subSubCode ? { subSubCode } : {}),
    initialBudget: normalizeBudgetAmount(leaf?.initialBudget),
    ...(revisedBudget > 0 ? { revisedBudget } : {}),
    ...(note ? { note } : {}),
  };
}

function normalizeBudgetTreeSubItem(subItem: BudgetTreeSubItem | null | undefined): BudgetTreeSubItem | null {
  const subCode = normalizeBudgetLabel(subItem?.subCode);
  if (!subCode) return null;
  const normalizedLeaves = (subItem?.leafItems || []).map(normalizeBudgetTreeLeafItem);
  const hasSplitLeaves = normalizedLeaves.some((leaf) => normalizeBudgetLabel(leaf.subSubCode));
  const fallbackLeaf = normalizedLeaves[0];
  const inferredInitialBudget = hasSplitLeaves
    ? normalizedLeaves.reduce((sum, leaf) => sum + normalizeBudgetAmount(leaf.initialBudget), 0)
    : normalizeBudgetAmount(fallbackLeaf?.initialBudget);
  const inferredRevisedBudget = hasSplitLeaves
    ? normalizedLeaves.reduce((sum, leaf) => sum + normalizeBudgetAmount(leaf.revisedBudget), 0)
    : normalizeBudgetAmount(fallbackLeaf?.revisedBudget);
  const initialBudget = hasSplitLeaves
    ? (subItem?.initialBudget == null ? inferredInitialBudget : normalizeBudgetAmount(subItem.initialBudget))
    : inferredInitialBudget;
  const revisedBudget = hasSplitLeaves
    ? (subItem?.revisedBudget == null ? inferredRevisedBudget : normalizeBudgetAmount(subItem.revisedBudget))
    : inferredRevisedBudget;
  const note = hasSplitLeaves
    ? normalizeBudgetNote(subItem?.note)
    : normalizeBudgetNote(fallbackLeaf?.note);
  return {
    subCode,
    ...(initialBudget > 0 ? { initialBudget } : {}),
    ...(revisedBudget > 0 ? { revisedBudget } : {}),
    ...(note ? { note } : {}),
    leafItems: normalizedLeaves,
  };
}

function normalizeBudgetTreeCode(code: BudgetTreeCode | null | undefined): BudgetTreeCode | null {
  const normalizedCode = normalizeBudgetLabel(code?.code);
  if (!normalizedCode) return null;
  const normalizedSubItems = (code?.subItems || [])
    .map(normalizeBudgetTreeSubItem)
    .filter((value): value is BudgetTreeSubItem => value !== null);
  return normalizedSubItems.length > 0
    ? {
        code: normalizedCode,
        subItems: normalizedSubItems,
      }
    : null;
}

export function normalizeBudgetTreeCodes(codes: BudgetTreeCode[] | null | undefined): BudgetTreeCode[] {
  return (codes || [])
    .map(normalizeBudgetTreeCode)
    .filter((value): value is BudgetTreeCode => value !== null);
}

export function budgetTreeHasSubSubCodes(codes: BudgetTreeCode[] | null | undefined): boolean {
  return normalizeBudgetTreeCodes(codes).some((code) => code.subItems.some((subItem) => (
    (subItem.leafItems || []).some((leaf) => normalizeBudgetLabel(leaf.subSubCode))
  )));
}

export function buildBudgetTreeFromLegacySnapshots(
  codeBook: BudgetCodeEntry[] | null | undefined,
  planRows: BudgetPlanRow[] | null | undefined,
): BudgetTreeCode[] {
  const planMap = new Map<string, BudgetPlanRow>();
  (planRows || []).forEach((row) => {
    planMap.set(buildBudgetLabelKey(row.budgetCode, row.subCode), row);
  });

  return normalizeBudgetTreeCodes(
    (codeBook || []).map((entry) => ({
      code: entry.code,
      subItems: (entry.subCodes || []).map((subCode) => {
        const plan = planMap.get(buildBudgetLabelKey(entry.code, subCode));
        return {
          subCode,
          initialBudget: plan?.initialBudget ?? 0,
          revisedBudget: plan?.revisedBudget ?? 0,
          ...(plan?.note ? { note: plan.note } : {}),
          leafItems: [{
            initialBudget: plan?.initialBudget ?? 0,
            revisedBudget: plan?.revisedBudget ?? 0,
            note: plan?.note ?? '',
          }],
        };
      }),
    })),
  );
}

export function buildLegacyBudgetSnapshotsFromTree(codes: BudgetTreeCode[] | null | undefined): {
  codeBook: BudgetCodeEntry[];
  rows: BudgetPlanRow[];
} {
  const normalized = normalizeBudgetTreeCodes(codes);
  const codeBook: BudgetCodeEntry[] = [];
  const rows: BudgetPlanRow[] = [];

  normalized.forEach((code) => {
    const subCodes: string[] = [];
    code.subItems.forEach((subItem) => {
      subCodes.push(subItem.subCode);
      const splitLeaves = subItem.leafItems.filter((leaf) => normalizeBudgetLabel(leaf.subSubCode));
      if (splitLeaves.length > 0) return;
      const baseLeaf = subItem.leafItems[0] || { initialBudget: 0 };
      rows.push({
        budgetCode: code.code,
        subCode: subItem.subCode,
        initialBudget: normalizeBudgetAmount(subItem.initialBudget ?? baseLeaf.initialBudget),
        revisedBudget: normalizeBudgetAmount(subItem.revisedBudget ?? baseLeaf.revisedBudget),
        ...(normalizeBudgetNote(subItem.note ?? baseLeaf.note) ? { note: normalizeBudgetNote(subItem.note ?? baseLeaf.note) } : {}),
      });
    });
    if (subCodes.length > 0) {
      codeBook.push({ code: code.code, subCodes });
    }
  });

  return { codeBook, rows };
}

export function findBudgetTreeSubItem(
  codes: BudgetTreeCode[] | null | undefined,
  budgetCode: string,
  subCode: string,
): BudgetTreeSubItem | null {
  const normalizedBudgetCode = normalizeBudgetLabel(budgetCode);
  const normalizedSubCode = normalizeBudgetLabel(subCode);
  for (const code of codes || []) {
    if (normalizeBudgetLabel(code.code) !== normalizedBudgetCode) continue;
    for (const subItem of code.subItems || []) {
      if (normalizeBudgetLabel(subItem.subCode) === normalizedSubCode) return subItem;
    }
  }
  return null;
}
