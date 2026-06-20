import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectionGateSource = readFileSync(
  resolve(import.meta.dirname, 'ProjectionGate.tsx'),
  'utf8',
);

describe('ProjectionGate projection completion detection', () => {
  it('treats persisted zero projection cells as existing projection input', () => {
    expect(projectionGateSource).toContain('function hasProjectionData');
    expect(projectionGateSource).toContain('Object.keys(sheet.projection).length > 0');
    expect(projectionGateSource).not.toContain('Object.values(sheet.projection).some((v) => typeof v === \'number\' && v !== 0)');
  });
});
