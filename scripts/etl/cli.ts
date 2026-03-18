#!/usr/bin/env npx tsx
/**
 * ETL Pipeline CLI
 *
 * Usage:
 *   npx tsx scripts/etl/cli.ts discover <file1> [file2...]
 *   npx tsx scripts/etl/cli.ts run <file1> [file2...] [--commit] [--llm] [--org <orgId>]
 *   npx tsx scripts/etl/cli.ts run <file1> --steps 1,2,3
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runPipeline, printSummary } from './pipeline.js';

// ── Parse CLI args ──

loadEnvFiles();

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

// Extract flags
const flags = {
  commit: args.includes('--commit'),
  llm: args.includes('--llm'),
  allowErrors: args.includes('--allow-errors'),
  org: getFlagValue('--org') || 'mysc',
  steps: getFlagValue('--steps'),
  dashboard: getFlagValue('--dashboard'),
  expense: getFlagValue('--expense'),
};

// Extract file paths: positional args OR --dashboard/--expense flags
const positionalFiles = args.slice(1).filter(a => !a.startsWith('--') && !isValueOfFlag(a));
const flagFiles = [flags.dashboard, flags.expense].filter(Boolean) as string[];
const files = positionalFiles.length > 0 ? positionalFiles : flagFiles;

// Resolve and validate file paths
const resolvedFiles = files.map(f => resolve(f));
for (const f of resolvedFiles) {
  if (!existsSync(f)) {
    console.error(`❌ File not found: ${f}`);
    process.exit(1);
  }
}

// ── Execute ──

async function main() {
  console.log('🚀 MYSC ETL Pipeline');
  console.log(`   Command: ${command}`);
  console.log(`   Files: ${resolvedFiles.length}`);
  resolvedFiles.forEach(f => console.log(`     - ${f.split('/').pop()}`));

  if (command === 'discover') {
    // Steps 1 only
    if (resolvedFiles.length === 0) {
      console.error('❌ No files specified. Usage: discover <file1> [file2...]');
      process.exit(1);
    }

    const output = await runPipeline({
      files: resolvedFiles,
      steps: [1],
    });
    printSummary(output);

  } else if (command === 'run') {
    if (resolvedFiles.length === 0) {
      console.error('❌ No files specified. Usage: run <file1> [file2...] [--commit] [--llm]');
      process.exit(1);
    }

    const steps = flags.steps
      ? flags.steps.split(',').map(Number).filter(n => n >= 1 && n <= 5)
      : [1, 2, 3, 4, 5];

    if (flags.commit) {
      console.log('\n⚠️  LIVE MODE: Will write to Firestore!');
      if (!flags.allowErrors) {
        console.log('   Strict mode: sheets with validation errors will NOT be loaded.');
      }
      console.log('   Press Ctrl+C within 5 seconds to abort...');
      await sleep(5000);
    }

    const output = await runPipeline({
      files: resolvedFiles,
      commit: flags.commit,
      useLLM: flags.llm,
      orgId: flags.org,
      steps,
      allowSheetErrorsOnCommit: flags.allowErrors,
    });

    printSummary(output);

    // Write summary JSON
    if (!flags.commit) {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const outDir = 'scripts/etl/output';
      mkdirSync(outDir, { recursive: true });

      const runTs = Date.now();
      const summaryPath = join(outDir, `pipeline-summary-${runTs}.json`);
      const issuesPath = join(outDir, `validation-issues-${runTs}.json`);
      writeFileSync(summaryPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        files: resolvedFiles.map(f => f.split('/').pop()),
        steps,
        flags,
        manifests: output.manifests.map(m => m.summary),
        mappings: output.mappings.map(m => ({
          sheet: m.sheetName,
          collection: m.targetCollection,
          columns: m.columnMappings.length,
          skipped: m.skipped,
        })),
        extractions: output.extractions.map(e => ({
          sheet: e.sheetName,
          collection: e.targetCollection,
          ...e.stats,
        })),
        validations: output.validations.map(v => ({
          sheet: v.sheetName,
          collection: v.collection,
          ...v.stats,
        })),
        loads: output.loads,
        duration: output.duration,
      }, null, 2), 'utf-8');
      writeFileSync(issuesPath, JSON.stringify(
        output.validations.map(v => ({
          sheet: v.sheetName,
          collection: v.collection,
          stats: v.stats,
          issues: v.issues,
        })),
        null,
        2,
      ), 'utf-8');

      console.log(`\n📁 Summary saved: ${summaryPath}`);
      console.log(`📁 Validation issues saved: ${issuesPath}`);
    }

  } else {
    console.error(`❌ Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n💥 Pipeline failed:', err);
  process.exit(1);
});

// ── Helpers ──

function printUsage() {
  console.log(`
MYSC ETL Pipeline — Excel → Firestore

Usage:
  npx tsx scripts/etl/cli.ts <command> <files...> [options]

Commands:
  discover    Scan Excel files and show sheet structure (Step 1 only)
  run         Execute the full pipeline (Steps 1-5)

Options:
  --commit    Actually write to Firestore (default: dry-run → JSON files)
  --allow-errors
              Allow loading sheets even when validation errors exist (only with --commit)
  --llm       Enable LLM-based validation in Step 4
  --org <id>  Firestore orgId (default: mysc)
  --steps N   Comma-separated step numbers to run (default: 1,2,3,4,5)

Examples:
  # Discover sheets
  npx tsx scripts/etl/cli.ts discover "./[2026] 사업관리 통합 대시보드-2.xlsx"

  # Full dry-run (Steps 1-5, no Firestore write)
  npx tsx scripts/etl/cli.ts run \\
    "./[2026] 사업관리 통합 대시보드-2.xlsx" \\
    "./[복사용] 사업명_2026_사업비 관리 시트 (공통양식) .xlsx"

  # Run Steps 1-3 only (no validation/load)
  npx tsx scripts/etl/cli.ts run "./data.xlsx" --steps 1,2,3

  # Full pipeline with LLM validation
  npx tsx scripts/etl/cli.ts run "./data.xlsx" --llm

  # Live Firestore write (after dry-run verification)
  npx tsx scripts/etl/cli.ts run "./data.xlsx" --commit --org mysc
`);
}

function getFlagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function isValueOfFlag(arg: string): boolean {
  const idx = args.indexOf(arg);
  if (idx <= 0) return false;
  const prev = args[idx - 1];
  return prev.startsWith('--') && !arg.startsWith('--') && ['--org', '--steps', '--dashboard', '--expense'].includes(prev);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadEnvFiles() {
  // Minimal dotenv loader for ETL runtime (CLI is executed directly via tsx)
  const candidates = ['.env', '.env.local'];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = value;
      }
    }
  }
}
