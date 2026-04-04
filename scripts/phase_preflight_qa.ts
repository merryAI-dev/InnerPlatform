import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildQaFeedbackMemoryFromCsv,
  buildQaPhasePreflightReport,
  renderQaPhasePreflightMarkdown,
  type QaFeedbackMemory,
  type QaProjectType,
} from '../src/app/platform/qa-feedback-memory';

interface ScriptOptions {
  task: string;
  projectType: QaProjectType | '전체';
  maxMatches: number;
  memoryPath: string;
  csvPath?: string;
}

function readFlag(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] || '' : '';
}

function parseProjectType(value: string): QaProjectType | '전체' {
  if (!value || value === '전체') return '전체';
  if (value === '사업관리플랫폼' || value === '기업육성플랫폼' || value === '공통' || value === '미분류') {
    return value;
  }
  throw new Error(`Unsupported project type: ${value}`);
}

function parseArgs(argv: string[]): ScriptOptions {
  const task = readFlag(argv, '--task') || readFlag(argv, '-t');
  if (!task) {
    throw new Error(
      'Usage: npx tsx scripts/phase_preflight_qa.ts --task "<task description>" [--project-type 사업관리플랫폼] [--memory path] [--csv path] [--max 10]',
    );
  }

  const maxMatches = Number.parseInt(readFlag(argv, '--max') || '10', 10);
  return {
    task,
    projectType: parseProjectType(readFlag(argv, '--project-type') || '전체'),
    maxMatches: Number.isFinite(maxMatches) ? maxMatches : 10,
    memoryPath: path.resolve(
      readFlag(argv, '--memory') || path.join(process.cwd(), 'docs', 'operations', 'qa-feedback-memory.json'),
    ),
    csvPath: readFlag(argv, '--csv') ? path.resolve(readFlag(argv, '--csv')) : undefined,
  };
}

async function loadMemory(options: ScriptOptions): Promise<QaFeedbackMemory> {
  if (options.csvPath) {
    const csvText = await fs.readFile(options.csvPath, 'utf-8');
    return buildQaFeedbackMemoryFromCsv(csvText, path.basename(options.csvPath));
  }

  const raw = await fs.readFile(options.memoryPath, 'utf-8');
  return JSON.parse(raw) as QaFeedbackMemory;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const memory = await loadMemory(options);
  const report = buildQaPhasePreflightReport(memory, options.task, {
    projectType: options.projectType,
    maxMatches: options.maxMatches,
  });

  // eslint-disable-next-line no-console
  console.log(renderQaPhasePreflightMarkdown(report));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
