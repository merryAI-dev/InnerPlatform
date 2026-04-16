import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface Phase1PortalValidationStep {
  name: string;
  command: string;
}

export interface Phase1PortalValidationStepResult extends Phase1PortalValidationStep {
  exitCode: number;
  durationMs: number;
  passed: boolean;
}

export interface Phase1PortalValidationSummary {
  suiteCount: number;
  passedCount: number;
  failedCount: number;
  totalDurationMs: number;
  generatedAt: string;
}

export interface Phase1PortalValidationResult {
  steps: Phase1PortalValidationStepResult[];
  summary: Phase1PortalValidationSummary;
}

export interface Phase1PortalValidationGateOptions {
  steps?: Phase1PortalValidationStep[];
  jsonOutPath?: string;
  runCommand?: (command: string) => Promise<{ exitCode: number; durationMs: number }>;
  writeJson?: (filePath: string, payload: Phase1PortalValidationResult) => Promise<void>;
  now?: () => Date;
  logger?: Pick<Console, 'log'>;
}

const DEFAULT_LOGGER = console;

export const PHASE1_PORTAL_VALIDATION_STEPS: Phase1PortalValidationStep[] = [
  {
    name: 'phase1 unit and contract tests',
    command:
      'npm test -- src/app/platform/dev-harness-portal-api.test.ts src/app/platform/harness-stability.contract.test.ts src/app/components/portal/PortalProjectSelectPage.shell.test.ts src/app/components/portal/PortalOnboarding.shell.test.ts src/app/lib/platform-bff-client.test.ts src/app/components/portal/PortalDashboard.layout.test.ts src/app/platform/check-patch-notes-guard.test.ts',
  },
  {
    name: 'phase1 platform smoke and release gate e2e',
    command:
      'CI=1 npx playwright test tests/e2e/platform-smoke.spec.ts tests/e2e/product-release-gates.spec.ts --config playwright.harness.config.mjs',
  },
  {
    name: 'phase1 production build',
    command: 'npm run build',
  },
];

function parseExitCode(exitCode: number | null, signal: NodeJS.Signals | null): number {
  if (typeof exitCode === 'number') return exitCode;
  return signal ? 1 : 1;
}

async function defaultRunCommand(command: string): Promise<{ exitCode: number; durationMs: number }> {
  const startedAt = process.hrtime.bigint();
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: 'inherit',
      env: process.env,
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('close', (exitCode, signal) => {
      const finishedAt = process.hrtime.bigint();
      resolve({
        exitCode: parseExitCode(exitCode, signal),
        durationMs: Number((finishedAt - startedAt) / 1000000n),
      });
    });
  });
}

function formatDuration(durationMs: number): string {
  return `${durationMs}ms`;
}

export async function runPhase1PortalValidationGate(
  options: Phase1PortalValidationGateOptions = {},
): Promise<Phase1PortalValidationResult> {
  const steps = options.steps || PHASE1_PORTAL_VALIDATION_STEPS;
  const runCommand = options.runCommand || defaultRunCommand;
  const writeJson = options.writeJson || writePhase1PortalValidationJson;
  const now = options.now || (() => new Date());
  const logger = options.logger || DEFAULT_LOGGER;

  const results: Phase1PortalValidationStepResult[] = [];

  for (const step of steps) {
    logger.log(`[phase1] ${step.name}`);
    logger.log(`[phase1] $ ${step.command}`);

    const outcome = await runCommand(step.command);
    const passed = outcome.exitCode === 0;

    results.push({
      ...step,
      exitCode: outcome.exitCode,
      durationMs: outcome.durationMs,
      passed,
    });

    logger.log(
      `[phase1] ${passed ? 'PASS' : 'FAIL'} ${step.name} (exit=${outcome.exitCode}, duration=${formatDuration(outcome.durationMs)})`,
    );
  }

  const summary: Phase1PortalValidationSummary = {
    suiteCount: results.length,
    passedCount: results.filter((step) => step.passed).length,
    failedCount: results.filter((step) => !step.passed).length,
    totalDurationMs: results.reduce((total, step) => total + step.durationMs, 0),
    generatedAt: now().toISOString(),
  };

  const payload: Phase1PortalValidationResult = {
    steps: results,
    summary,
  };

  if (options.jsonOutPath) {
    await writeJson(options.jsonOutPath, payload);
    logger.log(`[phase1] wrote JSON summary to ${options.jsonOutPath}`);
  }

  return payload;
}

export function formatPhase1PortalValidationSummary(result: Phase1PortalValidationResult): string {
  const { summary, steps } = result;
  const stepLines = steps.map(
    (step, index) =>
      `${index + 1}. ${step.passed ? 'PASS' : 'FAIL'} ${step.name} | exit=${step.exitCode} | duration=${formatDuration(step.durationMs)}`,
  );

  return [
    `phase1 portal validation gate: ${summary.passedCount}/${summary.suiteCount} passed, failed=${summary.failedCount}, total=${formatDuration(summary.totalDurationMs)}`,
    ...stepLines,
    `generatedAt=${summary.generatedAt}`,
  ].join('\n');
}

async function writePhase1PortalValidationJson(
  filePath: string,
  payload: Phase1PortalValidationResult,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function readFlag(argv: string[], flag: string): string {
  const withEquals = argv.find((entry) => entry.startsWith(`${flag}=`));
  if (withEquals) {
    return withEquals.slice(flag.length + 1);
  }

  const index = argv.indexOf(flag);
  if (index >= 0) {
    return argv[index + 1] || '';
  }

  return '';
}

export function parsePhase1PortalValidationArgs(argv: string[]): Phase1PortalValidationGateOptions {
  const jsonOutPath = readFlag(argv, '--json-out') || readFlag(argv, '-o');
  return {
    jsonOutPath: jsonOutPath ? path.resolve(jsonOutPath) : undefined,
  };
}

async function main(): Promise<void> {
  const options = parsePhase1PortalValidationArgs(process.argv.slice(2));
  const result = await runPhase1PortalValidationGate(options);
  DEFAULT_LOGGER.log(formatPhase1PortalValidationSummary(result));
  process.exitCode = result.summary.failedCount > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/phase1_portal_validation_gate.ts')) {
  main().catch((error) => {
    DEFAULT_LOGGER.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
