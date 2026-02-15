#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth');

const ROOT_DIR = process.cwd();
const STATE_DIR = path.join(ROOT_DIR, '.firebase-login');
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const RESULT_PATH = path.join(STATE_DIR, 'result.json');
const CODE_PATH = path.join(STATE_DIR, 'code.txt');
const PID_PATH = path.join(STATE_DIR, 'pid');

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateState(patch) {
  const current = readJson(STATE_PATH) || {};
  writeJson(STATE_PATH, { ...current, ...patch });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function maybeOpenUrl(url, shouldOpen) {
  if (!shouldOpen) return;
  const escaped = url.replace(/'/g, "'\\''");
  exec(`open '${escaped}'`);
}

function cleanupRuntimeFiles() {
  if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH);
  if (fs.existsSync(CODE_PATH)) fs.unlinkSync(CODE_PATH);
}

async function startDaemon({ openUrl = false, timeoutSeconds = 900 }) {
  ensureStateDir();

  if (fs.existsSync(PID_PATH)) {
    const oldPid = Number.parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10);
    if (Number.isInteger(oldPid) && processExists(oldPid)) {
      throw new Error(`Daemon already running (pid ${oldPid}).`);
    }
  }

  fs.writeFileSync(PID_PATH, String(process.pid), 'utf8');
  if (fs.existsSync(CODE_PATH)) fs.unlinkSync(CODE_PATH);
  if (fs.existsSync(RESULT_PATH)) fs.unlinkSync(RESULT_PATH);

  const prototyper = await auth.loginPrototyper();
  const sanitizedUri = typeof prototyper.uri === 'string'
    ? prototyper.uri.replace(/}\s*$/, '')
    : prototyper.uri;
  const createdAt = new Date().toISOString();
  writeJson(STATE_PATH, {
    status: 'waiting',
    createdAt,
    sessionId: prototyper.sessionId,
    uri: sanitizedUri,
    codePath: CODE_PATH,
    resultPath: RESULT_PATH,
    pid: process.pid,
  });

  maybeOpenUrl(sanitizedUri, openUrl);

  const timeoutAt = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < timeoutAt) {
    if (fs.existsSync(CODE_PATH)) {
      const code = fs.readFileSync(CODE_PATH, 'utf8').trim();
      if (code) {
        try {
          const creds = await prototyper.authorize(code);
          const result = {
            status: 'success',
            email: creds?.user?.email || null,
            completedAt: new Date().toISOString(),
          };
          writeJson(RESULT_PATH, result);
          updateState({ status: 'success', completedAt: result.completedAt });
          console.log(JSON.stringify({ ok: true, ...result }));
          cleanupRuntimeFiles();
          return;
        } catch (err) {
          const result = {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
            completedAt: new Date().toISOString(),
          };
          writeJson(RESULT_PATH, result);
          updateState({ status: 'error', completedAt: result.completedAt, error: result.error });
          console.log(JSON.stringify({ ok: false, ...result }));
          cleanupRuntimeFiles();
          process.exit(1);
        }
      }
    }
    await sleep(1000);
  }

  const timeoutResult = {
    status: 'timeout',
    completedAt: new Date().toISOString(),
    error: 'Timed out waiting for authorization code.',
  };
  writeJson(RESULT_PATH, timeoutResult);
  updateState({ status: 'timeout', completedAt: timeoutResult.completedAt, error: timeoutResult.error });
  console.log(JSON.stringify({ ok: false, ...timeoutResult }));
  cleanupRuntimeFiles();
  process.exit(2);
}

function submitCode(code) {
  ensureStateDir();
  if (!code || !code.trim()) throw new Error('Authorization code is required.');
  const state = readJson(STATE_PATH);
  if (!state || !state.codePath) throw new Error('No active login state. Start daemon first.');
  fs.writeFileSync(state.codePath, `${code.trim()}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, submittedAt: new Date().toISOString() }));
}

function printStatus() {
  const state = readJson(STATE_PATH);
  const result = readJson(RESULT_PATH);
  const pid = fs.existsSync(PID_PATH)
    ? Number.parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10)
    : null;
  const running = Number.isInteger(pid) ? processExists(pid) : false;
  console.log(JSON.stringify({ state, result, pid, running }, null, 2));
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) return { command: 'status' };

  if (command === 'start') {
    const openUrl = rest.includes('--open');
    const timeoutArg = rest.find((arg) => arg.startsWith('--timeout='));
    const timeoutSeconds = timeoutArg ? Number.parseInt(timeoutArg.split('=')[1], 10) : 900;
    return { command, openUrl, timeoutSeconds };
  }

  if (command === 'submit') {
    const code = rest.join(' ').trim();
    return { command, code };
  }

  return { command };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'start':
      await startDaemon({ openUrl: args.openUrl, timeoutSeconds: args.timeoutSeconds });
      break;
    case 'submit':
      submitCode(args.code);
      break;
    case 'status':
      printStatus();
      break;
    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
