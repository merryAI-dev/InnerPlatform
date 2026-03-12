import fs from 'node:fs';
import path from 'node:path';
import { createBffApp } from './app.mjs';
import { resolveProjectId } from './firestore.mjs';

function loadLocalEnvFile(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadLocalEnvFile('.env');

const port = Number.parseInt(process.env.BFF_PORT || '8787', 10);
const host = process.env.BFF_HOST || '127.0.0.1';
const projectId = resolveProjectId();

const app = createBffApp({ projectId });

app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`[bff] listening on http://${host}:${port} (project=${projectId})`);
});
