import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PHASE1_PORTAL_VALIDATION_STEPS,
  formatPhase1PortalValidationSummary,
  runPhase1PortalValidationGate,
} from '../../../scripts/phase1_portal_validation_gate';

describe('phase1 portal validation gate', () => {
  it('runs steps sequentially, captures metrics, and writes the JSON payload', async () => {
    const seenCommands: string[] = [];
    const writes: Array<{ filePath: string; payload: unknown }> = [];

    const result = await runPhase1PortalValidationGate({
      steps: PHASE1_PORTAL_VALIDATION_STEPS.slice(0, 3),
      runCommand: async (command) => {
        seenCommands.push(command);
        const index = seenCommands.length;
        return {
          exitCode: index === 2 ? 1 : 0,
          durationMs: index * 10,
        };
      },
      now: () => new Date('2026-04-16T09:10:11.000Z'),
      writeJson: async (filePath, payload) => {
        writes.push({ filePath, payload });
      },
      jsonOutPath: '/tmp/phase1-portal-validation-gate.json',
    });

    expect(seenCommands).toEqual(PHASE1_PORTAL_VALIDATION_STEPS.slice(0, 3).map((step) => step.command));
    expect(result.steps).toEqual([
      {
        name: PHASE1_PORTAL_VALIDATION_STEPS[0].name,
        command: PHASE1_PORTAL_VALIDATION_STEPS[0].command,
        exitCode: 0,
        durationMs: 10,
        passed: true,
      },
      {
        name: PHASE1_PORTAL_VALIDATION_STEPS[1].name,
        command: PHASE1_PORTAL_VALIDATION_STEPS[1].command,
        exitCode: 1,
        durationMs: 20,
        passed: false,
      },
      {
        name: PHASE1_PORTAL_VALIDATION_STEPS[2].name,
        command: PHASE1_PORTAL_VALIDATION_STEPS[2].command,
        exitCode: 0,
        durationMs: 30,
        passed: true,
      },
    ]);
    expect(result.summary).toEqual({
      suiteCount: 3,
      passedCount: 2,
      failedCount: 1,
      totalDurationMs: 60,
      generatedAt: '2026-04-16T09:10:11.000Z',
    });
    expect(writes).toEqual([
      {
        filePath: '/tmp/phase1-portal-validation-gate.json',
        payload: {
          steps: result.steps,
          summary: result.summary,
        },
      },
    ]);
    expect(formatPhase1PortalValidationSummary(result)).toContain('phase1 portal validation gate: 2/3 passed');
    expect(formatPhase1PortalValidationSummary(result)).toContain('failed=1');
  });

  it('serializes JSON payloads to disk when requested', async () => {
    const jsonPath = path.join(process.cwd(), 'tmp-phase1-portal-validation-gate.json');

    await runPhase1PortalValidationGate({
      steps: PHASE1_PORTAL_VALIDATION_STEPS.slice(0, 1),
      runCommand: async () => ({ exitCode: 0, durationMs: 7 }),
      now: () => new Date('2026-04-16T09:10:11.000Z'),
      jsonOutPath: jsonPath,
    });

    const written = JSON.parse(await fs.readFile(jsonPath, 'utf-8')) as {
      summary: { suiteCount: number; passedCount: number; failedCount: number; totalDurationMs: number; generatedAt: string };
      steps: Array<{ name: string; command: string; exitCode: number; durationMs: number; passed: boolean }>;
    };

    expect(written.summary).toEqual({
      suiteCount: 1,
      passedCount: 1,
      failedCount: 0,
      totalDurationMs: 7,
      generatedAt: '2026-04-16T09:10:11.000Z',
    });
    expect(written.steps).toEqual([
      {
        name: PHASE1_PORTAL_VALIDATION_STEPS[0].name,
        command: PHASE1_PORTAL_VALIDATION_STEPS[0].command,
        exitCode: 0,
        durationMs: 7,
        passed: true,
      },
    ]);

    await fs.unlink(jsonPath);
  });
});
