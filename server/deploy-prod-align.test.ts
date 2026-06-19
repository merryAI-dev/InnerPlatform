import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');
const tempDirs: string[] = [];

function makeTempDir() {
  const dir = path.join(tmpdir(), `inner-platform-deploy-align-${process.pid}-${tempDirs.length}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function makeVercelStub(tempDir: string, scriptBody: string) {
  const binDir = path.join(tempDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const logPath = path.join(tempDir, 'vercel.log');
  const stubPath = path.join(binDir, 'vercel');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' "$*" >> ${JSON.stringify(logPath)}\n${scriptBody}\n`,
    { mode: 0o755 },
  );
  return { binDir, logPath };
}

function runDeployAlign(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ['deploy-prod-align.mjs', ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('deploy-prod-align', () => {
  it('blocks production deployment from the local CLI by default before invoking vercel', () => {
    const tempDir = makeTempDir();
    const { binDir, logPath } = makeVercelStub(tempDir, 'exit 99');

    const result = runDeployAlign([], {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      CI: '',
      GITHUB_ACTIONS: '',
      VERCEL_CLI_PACKAGE: '',
      VERCEL_TOKEN: '',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('Production deploys are disabled from local CLI');
    expect(existsSync(logPath)).toBe(false);
  });

  it('keeps verify-only available for checking a known deployment alias', () => {
    const tempDir = makeTempDir();
    const { binDir, logPath } = makeVercelStub(
      tempDir,
      `if [ "$1" = "inspect" ] && [ "$2" = "myscube.myscguard.app" ]; then
  printf '> Fetched deployment "inner-platform-hwoa12b1l-merryai-devs-projects.vercel.app" in merryai-devs-projects\\n'
  exit 0
fi
printf 'unexpected vercel args: %s\\n' "$*" >&2
exit 1`,
    );

    const result = runDeployAlign(['--verify-only', 'inner-platform-hwoa12b1l-merryai-devs-projects.vercel.app'], {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      VERCEL_CANONICAL_CHECK_ATTEMPTS: '1',
      VERCEL_CLI_PACKAGE: '',
      VERCEL_TOKEN: '',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('canonical production URL confirmed');
    expect(result.stdout).toContain('skipping live PWA verification');
    expect(readFileSync(logPath, 'utf8')).not.toContain('deploy --prod');
  });

  it('can run vercel inspect through npx with a redacted token for CI', () => {
    const tempDir = makeTempDir();
    const binDir = path.join(tempDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const logPath = path.join(tempDir, 'npx.log');
    const stubPath = path.join(binDir, 'npx');
    writeFileSync(
      stubPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}
printf 'token was secret-ci-token\\n' >&2
exit 1
`,
      { mode: 0o755 },
    );

    const result = runDeployAlign(['--verify-only', 'inner-platform-hwoa12b1l-merryai-devs-projects.vercel.app'], {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      VERCEL_CANONICAL_CHECK_ATTEMPTS: '1',
      VERCEL_CLI_PACKAGE: 'vercel@50.14.0',
      VERCEL_TOKEN: 'secret-ci-token',
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(logPath, 'utf8')).toContain(
      '--yes vercel@50.14.0 inspect myscube.myscguard.app --token secret-ci-token',
    );
    expect(`${result.stdout}\n${result.stderr}`).toContain('--token [redacted]');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('secret-ci-token');
  });
});
