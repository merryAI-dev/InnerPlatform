import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');
const defaultBinaryPath = path.resolve(repoRoot, 'rust/spreadsheet-calculation-core/target/debug/spreadsheet-calculation-core');

function readOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveSettlementKernelBinaryPath(
  env = process.env,
  options = {},
) {
  const exists = options.existsSyncFn || existsSync;
  const configured = readOptionalText(env.SETTLEMENT_KERNEL_BIN);
  if (configured) {
    return exists(configured) ? configured : '';
  }
  return exists(defaultBinaryPath) ? defaultBinaryPath : '';
}

export function createSettlementKernelService(options = {}) {
  const env = options.env || process.env;
  const exists = options.existsSyncFn || existsSync;
  const spawn = options.spawnSyncFn || spawnSync;
  const cwd = options.cwd || repoRoot;
  const binaryPath = resolveSettlementKernelBinaryPath(env, { existsSyncFn: exists });

  function run(payload) {
    if (!binaryPath) {
      const error = new Error('Settlement kernel binary is unavailable.');
      error.statusCode = 503;
      error.code = 'settlement_kernel_unavailable';
      throw error;
    }
    const result = spawn(binaryPath, {
      cwd,
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      const error = new Error(result.stderr || result.stdout || 'Settlement kernel failed.');
      error.statusCode = 502;
      error.code = 'settlement_kernel_failed';
      throw error;
    }
    return JSON.parse(result.stdout || '{}');
  }

  return {
    isAvailable() {
      return Boolean(binaryPath);
    },
    deriveRows(input) {
      return run(input);
    },
    previewFlowSnapshot(input) {
      return run({
        command: 'flowSnapshot',
        ...input,
      });
    },
    previewActualSync(input) {
      return run({
        command: 'actualSync',
        ...input,
      });
    },
  };
}
