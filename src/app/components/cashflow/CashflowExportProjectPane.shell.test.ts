import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'CashflowExportProjectPane.tsx'), 'utf8');

describe('CashflowExportProjectPane', () => {
  it('reuses the established project sheet only while the panel is mounted', () => {
    expect(source).toContain('<CashflowWeekProvider');
    expect(source).toContain('<CashflowProjectSheet');
    expect(source).toContain('setYearMonth(yearMonth)');
    expect(source).toContain("querySelector('#projection-actual-comparison')");
  });

  it('is an independently scrollable, keyboard-dismissible project detail region', () => {
    expect(source).toContain('cashflow-export-project-pane');
    expect(source).toContain("event.key !== 'Escape'");
    expect(source).toContain('[role="dialog"][data-state="open"]');
    expect(source).toContain("window.matchMedia('(max-width: 1023px)')");
    expect(source).toContain('tabIndex={0}');
    expect(source).toContain('fixed inset-0');
    expect(source).toContain('sticky top-4');
    expect(source).toContain('createPortal(pane, document.body)');
  });
});
