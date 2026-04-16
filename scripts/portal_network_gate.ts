import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn, type SpawnOptions } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PORTAL_STABLE_ROUTE_BUDGETS,
  classifyPortalRouteBudget,
  evaluatePortalRouteBudget,
  type PortalRouteBudget,
  type PortalRouteBudgetEvaluation,
  type PortalRouteBudgetObservedMetrics,
} from '../src/app/platform/portal-network-budgets';

export const DEFAULT_PORTAL_NETWORK_ARTIFACT_ROOT = join(tmpdir(), 'portal-network-artifacts');

export const PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS = Object.keys(
  PORTAL_STABLE_ROUTE_BUDGETS,
) as Array<keyof typeof PORTAL_STABLE_ROUTE_BUDGETS>;

export const PORTAL_NETWORK_GATE_UNIT_CONTRACT_FILES = [
  'src/app/platform/dev-harness-portal-api.test.ts',
  'src/app/platform/harness-stability.contract.test.ts',
  'src/app/components/portal/PortalProjectSelectPage.shell.test.ts',
  'src/app/components/portal/PortalOnboarding.shell.test.ts',
  'src/app/lib/platform-bff-client.test.ts',
  'src/app/components/portal/PortalDashboard.layout.test.ts',
  'src/app/platform/check-patch-notes-guard.test.ts',
  'server/bff/routes/portal-entry.test.mjs',
  'server/bff/routes/portal-read-model.test.mjs',
  'src/app/platform/portal-dashboard-surface.test.ts',
  'src/app/platform/portal-network-budgets.test.ts',
  'src/app/platform/portal-network-gate.test.ts',
] as const;

export const PORTAL_NETWORK_GATE_COMMANDS = {
  unitContract: `npm test -- ${PORTAL_NETWORK_GATE_UNIT_CONTRACT_FILES.join(' ')}`,
  smoke:
    'CI=1 PORTAL_HARNESS_PORT=4273 npx playwright test tests/e2e/platform-smoke.spec.ts tests/e2e/product-release-gates.spec.ts --config playwright.harness.config.mjs',
  build: 'npm run build',
} as const;

export type PortalNetworkGateArtifactInput = {
  routeId: string;
  pathname?: string | null;
  suiteId?: string | null;
  finalUrl?: string | null;
  capturedAt?: string | null;
  sourcePath?: string | null;
  summary?: Partial<PortalRouteBudgetObservedMetrics> | null;
} & Partial<PortalRouteBudgetObservedMetrics>;

export type PortalNetworkGateArtifactRecord = {
  routeId: string;
  pathname: string | null;
  suiteId: string | null;
  finalUrl: string | null;
  capturedAt: string | null;
  sourcePath: string | null;
  observed: PortalRouteBudgetObservedMetrics;
};

export type PortalNetworkGateCommandResult = {
  label: string;
  command: string;
  exitCode: number;
  passed: boolean;
  durationMs: number;
  errorMessage?: string;
};

export type PortalNetworkGateRouteResult = {
  routeId: string;
  pathname: string;
  suiteId: string | null;
  sourcePath: string | null;
  observed: PortalRouteBudgetObservedMetrics;
  budget: PortalRouteBudget;
  evaluation: PortalRouteBudgetEvaluation;
};

export type PortalNetworkGateSkippedArtifact = PortalNetworkGateArtifactRecord & {
  reason: 'unknown-route-budget';
};

export type PortalNetworkGateResult = {
  passed: boolean;
  startedAt: string;
  finishedAt: string;
  artifactDir: string;
  commands: PortalNetworkGateCommandResult[];
  routes: PortalNetworkGateRouteResult[];
  skippedArtifacts: PortalNetworkGateSkippedArtifact[];
  summary: {
    totalArtifacts: number;
    evaluatedCount: number;
    passedCount: number;
    failedCount: number;
    commandFailureCount: number;
    budgetFailureCount: number;
    skippedArtifactCount: number;
    missingArtifactCount: number;
    requiredRouteCount: number;
    coveredRouteCount: number;
    missingRequiredRouteCount: number;
    missingRequiredRouteIds: string[];
  };
};

export type RunPortalNetworkGateOptions = {
  cwd?: string;
  artifactDir?: string;
  artifactRoot?: string;
  unitContractCommand?: string;
  smokeCommand?: string;
  buildCommand?: string;
};

type SpawnedProcessLike = {
  once(event: 'error', listener: (error: Error) => void): SpawnedProcessLike;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): SpawnedProcessLike;
};

type SpawnLike = (command: string, options: SpawnOptions) => SpawnedProcessLike;

function parseExitCode(exitCode: number | null, signal: NodeJS.Signals | null): number {
  if (typeof exitCode === 'number') return exitCode;
  return signal ? 1 : 1;
}

function parseArtifactMetric(
  metricName: keyof PortalRouteBudgetObservedMetrics,
  value: unknown,
  context: { routeId: string; sourcePath: string | null },
): number {
  if (value == null) {
    throw new Error(
      `Missing artifact metric "${metricName}" for route "${context.routeId}" in ${context.sourcePath ?? 'artifact'}`,
    );
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(
      `Invalid artifact metric "${metricName}" for route "${context.routeId}" in ${context.sourcePath ?? 'artifact'}: ${String(value)}`,
    );
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Invalid artifact metric "${metricName}" for route "${context.routeId}" in ${context.sourcePath ?? 'artifact'}: ${String(value)}`,
    );
  }

  return parsed;
}

function toObservedMetrics(
  summary: Partial<PortalRouteBudgetObservedMetrics> | null | undefined,
  context: { routeId: string; sourcePath: string | null },
): PortalRouteBudgetObservedMetrics {
  return {
    consoleErrors: parseArtifactMetric('consoleErrors', summary?.consoleErrors, context),
    firestoreListenRequests: parseArtifactMetric(
      'firestoreListenRequests',
      summary?.firestoreListenRequests,
      context,
    ),
    firestoreWriteRequests: parseArtifactMetric(
      'firestoreWriteRequests',
      summary?.firestoreWriteRequests,
      context,
    ),
    firestoreListen400s: parseArtifactMetric(
      'firestoreListen400s',
      summary?.firestoreListen400s,
      context,
    ),
  };
}

function normalizeArtifact(input: PortalNetworkGateArtifactInput): PortalNetworkGateArtifactRecord {
  const context = {
    routeId: input.routeId,
    sourcePath: input.sourcePath ?? null,
  };

  return {
    routeId: input.routeId,
    pathname: input.pathname ?? null,
    suiteId: input.suiteId ?? null,
    finalUrl: input.finalUrl ?? null,
    capturedAt: input.capturedAt ?? null,
    sourcePath: context.sourcePath,
    observed: toObservedMetrics(input.summary ?? input, context),
  };
}

function isNormalizedPortalNetworkArtifact(
  artifact: PortalNetworkGateArtifactInput | PortalNetworkGateArtifactRecord,
): artifact is PortalNetworkGateArtifactRecord {
  return 'observed' in artifact;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function walkJsonFiles(rootDir: string): string[] {
  try {
    return readdirSync(rootDir, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = join(rootDir, entry.name);
      if (entry.isDirectory()) return walkJsonFiles(entryPath);
      if (entry.isFile() && entry.name.endsWith('.json')) return [entryPath];
      return [];
    });
  } catch {
    return [];
  }
}

export function preparePortalNetworkArtifactDir(options: {
  artifactDir?: string;
  artifactRoot?: string;
} = {}): string {
  if (options.artifactDir) {
    const explicitDir = resolve(options.artifactDir);
    rmSync(explicitDir, { recursive: true, force: true });
    mkdirSync(explicitDir, { recursive: true });
    return explicitDir;
  }

  const artifactRoot = resolve(
    options.artifactRoot ?? process.env.PORTAL_NETWORK_ARTIFACT_DIR ?? DEFAULT_PORTAL_NETWORK_ARTIFACT_ROOT,
  );
  mkdirSync(artifactRoot, { recursive: true });
  return mkdtempSync(join(artifactRoot, 'run-'));
}

export function readPortalNetworkArtifacts(artifactDir: string): PortalNetworkGateArtifactRecord[] {
  return walkJsonFiles(artifactDir)
    .map((filePath) => {
      const payload = readJsonFile<PortalNetworkGateArtifactInput>(filePath);
      return normalizeArtifact({
        ...payload,
        sourcePath: filePath,
      });
    })
    .sort((left, right) => {
      const leftKey = `${left.routeId}:${left.suiteId ?? ''}:${left.sourcePath ?? ''}`;
      const rightKey = `${right.routeId}:${right.suiteId ?? ''}:${right.sourcePath ?? ''}`;
      return leftKey.localeCompare(rightKey);
    });
}

function resolveRouteBudget(artifact: PortalNetworkGateArtifactRecord): PortalRouteBudget | null {
  const directBudget = PORTAL_STABLE_ROUTE_BUDGETS[artifact.routeId as keyof typeof PORTAL_STABLE_ROUTE_BUDGETS];
  if (directBudget) return directBudget;
  if (!artifact.pathname) return null;
  return classifyPortalRouteBudget(artifact.pathname);
}

export function evaluatePortalNetworkGate(input: {
  artifacts: Array<PortalNetworkGateArtifactInput | PortalNetworkGateArtifactRecord>;
  commandResults: PortalNetworkGateCommandResult[];
  artifactDir?: string;
  startedAt?: string;
  finishedAt?: string;
}): PortalNetworkGateResult {
  const normalizedArtifacts = input.artifacts.map((artifact) =>
    isNormalizedPortalNetworkArtifact(artifact) ? artifact : normalizeArtifact(artifact),
  );
  const routes: PortalNetworkGateRouteResult[] = [];
  const skippedArtifacts: PortalNetworkGateSkippedArtifact[] = [];

  for (const artifact of normalizedArtifacts) {
    const budget = resolveRouteBudget(artifact);
    if (!budget) {
      skippedArtifacts.push({
        ...artifact,
        reason: 'unknown-route-budget',
      });
      continue;
    }

    routes.push({
      routeId: budget.routeId,
      pathname: artifact.pathname ?? budget.pathname,
      suiteId: artifact.suiteId,
      sourcePath: artifact.sourcePath,
      observed: artifact.observed,
      budget,
      evaluation: evaluatePortalRouteBudget(budget, artifact.observed),
    });
  }

  const coveredRouteIds = new Set(routes.map((entry) => entry.budget.routeId));
  const missingRequiredRouteIds = PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.filter(
    (routeId) => !coveredRouteIds.has(routeId),
  );

  const commandFailureCount = input.commandResults.filter((entry) => !entry.passed).length;
  const budgetFailureCount = routes.filter((entry) => !entry.evaluation.passed).length;
  const missingRequiredRouteCount = missingRequiredRouteIds.length;
  const requiredRouteCount = PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.length;
  const coveredRouteCount = requiredRouteCount - missingRequiredRouteCount;
  const failedCount = commandFailureCount + budgetFailureCount + missingRequiredRouteCount;
  const passedCount = routes.filter((entry) => entry.evaluation.passed).length;

  return {
    passed: failedCount === 0,
    startedAt: input.startedAt ?? new Date().toISOString(),
    finishedAt: input.finishedAt ?? new Date().toISOString(),
    artifactDir: input.artifactDir ?? DEFAULT_PORTAL_NETWORK_ARTIFACT_ROOT,
    commands: input.commandResults,
    routes,
    skippedArtifacts,
    summary: {
      totalArtifacts: normalizedArtifacts.length,
      evaluatedCount: routes.length,
      passedCount,
      failedCount,
      commandFailureCount,
      budgetFailureCount,
      skippedArtifactCount: skippedArtifacts.length,
      missingArtifactCount: missingRequiredRouteCount,
      requiredRouteCount,
      coveredRouteCount,
      missingRequiredRouteCount,
      missingRequiredRouteIds,
    },
  };
}

export async function runPortalNetworkGateCommand(options: {
  label: string;
  command: string;
  cwd: string;
  artifactDir: string;
  spawnImpl?: SpawnLike;
}): Promise<PortalNetworkGateCommandResult> {
  const spawnImpl = options.spawnImpl ?? (spawn as unknown as SpawnLike);
  const startedAt = Date.now();

  return await new Promise((resolveCommand) => {
    const finish = (result: PortalNetworkGateCommandResult) => {
      if (settled) return;
      settled = true;
      resolveCommand(result);
    };

    let settled = false;

    try {
      const child = spawnImpl(options.command, {
        cwd: options.cwd,
        env: {
          ...process.env,
          PORTAL_NETWORK_ARTIFACT_DIR: options.artifactDir,
        },
        shell: true,
        stdio: 'inherit',
      });

      child.once('error', (error) => {
        finish({
          label: options.label,
          command: options.command,
          exitCode: 1,
          passed: false,
          durationMs: Date.now() - startedAt,
          errorMessage: error.message,
        });
      });

      child.once('close', (exitCode, signal) => {
        const parsedExitCode = parseExitCode(exitCode, signal);
        finish({
          label: options.label,
          command: options.command,
          exitCode: parsedExitCode,
          passed: parsedExitCode === 0,
          durationMs: Date.now() - startedAt,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finish({
        label: options.label,
        command: options.command,
        exitCode: 1,
        passed: false,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      });
    }
  });
}

export async function runPortalNetworkGate(options: RunPortalNetworkGateOptions = {}): Promise<PortalNetworkGateResult> {
  const cwd = options.cwd ?? process.cwd();
  const artifactDir = preparePortalNetworkArtifactDir({
    artifactDir: options.artifactDir,
    artifactRoot: options.artifactRoot,
  });
  const startedAt = new Date().toISOString();

  const commands = [
    await runPortalNetworkGateCommand({
      label: 'unit-contract',
      command: options.unitContractCommand ?? PORTAL_NETWORK_GATE_COMMANDS.unitContract,
      cwd,
      artifactDir,
    }),
    await runPortalNetworkGateCommand({
      label: 'smoke',
      command: options.smokeCommand ?? PORTAL_NETWORK_GATE_COMMANDS.smoke,
      cwd,
      artifactDir,
    }),
    await runPortalNetworkGateCommand({
      label: 'build',
      command: options.buildCommand ?? PORTAL_NETWORK_GATE_COMMANDS.build,
      cwd,
      artifactDir,
    }),
  ];

  const artifacts = readPortalNetworkArtifacts(artifactDir);

  return evaluatePortalNetworkGate({
    artifacts,
    commandResults: commands,
    artifactDir,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
}

export function formatPortalNetworkGateSummary(result: PortalNetworkGateResult): string {
  const lines = [
    `Portal network gate: ${result.passed ? 'PASS' : 'FAIL'}`,
    `Artifact dir: ${result.artifactDir}`,
    `Commands: ${result.commands.length} total, ${result.summary.commandFailureCount} failed`,
    `Artifacts: ${result.summary.totalArtifacts} total, ${result.summary.evaluatedCount} evaluated, ${result.summary.skippedArtifactCount} skipped`,
    `Coverage: ${result.summary.coveredRouteCount}/${result.summary.requiredRouteCount} required routes covered, ${result.summary.missingRequiredRouteCount} missing`,
  ];

  for (const command of result.commands) {
    lines.push(
      `- command:${command.label} ${command.passed ? 'PASS' : 'FAIL'} exit=${command.exitCode} durationMs=${command.durationMs}${command.errorMessage ? ` error=${command.errorMessage}` : ''}`,
    );
  }

  for (const route of result.routes) {
    lines.push(
      `- route:${route.routeId} ${route.evaluation.passed ? 'PASS' : 'FAIL'} listen=${route.observed.firestoreListenRequests} write=${route.observed.firestoreWriteRequests} listen400=${route.observed.firestoreListen400s} consoleErrors=${route.observed.consoleErrors}`,
    );
  }

  if (result.summary.missingRequiredRouteCount > 0) {
    lines.push(
      `- missing-required-routes:${result.summary.missingRequiredRouteIds.join(',')}`,
    );
  }

  for (const artifact of result.skippedArtifacts) {
    lines.push(`- skip:${artifact.routeId} reason=${artifact.reason}`);
  }

  return lines.join('\n');
}

function writePortalNetworkGateJson(filePath: string, result: PortalNetworkGateResult) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(result, null, 2));
}

function readFlag(argv: string[], ...names: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!names.includes(token)) continue;
    return argv[index + 1] ?? null;
  }
  return null;
}

export function parsePortalNetworkGateArgs(argv: string[]) {
  return {
    jsonOutPath: readFlag(argv, '--json-out', '-o'),
    artifactDir: readFlag(argv, '--artifact-dir'),
  };
}

async function main(argv: string[]) {
  const args = parsePortalNetworkGateArgs(argv);
  const result = await runPortalNetworkGate({
    artifactDir: args.artifactDir ?? undefined,
  });

  console.log(formatPortalNetworkGateSummary(result));

  if (args.jsonOutPath) {
    writePortalNetworkGateJson(resolve(args.jsonOutPath), result);
  }

  process.exitCode = result.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
